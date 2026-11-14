"""A fake NASA POWER server for tests: same JSON shape, deterministic values, injectable failures."""
from __future__ import annotations

import datetime as dt
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class FakePower:
    def __init__(self, dlat=0.5, dlon=0.625, interpolate=False, cutoff_yyyymm=None):
        self.dlat, self.dlon, self.interpolate, self.cutoff = dlat, dlon, interpolate, cutoff_yyyymm
        self.hits = 0
        self.log = []
        self.fail_plan = []          # list of (status, retry_after) consumed one per hit
        self.missing = set()         # time keys that are returned as fill values
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                outer.hits += 1
                u = urlparse(self.path)
                outer.log.append(self.path)
                if outer.fail_plan:
                    status, ra = outer.fail_plan.pop(0)
                    if status != 200:
                        self.send_response(status)
                        if ra is not None:
                            self.send_header("Retry-After", str(ra))
                        self.end_headers()
                        self.wfile.write(b"{}")
                        return
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                params = q["parameters"].split(",")
                if "BAD" in params:
                    self.send_response(422)
                    self.end_headers()
                    self.wfile.write(json.dumps({"messages": ["Parameter BAD is not valid"]}).encode())
                    return
                body = json.dumps(outer.make(u.path, q, params)).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/api/temporal"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.server.shutdown()
        self.server.server_close()

    # -- the fake world
    def cell(self, lat, lon):
        if self.interpolate:
            return lat, lon
        return round((lat + 90) / self.dlat), round((lon + 180) / self.dlon)

    def make(self, path, q, params):
        lat, lon = float(q["latitude"]), float(q["longitude"])
        ci, cj = self.cell(lat, lon)
        level = "monthly" if "/monthly/" in path else "daily"
        keys = []
        if level == "monthly":
            for y in range(int(q["start"]), int(q["end"]) + 1):
                keys += [f"{y}{m:02d}" for m in range(1, 14)]
        else:
            d, e = dt.datetime.strptime(q["start"], "%Y%m%d"), dt.datetime.strptime(q["end"], "%Y%m%d")
            while d <= e:
                keys.append(d.strftime("%Y%m%d"))
                d += dt.timedelta(days=1)
        par = {}
        for pi, p in enumerate(params):
            vals = {}
            for n, k in enumerate(keys):
                missing = k in self.missing or (self.cutoff and level == "monthly" and int(k[:6]) > self.cutoff and not k.endswith("13"))
                vals[k] = -999.0 if missing else round(10 + ci * 0.01 + cj * 0.001 + n * 0.1 + pi, 3)
            par[p] = vals
        return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat, 1000.0 + (ci if not self.interpolate else 0)]},
                "properties": {"parameter": par},
                "header": {"title": "fake", "api": {"version": "v2.10.0", "name": "fake"}, "sources": ["MERRA2"], "fill_value": -999.0,
                           "time_standard": "LST", "start": q["start"], "end": q["end"]},
                "messages": [], "parameters": {p: {"units": "C", "longname": p} for p in params}}
