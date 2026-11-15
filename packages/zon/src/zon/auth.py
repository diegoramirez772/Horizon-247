"""Who may do what (function 2 for PEOPLE using the system): API keys, roles and organisations.

    key = create_key(con, "carolina", "operador", ["aethra"])      # shown ONCE; only its SHA-256 is stored
    who = check_key(con, key)                                        # {"name", "role", "orgs"} or None
    allowed(who, "transicion", org="aethra")

Roles (explicit): lector = read · operador = read + send observations/reports + move alerts · admin = everything (monitors,
keys). A key only sees the monitors of its organisations ("*" = all). Revoked keys stop working at once.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets

from . import db

ROLES = {"lector": {"leer"}, "operador": {"leer", "observar", "reportar", "transicion"},
         "admin": {"leer", "observar", "reportar", "transicion", "crear_monitor", "llaves"}}


def _h(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create_key(con, name: str, role: str, orgs: list, at: str = "") -> str:
    if role not in ROLES:
        raise ValueError(f"role must be one of {list(ROLES)}")
    key = "hz_" + secrets.token_urlsafe(32)
    with db.tx(con):
        con.execute("INSERT INTO keys VALUES (?,?,?,?,?,0)", (_h(key), name, role, json.dumps(list(orgs)), at))
        db.audit(con, at, "sistema", "llave_creada", None, {"name": name, "role": role, "orgs": list(orgs)})
    return key


def revoke_key(con, key: str, at: str = "") -> None:
    with db.tx(con):
        con.execute("UPDATE keys SET revoked = 1 WHERE key_hash = ?", (_h(key),))
        db.audit(con, at, "sistema", "llave_revocada", None, {"key_hash": _h(key)[:12]})


def check_key(con, key: str | None) -> dict | None:
    if not key:
        return None
    h = _h(key)
    for r in con.execute("SELECT * FROM keys WHERE revoked = 0"):
        if hmac.compare_digest(r["key_hash"], h):                    # constant-time comparison
            return {"name": r["name"], "role": r["role"], "orgs": json.loads(r["orgs"])}
    return None


def allowed(who: dict | None, action: str, org: str | None = None) -> bool:
    if who is None or action not in ROLES.get(who["role"], set()):
        return False
    return org is None or "*" in who["orgs"] or org in who["orgs"]
