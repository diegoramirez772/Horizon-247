"""A polite HTTP client: adaptive rate limiting, retries with backoff + jitter, Retry-After support.

Stdlib only (no `requests`), so it installs anywhere. Time and sleep are injectable for fast tests.
"""
from __future__ import annotations

import http.client
import random
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
USER_AGENT = "HORIZON247-ZON/0.0.1 (NASA Space Apps 2026 prototype; polite client)"


class HTTPFailure(Exception):
    """The request kept failing after all retries (network error or retryable status)."""


class HTTPStatusError(Exception):
    """A non-retryable HTTP error (e.g. 400/404/422). Carries status and body for diagnostics."""

    def __init__(self, status: int, body: bytes, url: str):
        self.status, self.body, self.url = status, body, url
        super().__init__(f"HTTP {status} for {url}: {body[:200]!r}")


@dataclass
class HTTPResult:
    status: int
    body: bytes
    headers: dict
    elapsed: float
    attempts: int
    url: str


class RateLimiter:
    """Spaces request start times; slows down when the server pushes back, recovers when it is happy."""

    def __init__(self, min_interval: float = 1.0, max_interval: float = 10.0,
                 clock=time.monotonic, sleep=time.sleep):
        self.base = self.interval = float(min_interval)
        self.max_interval = float(max_interval)
        self._clock, self._sleep = clock, sleep
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> float:
        """Block until this request may start; return the seconds waited."""
        with self._lock:
            now = self._clock()
            start = max(now, self._next)
            self._next = start + self.interval
        delay = start - now
        if delay > 0:
            self._sleep(delay)
        return max(delay, 0.0)

    def penalize(self) -> None:
        with self._lock:
            self.interval = min(self.interval * 1.5, self.max_interval)

    def reward(self) -> None:
        with self._lock:
            self.interval = max(self.base, self.interval * 0.95)


@dataclass
class PoliteHTTP:
    limiter: RateLimiter = field(default_factory=RateLimiter)
    timeout: float = 60.0
    retries: int = 5
    backoff_base: float = 1.5
    backoff_cap: float = 60.0
    user_agent: str = USER_AGENT
    sleep: object = time.sleep
    clock: object = time.monotonic
    rng: random.Random = field(default_factory=random.Random)

    def _backoff(self, attempt: int, retry_after: float | None) -> float:
        wait = min(self.backoff_cap, self.backoff_base * (2 ** attempt)) * (0.5 + self.rng.random() / 2)
        if retry_after is not None:
            wait = max(wait, retry_after)          # the server's own hint always wins
        return min(wait, self.backoff_cap)

    def get(self, url: str) -> HTTPResult:
        last_error = "unknown"
        for attempt in range(self.retries + 1):
            self.limiter.wait()
            t0 = self.clock()
            retry_after = None
            try:
                req = urllib.request.Request(url, headers={"User-Agent": self.user_agent, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body, status, headers = resp.read(), resp.status, dict(resp.headers)
            except urllib.error.HTTPError as e:
                try:
                    body, status, headers = e.read(), e.code, dict(e.headers)
                finally:
                    e.close()
            except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException, OSError) as e:
                last_error = f"{type(e).__name__}: {e}"
                if attempt >= self.retries:
                    break
                self.limiter.penalize()
                self.sleep(self._backoff(attempt, None))
                continue
            elapsed = self.clock() - t0
            if status < 400:
                self.limiter.reward()
                return HTTPResult(status, body, headers, elapsed, attempt + 1, url)
            if status not in RETRY_STATUS:
                raise HTTPStatusError(status, body, url)
            last_error = f"HTTP {status}"
            if attempt >= self.retries:
                break
            ra = headers.get("Retry-After")
            try:
                retry_after = float(ra) if ra is not None else None
            except ValueError:
                retry_after = None
            if status == 429:
                self.limiter.penalize()
            self.sleep(self._backoff(attempt, retry_after))
        raise HTTPFailure(f"giving up on {url} after {self.retries + 1} attempts ({last_error})")
