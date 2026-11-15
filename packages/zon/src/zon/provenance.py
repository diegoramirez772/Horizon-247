"""Provenance: sha256, size and download time of every source file."""
from __future__ import annotations
import datetime as _dt
import hashlib
import os


def sha256_of(path: str, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def now_utc() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def file_record(path: str, downloaded_at: str | None = None) -> dict:
    return {"sha256": sha256_of(path), "size_bytes": os.path.getsize(path),
            "downloaded_at": downloaded_at or _mtime(path)}


def _mtime(path: str) -> str:
    t = _dt.datetime.fromtimestamp(os.path.getmtime(path), _dt.timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")
