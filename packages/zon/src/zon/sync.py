"""Work offline, catch up when the network comes back (laptop in the field <-> server), without losing or duplicating.

    ops = export_ops(laptop_store, laptop_swarm, since=cursor)      # what happened here after `cursor`
    report = apply_ops(server_store, server_swarm, ops)              # idempotent: applying twice changes nothing

Why it can be simple and still correct:
  * observations are keyed by (monitor, time): a time already present is skipped; one earlier than the last stored is a
    CONFLICT (reported, never forced in);
  * alerts are DERIVED (same data -> same alert ids), so they are not copied: re-ingesting regenerates them;
  * a person's alert transition is an operation with an id (alert, to, actor, time); it is applied only if it is still legal
    there, otherwise it is reported as a conflict for a human;
  * swarm reports have ids and signed attestations are re-verified on arrival against the server's own trust registry.
"""
from __future__ import annotations

import json

import numpy as np

from . import db
from .monitors import Monitor, MonitorError


def export_ops(store, swarm=None, since: dict | None = None) -> dict:
    since = since or {"audit": 0, "reports": 0}
    recs = store.audit_records(since.get("audit", 0))
    mons = {r["data"]["monitor"] for r in recs if r["action"] in ("monitor_creado", "observaciones")}
    ops = {"monitors": [], "observations": [], "transitions": [], "reports": [],
           "cursor": {"audit": recs[-1]["seq"] if recs else since.get("audit", 0)}}
    all_m = store.monitors()
    for mid in sorted(mons & set(all_m)):
        ops["monitors"].append({"doc": all_m[mid].__dict__, "org": store.monitor_org(mid)})
        t, v = store.observations(mid)
        ops["observations"].append({"monitor": mid, "times": t, "values": [None if not np.isfinite(x) else float(x) for x in v]})
    for r in recs:
        if r["action"].startswith("alerta_") and r["action"] not in ("alerta_abierta", "alerta_actualizada"):
            ops["transitions"].append({"alert": r["alert"], "to": r["action"][len("alerta_"):], "actor": r["actor"],
                                       "note": r["data"].get("note", ""), "at": r["data"].get("at", r["at"])})
    if swarm is not None:
        rows = swarm.con.execute("SELECT seq, doc FROM reports WHERE seq > ? ORDER BY seq", (since.get("reports", 0),)).fetchall()
        ops["reports"] = [json.loads(r["doc"]) for r in rows]
        ops["cursor"]["reports"] = rows[-1]["seq"] if rows else since.get("reports", 0)
    return ops


def apply_ops(store, swarm, ops: dict, actor: str = "sync") -> dict:
    rep = {"monitors_created": 0, "observations_added": 0, "observations_skipped": 0, "transitions_applied": 0,
           "reports_added": 0, "conflicts": []}
    have = store.monitors()
    for m in ops.get("monitors", []):
        if m["doc"]["id"] not in have:
            store.add_monitor(Monitor(**m["doc"]), actor=actor, org=m.get("org") or "publica")
            rep["monitors_created"] += 1
    for o in ops.get("observations", []):
        t0, _ = store.observations(o["monitor"])
        last = t0[-1] if t0 else None
        known = set(t0)
        new = [(t, v) for t, v in zip(o["times"], o["values"]) if t not in known]
        rep["observations_skipped"] += len(o["times"]) - len(new)
        early = [t for t, _ in new if last is not None and t <= last]
        if early:
            rep["conflicts"].append({"monitor": o["monitor"], "kind": "observaciones_anteriores", "times": early[:5], "n": len(early)})
            new = [(t, v) for t, v in new if last is None or t > last]
        if new:
            store.ingest(o["monitor"], [t for t, _ in new], [np.nan if v is None else v for _, v in new], actor=actor)
            rep["observations_added"] += len(new)
    for tr in ops.get("transitions", []):
        op_id = db.sha([tr["alert"], tr["to"], tr["actor"], tr["at"]])
        if store.con.execute("SELECT 1 FROM sync_seen WHERE op_id = ?", (op_id,)).fetchone():
            continue
        a = store.alert(tr["alert"])
        try:
            if a is None:
                raise MonitorError("la alerta no existe aquí (¿faltan observaciones?)")
            store.transition(tr["alert"], tr["to"], actor=tr["actor"], note=tr["note"], at=tr["at"])
            rep["transitions_applied"] += 1
        except MonitorError as e:
            rep["conflicts"].append({"alert": tr["alert"], "kind": "transicion", "to": tr["to"], "actor": tr["actor"], "reason": str(e)})
        with db.tx(store.con):
            store.con.execute("INSERT OR IGNORE INTO sync_seen VALUES (?, ?)", (op_id, store.clock()))
    if swarm is not None:
        known = {r["id"] for r in swarm.reports()}
        for r in ops.get("reports", []):
            if r["id"] in known:
                continue
            raw = {k: r[k] for k in ("id", "lat", "lon", "time", "text", "kind", "evidence", "simulated") if k in r}
            raw["reporter"] = {k: v for k, v in r["reporter"].items() if k in ("id", "type")}
            if r.get("attestation"):
                raw["attestation"] = r["attestation"]                    # re-verified HERE with this side's trust registry
            swarm.add_report(raw)
            rep["reports_added"] += 1
    return rep
