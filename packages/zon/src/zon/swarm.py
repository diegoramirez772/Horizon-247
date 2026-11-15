"""ZON side of the swarm: receive reports (people, scientists, institutions, citizen sensors), keep their evidence by hash,
and hand them to HORI to score. Plain files, append-only, chained like the alert audit.

    sw = SwarmStore("data/swarm")
    sw.add_report({"reporter": {"id": "u-17", "type": "persona"}, "lat": 24.0, "lon": -104.6, "time": "2011-05-03T10:00",
                   "text": "el río ya se secó"}, evidence=["foto.jpg"])
    sw.signals(instrument=...)            # -> hori.api.swarm_signals

Privacy: a report keeps a reporter id (pseudonymous), never a name, phone or exact home; coordinates are rounded to
~1 km (2 decimals) on arrival. Evidence files are stored under their SHA-256, so the same photo uploaded twice is ONE item.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import time
from pathlib import Path

from hori.api import classify_report, swarm_signals                       # public API only

from . import db
from .signing import TrustRegistry

ROLES = ("persona", "cientifico", "institucion", "sensor_ciudadano")
EVIDENCE = ("foto", "video", "medicion", "documento")


class SwarmError(ValueError):
    pass


def _sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


class SwarmStore:
    def __init__(self, root: str | Path, clock=None, trust: TrustRegistry | None = None):
        self.root = Path(root)
        self.con = db.connect(self.root)
        self.trust = trust or TrustRegistry.load(Path(root) / "trust.json")
        (self.root / "evidence").mkdir(parents=True, exist_ok=True)
        self.clock = clock or (lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    def reports(self, since_seq: int = 0) -> list[dict]:
        return [json.loads(r["doc"]) for r in self.con.execute("SELECT doc FROM reports WHERE seq > ? ORDER BY seq", (since_seq,))]

    def __del__(self):
        try:
            self.con.close()
        except Exception:
            pass

    def add_report(self, rep: dict, evidence: list | None = None) -> dict:
        """Validate, round the location, store evidence by hash, append to the chained log. Returns the stored report."""
        who = dict(rep.get("reporter") or {})
        if not who.get("id"):
            raise SwarmError("a report needs a (pseudonymous) reporter id")
        if who.get("type", "persona") not in ROLES:
            raise SwarmError(f"reporter type must be one of {ROLES}")
        # verified ONLY with a valid signed attestation from a trusted issuer, for this reporter, this role, still valid
        att = rep.get("attestation")
        who["verified"], who["verification"] = False, "sin atestación: fuente no verificada"
        if att:
            ok, msg = self.trust.check(att.get("key_id", ""), att.get("statement", {}), att.get("signature", ""))
            st = att.get("statement", {})
            if ok and st.get("subject") != who["id"]:
                ok, msg = False, "la atestación es de otra persona"
            if ok and st.get("role") != who.get("type", "persona"):
                ok, msg = False, f"la atestación es para el rol {st.get('role')!r}"
            if ok and str(st.get("valid_until", "")) < str(rep.get("time", "")):
                ok, msg = False, "la atestación ya venció"
            who["verified"], who["verification"] = ok, msg
            if ok:
                who["verified_by"] = self.trust.keys[att["key_id"]]["name"]
        for k in ("lat", "lon", "time", "text"):
            if rep.get(k) in (None, ""):
                raise SwarmError(f"a report needs {k}")
        if not (-90 <= float(rep["lat"]) <= 90 and -180 <= float(rep["lon"]) <= 180):
            raise SwarmError("lat/lon out of range")
        evs = []
        for e in list(rep.get("evidence", [])) + [{"path": p} for p in (evidence or [])]:
            e = dict(e)
            if e.get("path"):
                src = Path(e.pop("path"))
                data = src.read_bytes()
                e["sha256"] = hashlib.sha256(data).hexdigest()
                e.setdefault("type", {"jpg": "foto", "jpeg": "foto", "png": "foto", "mp4": "video", "csv": "medicion",
                                      "pdf": "documento"}.get(src.suffix.lower().lstrip("."), "documento"))
                dst = self.root / "evidence" / e["sha256"]
                if not dst.exists():
                    shutil.copyfile(src, dst)
            if e.get("type") not in EVIDENCE:
                raise SwarmError(f"evidence type must be one of {EVIDENCE}")
            evs.append(e)
        themes, dirs = classify_report(rep["text"] + " " + rep.get("kind", ""))
        out = {"id": rep.get("id") or "rp-" + _sha([who["id"], rep["time"], rep["text"]])[:12], "reporter": who,
               "lat": round(float(rep["lat"]), 2), "lon": round(float(rep["lon"]), 2), "time": str(rep["time"]),
               "text": rep["text"], "kind": rep.get("kind", ""), "evidence": evs, "themes": themes, "directions": dirs,
               "source_class": "no_verificada", "simulated": bool(rep.get("simulated")), "received_at": self.clock(),
               **({"attestation": att} if att else {})}
        with db.tx(self.con):
            if self.con.execute("SELECT 1 FROM reports WHERE id = ?", (out["id"],)).fetchone():
                raise SwarmError(f"duplicate report {out['id']}")
            row = self.con.execute("SELECT seq, hash FROM reports ORDER BY seq DESC LIMIT 1").fetchone()
            seq, prev = (row["seq"] + 1, row["hash"]) if row else (1, "0" * 64)
            rec = {"seq": seq, "report": out, "prev_hash": prev}
            h = _sha(rec)
            self.con.execute("INSERT INTO reports VALUES (?,?,?,?,?)", (out["id"], seq, json.dumps(out, ensure_ascii=False), prev, h))
        return out

    def verify(self) -> tuple[bool, int]:
        prev, n = "0" * 64, 0
        for r in self.con.execute("SELECT * FROM reports ORDER BY seq"):
            rec = {"seq": r["seq"], "report": json.loads(r["doc"]), "prev_hash": r["prev_hash"]}
            if r["prev_hash"] != prev or _sha(rec) != r["hash"]:
                return False, n
            prev, n = r["hash"], n + 1
        return True, n

    def signals(self, **kw) -> list[dict]:
        return swarm_signals(self.reports(), **kw)
