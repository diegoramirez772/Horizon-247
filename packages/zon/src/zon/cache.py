"""Content-addressed, integrity-checked response cache.

Why: public science APIs ask clients not to repeat the same request. With this cache a given URL is fetched
once; later runs (and offline demos) read the stored bytes. Each entry records when and how it was fetched.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path


class CacheMiss(Exception):
    """Offline mode was requested but the entry is not cached."""


@dataclass
class CacheEntry:
    body: bytes
    sha256: str
    fetched_at: float
    meta: dict
    from_cache: bool = True


class ContentCache:
    def __init__(self, root: str | Path, ttl_seconds: float | None = None, offline: bool = False, clock=time.time):
        self.root = Path(root)
        self.ttl, self.offline, self._clock = ttl_seconds, offline, clock

    @staticmethod
    def key(url: str) -> str:
        return hashlib.sha256(url.encode("utf-8")).hexdigest()

    def _paths(self, source: str, key: str) -> tuple[Path, Path]:
        d = self.root / source / key[:2]
        return d / f"{key}.body", d / f"{key}.meta.json"

    def get(self, source: str, url: str, ttl_seconds: float | None = None) -> CacheEntry | None:
        body_p, meta_p = self._paths(source, self.key(url))
        if not (body_p.exists() and meta_p.exists()):
            return None
        try:
            meta = json.loads(meta_p.read_text(encoding="utf-8"))
            body = body_p.read_bytes()
        except (OSError, ValueError):
            return None
        if hashlib.sha256(body).hexdigest() != meta.get("sha256"):
            return None                                   # corrupt entry: treat as a miss and refetch
        ttl = self.ttl if ttl_seconds is None else ttl_seconds
        if ttl is not None and not self.offline and self._clock() - meta["fetched_at"] > ttl:
            return None
        return CacheEntry(body, meta["sha256"], meta["fetched_at"], meta)

    def put(self, source: str, url: str, body: bytes, extra: dict | None = None) -> CacheEntry:
        key = self.key(url)
        body_p, meta_p = self._paths(source, key)
        body_p.parent.mkdir(parents=True, exist_ok=True)
        meta = {"url": url, "sha256": hashlib.sha256(body).hexdigest(), "fetched_at": self._clock(), **(extra or {})}
        for path, data in ((body_p, body), (meta_p, json.dumps(meta).encode("utf-8"))):
            fd, tmp = tempfile.mkstemp(dir=path.parent)
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp, path)                         # atomic: no half-written entries
        return CacheEntry(body, meta["sha256"], meta["fetched_at"], meta, from_cache=False)
