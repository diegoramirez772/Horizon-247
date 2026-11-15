"""ZON's storage: ONE SQLite file per installation (standard library, no server), safe for several processes.

    con = connect("data/zon")          # creates data/zon/zon.db with the whole schema

Why SQLite: transactions (an alert and its audit record are written together or not at all), several readers and one
writer at a time without corrupting anything (WAL mode + busy timeout), indexes, and a single file to back up or copy to
a laptop without network. The audit chain lives inside: every write goes through `audit()` inside the SAME transaction,
under an IMMEDIATE lock, so two processes can never fork the chain.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS monitors (id TEXT PRIMARY KEY, org TEXT NOT NULL DEFAULT 'publica', doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS obs (monitor TEXT NOT NULL, i INTEGER NOT NULL, t TEXT NOT NULL, v REAL,
                                PRIMARY KEY (monitor, i));
CREATE UNIQUE INDEX IF NOT EXISTS obs_t ON obs (monitor, t);
CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, monitor TEXT NOT NULL, state TEXT NOT NULL, doc TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS alerts_state ON alerts (state);
CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, at TEXT, actor TEXT, action TEXT, alert TEXT, data TEXT,
                                  prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, seq INTEGER UNIQUE, doc TEXT NOT NULL, prev_hash TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, args TEXT NOT NULL,
                                 state TEXT NOT NULL DEFAULT 'pendiente', attempts INTEGER NOT NULL DEFAULT 0,
                                 max_attempts INTEGER NOT NULL DEFAULT 3, next_run TEXT NOT NULL, every_s REAL,
                                 last_error TEXT, last_result TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs (state, next_run);
CREATE TABLE IF NOT EXISTS health (source TEXT PRIMARY KEY, last_ok TEXT, last_error TEXT, last_error_msg TEXT,
                                   last_data TEXT, failures INTEGER NOT NULL DEFAULT 0, runs INTEGER NOT NULL DEFAULT 0,
                                   last_ms REAL);
CREATE TABLE IF NOT EXISTS keys (key_hash TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, orgs TEXT NOT NULL,
                                 created_at TEXT, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sync_seen (op_id TEXT PRIMARY KEY, at TEXT);
"""


def connect(root: str | Path) -> sqlite3.Connection:
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(root / "zon.db", timeout=30, isolation_level=None, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=30000")
    con.execute("PRAGMA foreign_keys=ON")
    con.executescript(SCHEMA)
    return con


def sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


class tx:
    """`with tx(con): ...` = BEGIN IMMEDIATE ... COMMIT (ROLLBACK on error). Nested use joins the outer transaction."""

    def __init__(self, con):
        self.con, self.own = con, False

    def __enter__(self):
        if not self.con.in_transaction:
            self.con.execute("BEGIN IMMEDIATE")
            self.own = True
        return self.con

    def __exit__(self, et, e, tb):
        if self.own:
            self.con.execute("COMMIT" if et is None else "ROLLBACK")
        return False


def audit(con, at: str, actor: str, action: str, alert: str | None, data: dict) -> dict:
    """Append one record to the chain. Call inside tx(con)."""
    row = con.execute("SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
    seq, prev = (row["seq"] + 1, row["hash"]) if row else (1, "0" * 64)
    rec = {"seq": seq, "at": at, "actor": actor, "action": action, "alert": alert, "data": data, "prev_hash": prev}
    rec["hash"] = sha(rec)
    con.execute("INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)",
                (seq, at, actor, action, alert, json.dumps(data, ensure_ascii=False, default=str), prev, rec["hash"]))
    return rec


def audit_records(con, since: int = 0) -> list[dict]:
    out = []
    for r in con.execute("SELECT * FROM audit WHERE seq > ? ORDER BY seq", (since,)):
        d = dict(r)
        d["data"] = json.loads(d["data"])
        out.append(d)
    return out


def verify_chain(con) -> tuple[bool, int]:
    prev, n = "0" * 64, 0
    for rec in audit_records(con):
        h = rec.pop("hash")
        if rec["prev_hash"] != prev or sha(rec) != h or rec["seq"] != n + 1:
            return False, n
        prev, n = h, n + 1
    return True, n
