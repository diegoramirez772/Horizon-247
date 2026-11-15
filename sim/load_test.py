"""Load test of the ZON API on this machine: real sockets, concurrent clients, reads + writes + live events (SSE).

    PYTHONPATH=packages/zon/src:packages/hori/src python3 sim/load_test.py [clients] [seconds]
Seeds a fresh store (20 monitors with 400 months each), starts the server on 127.0.0.1 (random port) and measures:
  reads   GET /health, /alerts, /monitors/{id}/observations, /entities/{id}/state
  writes  POST /monitors/{id}/observations (one new month at a time, each client its own monitors) -> detectors run on every write
  events  time from a write until the SSE subscriber sees it
At the end: is the audit chain intact and were all writes recorded exactly once?
"""
import json
import shutil
import statistics
import sys
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np

from zon import auth
from zon.monitors import Monitor
from zon.server import Api

N_CLIENTS = int(sys.argv[1]) if len(sys.argv) > 1 else 16
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 20
root = Path("data/loadtest")
shutil.rmtree(root, ignore_errors=True)
api = Api(root)
key = auth.create_key(api.con, "carga", "admin", ["*"])
ENT = {"id": "earth-carga", "type": "region", "body": "earth", "name": {"es": "Carga", "en": "Load"}, "status": "simulada"}
rng = np.random.default_rng(0)
for i in range(20):
    api.store.add_monitor(Monitor(f"mon-{i}", {**ENT, "id": f"earth-carga-{i}"}, {"name": "T", "unit": "C"}, 12))
    x = 5 * np.sin(2 * np.pi * np.arange(400) / 12) + rng.standard_normal(400)
    api.store.ingest(f"mon-{i}", [f"{1900 + k // 12}-{k % 12 + 1:02d}" for k in range(400)], x)
import os, socket, subprocess
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
api.con.close()
# the server runs in ITS OWN process, as in production (clients and server sharing one Python process would fight for the GIL)
srv = subprocess.Popen([sys.executable, "-W", "ignore", "-m", "zon", "serve", "--root", str(root), "--port", str(port), "--workers", os.environ.get("ZON_WORKERS", "2")],
                       env={**os.environ}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
B = f"http://127.0.0.1:{port}"
for _ in range(100):
    try:
        urllib.request.urlopen(B + "/health", timeout=1).read()
        break
    except OSError:
        time.sleep(0.1)
api = Api(root)
H = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def call(method, path, body=None):
    req = urllib.request.Request(B + path, data=None if body is None else json.dumps(body).encode(), headers=H, method=method)
    t = time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()
        return r.status, 1000 * (time.perf_counter() - t)


lat = {"read": [], "write": []}
errors, writes_ok = [], [0]
seen_events = {}
lock = threading.Lock()


def sse():
    req = urllib.request.Request(B + "/events?since=999999999", headers=H)
    req2 = urllib.request.Request(B + "/events", headers={**H, "Last-Event-ID": str(api.store.audit_records()[-1]["seq"])})
    with urllib.request.urlopen(req2, timeout=SECONDS + 30) as r:
        for line in r:
            line = line.decode().strip()
            if line.startswith("data: "):
                rec = json.loads(line[6:])
                if rec["action"] == "observaciones":
                    seen_events[rec["data"]["last"] + rec["data"]["monitor"]] = time.perf_counter()


def client(c):
    mons = [f"mon-{i}" for i in range(20) if i % N_CLIENTS == c % 20] or [f"mon-{c % 20}"]
    month = {m: 400 for m in mons}
    end = time.time() + SECONDS
    k = 0
    while time.time() < end:
        k += 1
        try:
            if k % 4 == 0 and c < 20:                                  # writes: only one writer per monitor (keeps time order)
                m = mons[k % len(mons)]
                n = month[m]
                t = f"{1900 + n // 12}-{n % 12 + 1:02d}"
                sent = time.perf_counter()
                st, ms = call("POST", f"/monitors/{m}/observations", {"times": [t], "values": [float(rng.standard_normal())]})
                with lock:
                    lat["write"].append(ms)
                    writes_ok[0] += 1
                    pending[t + m] = sent
                month[m] = n + 1
            else:
                path = ["/health", "/alerts", f"/monitors/mon-{k % 20}/observations?since=1930-01", f"/entities/earth-carga-{k % 20}/state"][k % 4 - 1 if k % 4 else 0]
                st, ms = call("GET", path)
                with lock:
                    lat["read"].append(ms)
        except Exception as e:
            with lock:
                errors.append(f"{type(e).__name__}: {e}"[:120])


pending = {}
threading.Thread(target=sse, daemon=True).start()
time.sleep(1.0)
t0 = time.time()
ths = [threading.Thread(target=client, args=(c,)) for c in range(N_CLIENTS)]
[t.start() for t in ths]
[t.join() for t in ths]
el = time.time() - t0
time.sleep(2.5)
ev_lat = [1000 * (seen_events[k] - v) for k, v in pending.items() if k in seen_events]
q = lambda a, p: round(float(np.percentile(a, p)), 1) if a else None
ok, n = api.store.verify_audit()
rows = api.con.execute("SELECT COUNT(*) FROM obs").fetchone()[0]
res = {"clients": N_CLIENTS, "seconds": round(el, 1), "requests": len(lat["read"]) + len(lat["write"]),
       "req_per_s": round((len(lat["read"]) + len(lat["write"])) / el, 1),
       "read_ms": {"p50": q(lat["read"], 50), "p95": q(lat["read"], 95), "p99": q(lat["read"], 99)},
       "write_ms": {"n": len(lat["write"]), "p50": q(lat["write"], 50), "p95": q(lat["write"], 95), "p99": q(lat["write"], 99)},
       "sse_event_ms": {"seen": len(ev_lat), "of": len(pending), "p50": q(ev_lat, 50), "p95": q(ev_lat, 95)},
       "errors": len(errors), "error_examples": sorted(set(errors))[:3],
       "audit_intact": ok, "audit_records": n, "observations_stored": rows, "observations_expected": 20 * 400 + writes_ok[0]}
print(json.dumps(res, indent=1, ensure_ascii=False))
Path("data/calibration").mkdir(parents=True, exist_ok=True)
Path("data/calibration/load_test.json").write_text(json.dumps(res, indent=1))
srv.terminate()
srv.wait(10)
