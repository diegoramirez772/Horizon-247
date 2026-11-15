"""Function 5, the part that reaches people: notices, escalation and continuous watching.

    sinks = [FileSink("data/monitors/bandeja.jsonl"), WebhookSink("https://...", secret=b"...")]
    policy = EscalationPolicy(levels=[["carolina"], ["diego"]], ack_minutes={"alta": 30, "media": 240, "leve": None})
    sent = notify_and_escalate(store, sinks, policy, now="2026-11-15T10:00:00Z")
    watch(store, sources, sinks, policy, every_s=3600)            # the loop; use once=True from cron / a systemd timer

Rules (explicit, auditable):
  * every NEW open alert is sent once to level 0 (its id is remembered in the audit, so a restart never re-sends);
  * if an alert with an acknowledgement deadline (by severity) is still «abierta» after the deadline, it is escalated
    to the next level, once per level; «leve» has no deadline (it waits in the inbox);
  * an alert from a SIMULATED entity says so in the subject; every notice carries the H12 note and the evidence;
  * nothing here changes an alert's state: only a named person does (zon.monitors.transition).
Webhooks are signed with HMAC-SHA256 (header X-Horizon-Signature) so the receiver can check they came from us.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path


class FileSink:
    """An inbox file (one JSON per line): what a desktop app, a bot or a person can read."""

    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def send(self, msg: dict) -> str:
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(msg, ensure_ascii=False) + "\n")
        return f"archivo:{self.path.name}"


class WebhookSink:
    """POST JSON to a URL (Slack/Teams/own service). Signed with HMAC-SHA256 over the body."""

    def __init__(self, url: str, secret: bytes, timeout: float = 10.0, opener=None):
        self.url, self.secret, self.timeout = url, secret, timeout
        self.opener = opener or urllib.request.urlopen

    def send(self, msg: dict) -> str:
        body = json.dumps(msg, ensure_ascii=False).encode()
        sig = hmac.new(self.secret, body, hashlib.sha256).hexdigest()
        req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json", "X-Horizon-Signature": sig})
        with self.opener(req, timeout=self.timeout) as r:
            return f"webhook:{getattr(r, 'status', 200)}"


@dataclass
class EscalationPolicy:
    levels: list                                   # [[people of level 0], [level 1], ...]
    ack_minutes: dict = field(default_factory=lambda: {"alta": 30, "media": 240, "leve": None})


def _t(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def _message(a: dict, level: int, to: list, kind: str) -> dict:
    ev = a.get("evidence", {})
    sim = " [SIMULADO]" if a.get("simulated") else ""
    what = ev.get("theme") and f"enjambre «{ev['theme']}» ({ev.get('level')})" or f"{a['type']} en {a['variable']}"
    return {"kind": kind, "alert": a["id"], "to": to, "level": level, "severity": a["severity"],
            "subject": f"[{a['severity'].upper()}]{sim} {a['entity']}: {what} ({ev.get('t_start')} → {ev.get('t_end')})",
            "evidence": ev, "origin": a.get("origin"), "evidence_level": a.get("evidence_level"),
            "note": a.get("note", {}).get("es"), "state": a["state"]}


def notify_and_escalate(store, sinks: list, policy: EscalationPolicy, now: str | None = None) -> list[dict]:
    """One pass: send new alerts to level 0 and escalate overdue ones. Returns what was sent. Idempotent per alert/level."""
    now = now or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    done = set()
    for r in store.audit_records():
        if r["action"] in ("aviso_enviado", "escalada"):
            done.add((r["alert"], r["data"]["level"]))
    sent = []
    for a in store.alerts():
        if a["state"] == "cerrada":
            continue
        targets = []
        if (a["id"], 0) not in done:
            targets.append((0, "aviso_enviado"))
        lim = policy.ack_minutes.get(a["severity"])
        if a["state"] == "abierta" and lim is not None:
            overdue = (_t(now) - _t(a["opened_at"])).total_seconds() / 60.0
            for lvl in range(1, len(policy.levels)):
                if overdue >= lim * lvl and (a["id"], lvl) not in done:
                    targets.append((lvl, "escalada"))
        for lvl, kind in targets:
            if lvl >= len(policy.levels):
                continue
            msg = _message(a, lvl, policy.levels[lvl], kind)
            receipts = []
            for s in sinks:
                try:
                    receipts.append(s.send(msg))
                except Exception as e:                                # a broken channel must not stop the others
                    receipts.append(f"error:{type(e).__name__}")
            store._audit(kind, a["id"], "sistema", {"level": lvl, "to": policy.levels[lvl], "receipts": receipts, "at": now})
            sent.append(msg)
    return sent


def watch(store, sources: list, sinks: list, policy: EscalationPolicy, *, every_s: float = 3600, once: bool = False,
          clock=None, sleep=time.sleep, max_ticks: int | None = None) -> list[dict]:
    """Continuous watching: each tick asks every source for NEW observations, ingests them, then notifies/escalates.

    A source is a callable(last_time_or_None) -> (monitor_id, times, values) with only the new samples (or empty lists).
    Run it under systemd/cron with once=True, or as a loop. Returns a log of ticks."""
    log, ticks = [], 0
    while True:
        now = (clock or (lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())))()
        tick = {"at": now, "ingested": {}, "sent": 0, "errors": []}
        for src in sources:
            try:
                mid, times, values = src(store)
                if times:
                    store.ingest(mid, times, values)
                    tick["ingested"][mid] = len(times)
            except Exception as e:
                tick["errors"].append(f"{getattr(src, '__name__', 'fuente')}: {type(e).__name__}: {e}")
        tick["sent"] = len(notify_and_escalate(store, sinks, policy, now))
        log.append(tick)
        ticks += 1
        if once or (max_ticks is not None and ticks >= max_ticks):
            return log
        sleep(every_s)


def power_place_source(monitor_id: str, place: str, var: str, start: int, *, index, store=None):
    """A watch source: the monthly regional series of a place from NASA POWER, returning only months not yet ingested."""
    from .fetch.power_zarr import PowerZarr
    from .query import place_series

    def src(mstore):
        last = (mstore.observations(monitor_id)[0] or [None])[-1]
        z = store or PowerZarr(refresh=True)
        s = place_series(place, var, start, int(time.strftime("%Y")), index=index, store=z)
        new = [(m, v) for m, v in zip(s["months"], s["values"]) if last is None or m > last]
        return monitor_id, [m for m, _ in new], [v for _, v in new]
    src.__name__ = f"power:{place}:{var}"
    return src


def fauna_source(monitor_id: str, box, group: str, *, start: str = "2012-01-01", get=None):
    """A watch source: the monthly reporting rate of an animal group in a box (iNaturalist), only months not yet ingested.
    One pair of HTTP requests per tick; run it daily (observations keep arriving for days)."""
    from .connectors import FaunaRate

    con = FaunaRate(box, group, start, get=get)

    def src(mstore):
        last = (mstore.observations(monitor_id)[0] or [None])[-1]
        r = con.fetch(since=last)
        return monitor_id, r["times"], [math.nan if v is None else v for v in r["values"]]
    src.__name__ = f"fauna:{group}:{','.join(f'{x:.2f}' for x in box)}"
    return src


def fauna_monitor(monitor_id: str, box, group: str):
    """The monitor of an animal reporting rate (monthly, period 12, square-root transform: low rates are skewed)."""
    from hori.api import Entity

    from .fetch.fauna import GROUPS
    from .monitors import Monitor
    g = GROUPS[group]
    ent = Entity(f"fauna-{group}-" + "_".join(f"{x:.2f}" for x in box), "region", "earth",
                 {"es": f"{g['es']} · {box[1]:.1f}…{box[3]:.1f}°, {box[0]:.1f}…{box[2]:.1f}°", "en": f"{g['en']} · {box[1]:.1f}…{box[3]:.1f}°, {box[0]:.1f}…{box[2]:.1f}°"},
                 "real", source={"name": "iNaturalist", "kind": "ciencia ciudadana"},
                 geometry={"type": "bbox", "bbox": [box[1], box[0], box[3], box[2]]}).to_dict()
    return Monitor(monitor_id, ent, {"name": f"tasa_reporte_{group}", "unit": "por 1000 obs", "long_name": f"Tasa de reporte de {g['es'].lower()}"},
                   12, cadence="mensual", params={"transform": "sqrt"})
