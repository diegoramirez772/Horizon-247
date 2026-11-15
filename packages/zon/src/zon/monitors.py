"""Functions 1 and 5 of the idea: persistent MONITORS and ALERTS with a lifecycle and an auditable history.

    store = MonitorStore("data/monitors")
    store.add_monitor(Monitor(id="mon-chihuahua-t2m", entity=..., variable={...}, period=12))
    new = store.ingest("mon-chihuahua-t2m", times, values)        # runs HORI's detectors, opens alerts for NEW events
    store.transition(alert_id, "reconocida", actor="carolina", note="la revisa Diego")

What it keeps (plain files, no database, reproducible):
  monitors.json   the monitors (entity card, variable, period, parameters)
  obs/<id>.json   the observations received so far (times as given + values, null = missing)
  alerts.json     the CURRENT state of every alert
  audit.jsonl     append-only log: every opening, update and transition, chained by SHA-256 (prev_hash -> hash), so any
                  edit of the past is detectable with verify_audit()
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
        (self.root / "obs").mkdir(parents=True, exist_ok=True)
        self.clock = clock or (lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    # ------------------------------------------------------------ files
    def _read(self, name: str, default):
        p = self.root / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default

    def _write(self, name: str, obj) -> None:
        (self.root / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8")

    def monitors(self) -> dict[str, Monitor]:
        return {k: Monitor(**v) for k, v in self._read("monitors.json", {}).items()}

    def alerts(self, monitor: str | None = None, state: str | None = None) -> list[dict]:
        al = self._read("alerts.json", {})
        return [a for a in al.values() if (monitor is None or a["monitor"] == monitor) and (state is None or a["state"] == state)]

    # ------------------------------------------------------------ audit log (hash chain)
    def _audit(self, action: str, alert: str | None, actor: str, data: dict) -> dict:
        p = self.root / "audit.jsonl"
        lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
        prev = json.loads(lines[-1])["hash"] if lines else "0" * 64
        rec = {"seq": len(lines) + 1, "at": self.clock(), "actor": actor, "action": action, "alert": alert, "data": data, "prev_hash": prev}
        rec["hash"] = _sha(rec)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
        return rec

    def verify_audit(self) -> tuple[bool, int]:
        """(chain intact?, records). Any edited, removed or reordered record breaks it."""
        p = self.root / "audit.jsonl"
        prev, n = "0" * 64, 0
        for line in (p.read_text(encoding="utf-8").splitlines() if p.exists() else []):
            rec = json.loads(line)
            h = rec.pop("hash")
            if rec["prev_hash"] != prev or _sha(rec) != h or rec["seq"] != n + 1:
                return False, n
            prev, n = h, n + 1
        return True, n

    # ------------------------------------------------------------ monitors and observations
    def add_monitor(self, m: Monitor, actor: str = "sistema") -> Monitor:
        ms = self._read("monitors.json", {})
        if m.id in ms:
            raise MonitorError(f"monitor {m.id} already exists")
        m.created_at = m.created_at or self.clock()
        ms[m.id] = asdict(m)
        self._write("monitors.json", ms)
        self._audit("monitor_creado", None, actor, {"monitor": m.id, "entity": m.entity.get("id"), "status": m.entity.get("status")})
        return m

    def observations(self, monitor: str) -> tuple[list, np.ndarray]:
        d = self._read(f"obs/{monitor}.json", {"times": [], "values": []})
        return d["times"], np.array([np.nan if v is None else v for v in d["values"]], dtype=float)

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
        self._write(f"obs/{monitor}.json", {"times": T, "values": [None if not np.isfinite(v) else float(v) for v in X]})
        self._audit("observaciones", None, actor, {"monitor": monitor, "n_new": len(times), "n_total": len(T), "last": T[-1] if T else None,
                                                   "firma": sig_status,
                                                   "sha256": _sha({"t": T, "v": [None if not np.isfinite(v) else float(v) for v in X]})})
        params = {k: v for k, v in m.params.items() if k != "require_signature"}
        if "transform" not in params and physical_class(m.variable) == "flujo_de_agua":
            params["transform"] = "sqrt"                                   # rain is skewed: measured 16.8 -> 4.1 alarms per 1000 months
        res = detect_anomalies(X, m.period, **params)
        evs = anomaly_events(res, T, m.variable.get("unit", ""))
        al = self._read("alerts.json", {})
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
                self._audit("alerta_abierta", aid, actor, {"type": e["type"], "t_start": e["t_start"], "severity": e["severity"]})
                touched.append(al[aid])
            elif al[aid]["evidence"].get("end") != e["end"] or al[aid]["severity"] != e["severity"]:
                if al[aid]["state"] != "cerrada":
                    al[aid]["evidence"], al[aid]["severity"] = ev, e["severity"]
                    self._audit("alerta_actualizada", aid, actor, {"end": e["end"], "severity": e["severity"]})
                    touched.append(al[aid])
        self._write("alerts.json", al)
        return touched

    def open_swarm_alerts(self, monitor: str, signals: list[dict], min_level: str = "senal_ciudadana", actor: str = "sistema") -> list[dict]:
        """Turn swarm signals at or above `min_level` into alerts of type «enjambre» on a monitor (same lifecycle and audit).
        They stay marked as a NON-VERIFIED source."""
        from hori.swarm import LEVELS
        m = self.monitors().get(monitor)
        if m is None:
            raise MonitorError(f"no monitor {monitor}")
        al, touched = self._read("alerts.json", {}), []
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
                self._audit("alerta_abierta", aid, actor, {"type": "enjambre", "level": sgn["level"], "theme": sgn["theme"]})
                touched.append(al[aid])
            elif al[aid]["evidence"]["level"] != sgn["level"] and al[aid]["state"] != "cerrada":
                al[aid]["evidence"], al[aid]["severity"] = ev, sev
                self._audit("alerta_actualizada", aid, actor, {"level": sgn["level"]})
                touched.append(al[aid])
        self._write("alerts.json", al)
        return touched

    # ------------------------------------------------------------ lifecycle
    def transition(self, alert_id: str, to: str, *, actor: str, note: str = "") -> dict:
        al = self._read("alerts.json", {})
        a = al.get(alert_id)
        if a is None:
            raise MonitorError(f"no alert {alert_id}")
        if to not in STATES:
            raise MonitorError(f"state must be one of {STATES}")
        if to not in TRANSITIONS[a["state"]]:
            raise MonitorError(f"{a['state']} -> {to} is not allowed (allowed: {TRANSITIONS[a['state']] or 'none, it is closed'})")
        if not actor or actor == "sistema":
            raise MonitorError("a person (or named agent) must own a state change: pass actor")
        a["history"].append({"from": a["state"], "to": to, "actor": actor, "note": note, "at": self.clock()})
        a["state"] = to
        self._write("alerts.json", al)
        self._audit("alerta_" + to, alert_id, actor, {"note": note})
        return a
