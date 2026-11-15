"""Job queue and scheduler: work that must not block the API nor take the runtime down when it fails.

    enqueue(con, "ingest_source", {...}, every_s=3600)          # periodic
    run_due(con, HANDLERS, now)                                   # one pass (call it from a loop, cron or a systemd timer)

Each job runs in its OWN process (fork) with a memory ceiling (RLIMIT_AS) and a wall-clock timeout: a connector that hangs
or eats RAM is killed, recorded and retried with exponential backoff (1, 2, 4 ... min, max 1 h); after `max_attempts` it is
«fallido» and stays visible. A periodic job is rescheduled after success. State lives in the jobs table (zon.db).
"""
from __future__ import annotations

import json
import multiprocessing as mp
import resource
import time
import traceback
from datetime import datetime, timedelta, timezone

from . import db


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def enqueue(con, kind: str, args: dict, *, at: str | None = None, every_s: float | None = None, max_attempts: int = 3) -> int:
    at = at or _iso(datetime.now(timezone.utc))
    with db.tx(con):
        cur = con.execute("INSERT INTO jobs (kind, args, next_run, every_s, max_attempts, updated_at) VALUES (?,?,?,?,?,?)",
                          (kind, json.dumps(args, ensure_ascii=False), at, every_s, max_attempts, at))
        return int(cur.lastrowid)


def _child(fn, args, mem_mb, conn):
    try:
        if mem_mb:
            lim = int(mem_mb) * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (lim, lim))
        conn.send(("ok", fn(args)))
    except BaseException as e:                                         # MemoryError included
        conn.send(("error", f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}"))
    finally:
        conn.close()


def run_job(fn, args: dict, *, timeout_s: float = 600, mem_mb: int | None = 1500) -> tuple[str, object]:
    """Run fn(args) in a forked process. Returns ("ok", result) | ("error", text) | ("timeout", text)."""
    parent, child = mp.Pipe(duplex=False)
    p = mp.get_context("fork").Process(target=_child, args=(fn, args, mem_mb, child), daemon=True)
    p.start()
    child.close()
    if parent.poll(timeout_s):
        try:
            res = parent.recv()
        except EOFError:
            res = ("error", f"el proceso terminó sin respuesta (código {p.exitcode})")
    else:
        p.kill()
        res = ("timeout", f"superó {timeout_s} s: se detuvo")
    p.join(5)
    return res


def run_due(con, handlers: dict, now: str | None = None, *, timeout_s: float = 600, mem_mb: int | None = 1500, limit: int = 20) -> list[dict]:
    now = now or _iso(datetime.now(timezone.utc))
    done = []
    rows = con.execute("SELECT * FROM jobs WHERE state = 'pendiente' AND next_run <= ? ORDER BY next_run, id LIMIT ?", (now, limit)).fetchall()
    for j in rows:
        with db.tx(con):
            if con.execute("UPDATE jobs SET state='corriendo', updated_at=? WHERE id=? AND state='pendiente'", (now, j["id"])).rowcount == 0:
                continue                                                # another worker took it
        fn = handlers.get(j["kind"])
        status, out = ("error", f"no hay manejador para {j['kind']!r}") if fn is None else \
            run_job(fn, json.loads(j["args"]), timeout_s=timeout_s, mem_mb=mem_mb)
        attempts = j["attempts"] + (0 if status == "ok" else 1)
        if status == "ok":
            state, nxt = ("pendiente", _iso(_parse(now) + timedelta(seconds=j["every_s"]))) if j["every_s"] else ("hecho", j["next_run"])
            attempts = 0
        elif attempts >= j["max_attempts"]:
            state, nxt = "fallido", j["next_run"]
        else:
            state, nxt = "pendiente", _iso(_parse(now) + timedelta(seconds=min(60 * 2 ** (attempts - 1), 3600)))
        with db.tx(con):
            con.execute("UPDATE jobs SET state=?, attempts=?, next_run=?, last_error=?, last_result=?, updated_at=? WHERE id=?",
                        (state, attempts, nxt, None if status == "ok" else str(out)[:2000],
                         json.dumps(out, ensure_ascii=False, default=str)[:4000] if status == "ok" else None, now, j["id"]))
            db.audit(con, now, "sistema", "trabajo_" + ("ok" if status == "ok" else status), None,
                     {"job": j["id"], "kind": j["kind"], "state": state, "attempts": attempts})
        done.append({"id": j["id"], "kind": j["kind"], "status": status, "state": state, "next_run": nxt})
    return done


def jobs(con, state: str | None = None) -> list[dict]:
    q = "SELECT * FROM jobs" + (" WHERE state = ?" if state else "") + " ORDER BY id"
    return [dict(r) for r in con.execute(q, (state,) if state else ())]
