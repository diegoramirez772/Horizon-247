"""Verifiable identity (function 2): Ed25519 signatures, standard library only.

The arithmetic is the reference implementation of RFC 8032 §6 (IETF code components: Simplified BSD licence). It is NOT
constant-time: right for VERIFYING signatures and for demo keys; a production signer should use a vetted library
(libsodium). Used for:
  * attestations: an institution vouches «reporter u-04 is a hydrologist, until 2027-01-01» -> the swarm counts the role;
  * device signatures: a sensor signs each batch of observations -> the monitor records «signed by device X: valid».
Trust is explicit: only public keys listed in a trust registry count (trust.json: {key_id: {public_hex, name, kind}}).
"""
from __future__ import annotations

import hashlib
import json
import os

p = 2 ** 255 - 19
q = 2 ** 252 + 27742317777372353535851937790883648493


def _inv(x: int) -> int:
    return pow(x, p - 2, p)


d = -121665 * _inv(121666) % p
_SQRT_M1 = pow(2, (p - 1) // 4, p)


def _h(s: bytes) -> bytes:
    return hashlib.sha512(s).digest()


def _hq(s: bytes) -> int:
    return int.from_bytes(_h(s), "little") % q


def _add(P, Q):
    A, B = (P[1] - P[0]) * (Q[1] - Q[0]) % p, (P[1] + P[0]) * (Q[1] + Q[0]) % p
    C, D = 2 * P[3] * Q[3] * d % p, 2 * P[2] * Q[2] % p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F, G * H, F * G, E * H)


def _mul(s: int, P):
    Q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            Q = _add(Q, P)
        P = _add(P, P)
        s >>= 1
    return Q


def _eq(P, Q) -> bool:
    return (P[0] * Q[2] - Q[0] * P[2]) % p == 0 and (P[1] * Q[2] - Q[1] * P[2]) % p == 0


def _recover_x(y: int, sign: int):
    if y >= p:
        return None
    x2 = (y * y - 1) * _inv(d * y * y + 1)
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (p + 3) // 8, p)
    if (x * x - x2) % p != 0:
        x = x * _SQRT_M1 % p
    if (x * x - x2) % p != 0:
        return None
    if (x & 1) != sign:
        x = p - x
    return x


_gy = 4 * _inv(5) % p
_gx = _recover_x(_gy, 0)
G = (_gx, _gy, 1, _gx * _gy % p)


def _compress(P) -> bytes:
    zi = _inv(P[2])
    x, y = P[0] * zi % p, P[1] * zi % p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _decompress(s: bytes):
    if len(s) != 32:
        return None
    y = int.from_bytes(s, "little")
    sign, y = y >> 255, y & ((1 << 255) - 1)
    x = _recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % p)


def _expand(secret: bytes):
    h = _h(secret)
    a = int.from_bytes(h[:32], "little")
    a &= (1 << 254) - 8
    a |= 1 << 254
    return a, h[32:]


def public_key(secret: bytes) -> bytes:
    return _compress(_mul(_expand(secret)[0], G))


def new_secret() -> bytes:
    return os.urandom(32)


def sign(secret: bytes, msg: bytes) -> bytes:
    a, prefix = _expand(secret)
    A = _compress(_mul(a, G))
    r = _hq(prefix + msg)
    Rs = _compress(_mul(r, G))
    s = (r + _hq(Rs + A + msg) * a) % q
    return Rs + int.to_bytes(s, 32, "little")


def verify(public: bytes, msg: bytes, signature: bytes) -> bool:
    if len(public) != 32 or len(signature) != 64:
        return False
    A, R = _decompress(public), _decompress(signature[:32])
    if not A or not R:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= q:
        return False
    return _eq(_mul(s, G), _add(R, _mul(_hq(signature[:32] + public + msg), A)))


def canonical(obj) -> bytes:
    """What gets signed: canonical JSON (sorted keys, no spaces), so the same statement always has the same bytes."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


class TrustRegistry:
    """Public keys we decide to trust (institutions, devices). Nothing outside the registry is ever «verified»."""

    def __init__(self, keys: dict | None = None):
        self.keys = dict(keys or {})

    @classmethod
    def load(cls, path) -> "TrustRegistry":
        from pathlib import Path
        p = Path(path)
        return cls(json.loads(p.read_text(encoding="utf-8")) if p.exists() else {})

    def add(self, key_id: str, public: bytes, name: str, kind: str) -> None:
        self.keys[key_id] = {"public_hex": public.hex(), "name": name, "kind": kind}

    def check(self, key_id: str, statement: dict, signature_hex: str) -> tuple[bool, str]:
        k = self.keys.get(key_id)
        if k is None:
            return False, f"la llave {key_id!r} no está en el registro de confianza"
        try:
            ok = verify(bytes.fromhex(k["public_hex"]), canonical(statement), bytes.fromhex(signature_hex))
        except ValueError:
            ok = False
        return (True, f"firma válida de {k['name']} ({k['kind']})") if ok else (False, "firma inválida")


def attest(secret: bytes, key_id: str, subject: str, role: str, valid_until: str) -> dict:
    """An institution vouches for a role: returns {statement, key_id, signature}."""
    st = {"subject": subject, "role": role, "valid_until": valid_until, "issuer": key_id}
    return {"statement": st, "key_id": key_id, "signature": sign(secret, canonical(st)).hex()}
