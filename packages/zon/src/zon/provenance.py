"""Provenance: what was requested, when, from where, and the hash of what came back."""
from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import asdict, dataclass, field


@dataclass
class RequestRecord:
    url: str
    status: int
    sha256: str
    fetched_at: float
    from_cache: bool
    elapsed: float = 0.0
    attempts: int = 0


@dataclass
class ProvenanceLog:
    records: list[RequestRecord] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add(self, rec: RequestRecord) -> None:
        with self._lock:
            self.records.append(rec)

    def combined_sha256(self) -> str:
        """One hash that identifies the exact set of responses used (order independent)."""
        parts = sorted(r.sha256 for r in self.records)
        return hashlib.sha256("".join(parts).encode()).hexdigest()

    def summary(self) -> dict:
        n = len(self.records)
        cached = sum(r.from_cache for r in self.records)
        return {"requests": n, "from_cache": cached, "from_network": n - cached,
                "first_fetched_at": min((r.fetched_at for r in self.records), default=None),
                "last_fetched_at": max((r.fetched_at for r in self.records), default=None),
                "sha256": self.combined_sha256()}

    def to_dict(self) -> dict:
        return {**self.summary(), "records": [asdict(r) for r in self.records]}


def iso_utc(ts: float | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts if ts is not None else time.time()))
