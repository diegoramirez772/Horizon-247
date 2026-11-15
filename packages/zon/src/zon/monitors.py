"""Functions 1 and 5 of the idea: persistent MONITORS and ALERTS with a lifecycle and an auditable history.

    store = MonitorStore("data/monitors")
    store.add_monitor(Monitor(id="mon-chihuahua-t2m", entity=..., variable={...}, period=12))
    new = store.ingest("mon-chihuahua-t2m", times, values)        # runs HORI's detectors, opens alerts for NEW events
    store.transition(alert_id, "reconocida", actor="carolina", note="la revisa Diego")

What it keeps: one SQLite file (zon.db, see zon/db.py) with the monitors, the observations, the CURRENT state of every
alert and the append-only audit log (every opening, update and transition chained by SHA-256, prev_hash -> hash, written
in the SAME transaction as the change it records; verify_audit() detects any edit of the past). Several processes can use
it at once (WAL); a laptop copy is a single file.
Alert id = hash(monitor, event type, start label): ingesting the same data twice never duplicates an alert; an event that
grows (same start, later end) UPDATES its alert. Lifecycle: abierta -> reconocida -> derivada -> cerrada (any open state
can be closed). Honesty (H12/H16/H17): every alert says «observación calculada por HORI», shows its evidence and
uncertainty, and never carries advice.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from hori.api import anomaly_events, detect_anomalies, physical_class      # public API only

from . import db

STATES = ("abierta", "reconocida", "derivada", "cerrada")
TRANSITIONS = {"abierta": ("reconocida", "derivada", "cerrada"), "reconocida": ("derivada", "cerrada"),
               "derivada": ("cerrada",), "cerrada": ()}
NOTE_ES = "Una anomalía es una desviación estadística: no prueba falla, enfermedad ni peligro."
NOTE_EN = "An anomaly is a statistical deviation: it is not proof of a fault, illness or danger."


class MonitorError(ValueError):
    pass


def regularize(times: list, values, minutes: int) -> tuple[list, np.ndarray]:
    """Irregular timestamps (ISO strings) -> a regular grid every `minutes`: mean of the samples in each slot, NaN where none
    arrived (so silence stays visible). Detectors need a regular cadence; this is where irregular sources are made fit."""
    if not times:
        return [], np.array([])
    t = np.array([np.datetime64(str(x)[:16]) for x in times])
    v = np.asarray(values, dtype=float)
    step = np.timedelta64(int(minutes), "m")
    t0 = t.min().astype("datetime64[m]")
    slot = ((t - t0) // step).astype(int)
    n = int(slot.max()) + 1
    acc, cnt = np.zeros(n), np.zeros(n)
    ok = np.isfinite(v)
    np.add.at(acc, slot[ok], v[ok])
    np.add.at(cnt, slot[ok], 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(cnt > 0, acc / cnt, np.nan)
    grid = [str(t0 + k * step)[:16] for k in range(n)]
    return grid, out


@dataclass
class Monitor:
    id: str
    entity: dict                    # hori Entity.to_dict() (id, type, body, name, status real|simulada, source...)
    variable: dict                  # {"name", "unit", "long_name"}
    period: int                     # samples per cycle (12 monthly, 144 = one day at 10 min)
    cadence: str = ""               # free text: «mensual», «10 min»
    params: dict = field(default_factory=dict)     # overrides for hori.anomaly.detect (z_alarm, cusum_h, min_sigma, ...)
    created_at: str = ""

    def __post_init__(self):
        if not self.id or self.id != self.id.lower() or " " in self.id:
            raise MonitorError(f"monitor id must be lowercase without spaces: {self.id!r}")
        if self.period < 2:
            raise MonitorError("period must be >= 2")


def _sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


class MonitorStore:
    def __init__(self, root: str | Path, clock=None):
        self.root = Path(root)
        self.con = db.connect(self.root)
        self.clock = clock or (lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    def close(self) -> None:
        self.con.close()

    def __del__(self):
        try:
            self.con.close()
        except Exception:
            pass

    # ------------------------------------------------------------ reads
    def monitors(self, org: str | None = None) -> dict[str, Monitor]:
        q = "SELECT doc FROM monitors" + (" WHERE org = ?" if org else "")
        return {d["id"]: Monitor(**d) for d in (json.loads(r["doc"]) for r in self.con.execute(q, (org,) if org else ()))}

    def monitor_org(self, monitor: str) -> str | None:
        r = self.con.execute("SELECT org FROM monitors WHERE id = ?", (monitor,)).fetchone()
        return r["org"] if r else None

    def alerts(self, monitor: str | None = None, state: str | None = None) -> list[dict]:
        q, a = "SELECT doc FROM alerts WHERE 1=1", []
        if monitor:
            q, a = q + " AND monitor = ?", a + [monitor]
        if state:
            q, a = q + " AND state = ?", a + [state]
        return [json.loads(r["doc"]) for r in self.con.execute(q + " ORDER BY id", a)]

    def alert(self, alert_id: str) -> dict | None:
        r = self.con.execute("SELECT doc FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        return json.loads(r["doc"]) if r else None

    def _put_alert(self, a: dict) -> None:
        self.con.execute("INSERT OR REPLACE INTO alerts VALUES (?,?,?,?)", (a["id"], a["monitor"], a["state"], json.dumps(a, ensure_ascii=False, default=str)))

    # ------------------------------------------------------------ audit log (hash chain, inside the same transaction)
    def _audit(self, action: str, alert: str | None, actor: str, data: dict) -> dict:
        with db.tx(self.con):
            return db.audit(self.con, self.clock(), actor, action, alert, data)

    def audit_records(self, since: int = 0) -> list[dict]:
        return db.audit_records(self.con, since)

    def verify_audit(self, incremental: bool = False) -> tuple[bool, int]:
        """(chain intact?, records). Any edited, removed or reordered record breaks it. incremental=True only re-reads records
        after the last point this object verified (cheap for /health); a full check re-reads everything."""
        start = getattr(self, "_verified", None) if incremental else None
        ok, n = db.verify_chain(self.con, start)
        if ok and n:
            self._verified = (n, self.con.execute("SELECT hash FROM audit WHERE seq = ?", (n,)).fetchone()["hash"])
        return ok, n

    # ------------------------------------------------------------ monitors and observations
    def add_monitor(self, m: Monitor, actor: str = "sistema", org: str = "publica") -> Monitor:
        m.created_at = m.created_at or self.clock()
        with db.tx(self.con):
            if self.con.execute("SELECT 1 FROM monitors WHERE id = ?", (m.id,)).fetchone():
                raise MonitorError(f"monitor {m.id} already exists")
            self.con.execute("INSERT INTO monitors VALUES (?,?,?)", (m.id, org, json.dumps(asdict(m), ensure_ascii=False, default=str)))
            db.audit(self.con, self.clock(), actor, "monitor_creado", None,
                     {"monitor": m.id, "org": org, "entity": m.entity.get("id"), "status": m.entity.get("status")})
        return m

    def observations(self, monitor: str) -> tuple[list, np.ndarray]:
        rows = self.con.execute("SELECT t, v FROM obs WHERE monitor = ? ORDER BY i", (monitor,)).fetchall()
        return [r["t"] for r in rows], np.array([np.nan if r["v"] is None else r["v"] for r in rows], dtype=float)

    def ingest(self, monitor: str, times: list, values, actor: str = "sistema", signed: dict | None = None,
               trust=None) -> list[dict]:
        """Append observations (times must be strictly after the last stored one), run the detectors over the whole history,
        and open an alert for each NEW event (or update the one that grew). Returns the alerts opened or updated."""
        m = self.monitors().get(monitor)
        if m is None:
            raise MonitorError(f"no monitor {monitor}")
        t0, x0 = self.observations(monitor)
        times, values = list(times), np.asarray(values, dtype=float)
        if len(times) != len(values):
            raise MonitorError("times and values differ in length")
        if t0 and times and str(times[0]) <= str(t0[-1]):
            raise MonitorError(f"observations must be after {t0[-1]} (got {times[0]})")
        sig_status = "sin firma"
        if signed is not None or m.params.get("require_signature"):
            from .signing import TrustRegistry
            reg = trust or TrustRegistry.load(self.root / "trust.json")
            stmt = {"monitor": monitor, "times": [str(t) for t in times], "values": [None if not np.isfinite(v) else float(v) for v in values]}
            ok, sig_status = reg.check((signed or {}).get("key_id", ""), stmt, (signed or {}).get("signature", "")) if signed else (False, "sin firma")
            if not ok and m.params.get("require_signature"):
                self._audit("observaciones_rechazadas", None, actor, {"monitor": monitor, "motivo": sig_status})
                raise MonitorError(f"observations rejected: {sig_status}")
        T, X = t0 + times, np.concatenate([x0, values])
        with db.tx(self.con):
            self.con.executemany("INSERT INTO obs VALUES (?,?,?,?)", [(monitor, len(t0) + k, str(t), None if not np.isfinite(v) else float(v))
                                                                       for k, (t, v) in enumerate(zip(times, values))])
            db.audit(self.con, self.clock(), actor, "observaciones", None,
                     {"monitor": monitor, "n_new": len(times), "n_total": len(T), "last": T[-1] if T else None, "firma": sig_status,
                      "sha256": _sha({"t": T, "v": [None if not np.isfinite(v) else float(v) for v in X]})})
        params = {k: v for k, v in m.params.items() if k != "require_signature"}
        if "transform" not in params and physical_class(m.variable) == "flujo_de_agua":
            params["transform"] = "sqrt"                                   # rain is skewed: measured 16.8 -> 4.1 alarms per 1000 months
        res = detect_anomalies(X, m.period, **params)
        evs = anomaly_events(res, T, m.variable.get("unit", ""))
        al = {a["id"]: a for a in self.alerts(monitor)}
        touched = []
        for e in evs:
            aid = "al-" + _sha([monitor, e["type"], str(e["t_start"])])[:12]
            ev = {k: e[k] for k in e if k not in ("severity",)}
            ev["method"] = {"detector": e["type"], "z_alarm": res.params["z_alarm"], "cusum_h": res.params["cusum_h"], "phi": round(res.phi, 3)}
            if aid not in al:
                al[aid] = {"id": aid, "monitor": monitor, "entity": m.entity.get("id"), "entity_status": m.entity.get("status"),
                           "variable": m.variable.get("name"), "type": e["type"], "severity": e["severity"], "state": "abierta",
                           "opened_at": self.clock(), "evidence": ev, "evidence_level": "observacion", "origin": "HORI",
                           "simulated": m.entity.get("status") == "simulada", "note": {"es": NOTE_ES, "en": NOTE_EN}, "history": []}
                with db.tx(self.con):
                    self._put_alert(al[aid])
                    db.audit(self.con, self.clock(), actor, "alerta_abierta", aid, {"type": e["type"], "t_start": e["t_start"], "severity": e["severity"]})
                touched.append(al[aid])
            elif al[aid]["evidence"].get("end") != e["end"] or al[aid]["severity"] != e["severity"]:
                if al[aid]["state"] != "cerrada":
                    al[aid]["evidence"], al[aid]["severity"] = ev, e["severity"]
                    with db.tx(self.con):
                        self._put_alert(al[aid])
                        db.audit(self.con, self.clock(), actor, "alerta_actualizada", aid, {"end": e["end"], "severity": e["severity"]})
                    touched.append(al[aid])
        return touched

    def open_swarm_alerts(self, monitor: str, signals: list[dict], min_level: str = "senal_ciudadana", actor: str = "sistema") -> list[dict]:
        """Turn swarm signals at or above `min_level` into alerts of type «enjambre» on a monitor (same lifecycle and audit).
        They stay marked as a NON-VERIFIED source."""
        from hori.swarm import LEVELS
        m = self.monitors().get(monitor)
        if m is None:
            raise MonitorError(f"no monitor {monitor}")
        al, touched = {a["id"]: a for a in self.alerts(monitor)}, []
        for sgn in signals:
            if LEVELS.index(sgn["level"]) < LEVELS.index(min_level):
                continue
            aid = "al-" + _sha([monitor, "enjambre", sgn["theme"], sgn["t_start"], round(sgn["lat"], 1), round(sgn["lon"], 1)])[:12]
            ev = {k: sgn[k] for k in ("theme", "level", "score", "independent_reporters", "evidence_items", "direction", "lat", "lon",
                                      "t_start", "t_end", "flags", "reasons", "reports", "instrument")}
            sev = {"corroborada_por_instrumento": "alta", "senal_con_evidencia": "media"}.get(sgn["level"], "leve")
            if aid not in al:
                al[aid] = {"id": aid, "monitor": monitor, "entity": m.entity.get("id"), "entity_status": m.entity.get("status"),
                           "variable": f"enjambre:{sgn['theme']}", "type": "enjambre", "severity": sev, "state": "abierta",
                           "opened_at": self.clock(), "evidence": ev, "evidence_level": sgn["evidence_level"],
                           "origin": "enjambre (fuente no verificada), clasificado por HORI", "source_class": "no_verificada",
                           "simulated": sgn.get("simulated", False), "note": {"es": sgn["note_es"], "en": NOTE_EN}, "history": []}
                with db.tx(self.con):
                    self._put_alert(al[aid])
                    db.audit(self.con, self.clock(), actor, "alerta_abierta", aid, {"type": "enjambre", "level": sgn["level"], "theme": sgn["theme"]})
                touched.append(al[aid])
            elif al[aid]["evidence"]["level"] != sgn["level"] and al[aid]["state"] != "cerrada":
                al[aid]["evidence"], al[aid]["severity"] = ev, sev
                with db.tx(self.con):
                    self._put_alert(al[aid])
                    db.audit(self.con, self.clock(), actor, "alerta_actualizada", aid, {"level": sgn["level"]})
                touched.append(al[aid])
        return touched

    # ------------------------------------------------------------ lifecycle
    def transition(self, alert_id: str, to: str, *, actor: str, note: str = "", at: str | None = None) -> dict:
        with db.tx(self.con):                                          # read-check-write under one lock: no lost updates
            return self._transition(alert_id, to, actor=actor, note=note, at=at)

    def _transition(self, alert_id, to, *, actor, note, at):
        a = self.alert(alert_id)
        if a is None:
            raise MonitorError(f"no alert {alert_id}")
        if to not in STATES:
            raise MonitorError(f"state must be one of {STATES}")
        if to not in TRANSITIONS[a["state"]]:
            raise MonitorError(f"{a['state']} -> {to} is not allowed (allowed: {TRANSITIONS[a['state']] or 'none, it is closed'})")
        if not actor or actor == "sistema":
            raise MonitorError("a person (or named agent) must own a state change: pass actor")
        a["history"].append({"from": a["state"], "to": to, "actor": actor, "note": note, "at": at or self.clock()})
        a["state"] = to
        self._put_alert(a)
        db.audit(self.con, self.clock(), actor, "alerta_" + to, alert_id, {"note": note, "at": at or self.clock()})
        return a
