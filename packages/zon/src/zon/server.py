"""ZON's API: HTTP + JSON, and live events by Server-Sent Events (SSE). Standard library only.

    python -m zon serve --root data/zon --port 8247 [--bundles data/bundles]

    GET  /health                         runtime alive + each source's health          (public)
    GET  /metrics                        Prometheus text format                          (public)
    GET  /monitors                       monitors you can see                            (lector)
    GET  /monitors/{id}/observations     ?since=<time>                                   (lector)
    GET  /alerts                         ?state=&monitor=                                (lector)
    GET  /entities/{id}/state            the six answers + ONE priority list            (lector)
    GET  /swarm/signals                  swarm signals scored by HORI                    (lector)
    GET  /audit                          ?since=<seq>  the chain, and whether it is intact (lector)
    GET  /events                         SSE: every new audit record, live; resumes with Last-Event-ID (lector)
    GET  /bundles/<path>                 static bundles for the web (public, read-only)
    POST /monitors/{id}/observations     {times, values, signed?}                        (operador)
    POST /reports                        a swarm report {reporter, lat, lon, time, text, evidence?, attestation?}  (operador)
    POST /alerts/{id}/transition         {to, note}  -> the key's name is the actor      (operador)
    POST /monitors                       {id, entity, variable, period, ...}             (admin)
Auth: header «Authorization: Bearer <key>» (zon.auth). A key only sees its organisations' monitors. Bodies > 5 MB are refused.
`Api.handle()` is the whole logic (testable without sockets); `serve()` only wraps it in a ThreadingHTTPServer.
"""
from __future__ import annotations

import json
import mimetypes
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import numpy as np

from . import auth, db
from .connectors import health_report
from .monitors import Monitor, MonitorError, MonitorStore
from .swarm import SwarmError, SwarmStore

MAX_BODY = 5 * 1024 * 1024


class Api:
    def __init__(self, root, bundles: str | None = None, clock=None):
        self.store = MonitorStore(root, clock=clock)
        self.swarm = SwarmStore(Path(root) / "enjambre", clock=clock)
        self.con = self.store.con
        self.bundles = Path(bundles).resolve() if bundles else None
        self.clock = self.store.clock
        self.started = time.time()

    # ---------------------------------------------------------------- helpers
    def _who(self, headers):
        h = headers.get("Authorization") or headers.get("authorization") or ""
        return auth.check_key(self.con, h[7:].strip() if h.lower().startswith("bearer ") else None)

    @staticmethod
    def _j(status, obj):
        return status, {"Content-Type": "application/json; charset=utf-8"}, json.dumps(obj, ensure_ascii=False, default=str).encode()

    def _visible(self, who) -> dict:
        return {k: m for k, m in self.store.monitors().items() if auth.allowed(who, "leer", self.store.monitor_org(k))}

    def entity_view(self, entity_id: str, who, recent_from: str | None = None) -> dict:
        from hori.api import entity_state
        mons = {k: m for k, m in self._visible(who).items() if m.entity.get("id") == entity_id}
        if not mons:
            return None
        ent = next(iter(mons.values())).entity
        anomalies, swarm, alerts = [], [], []
        for mid in mons:
            for a in self.store.alerts(mid):
                alerts.append(a)
                ev = a["evidence"]
                if a["type"] == "enjambre":
                    swarm.append({**ev, "score": ev.get("score", 0), "evidence_level": a["evidence_level"], "note_es": a["note"]["es"],
                                  "instrument_variable": (ev.get("instrument") or {}) and "instrumento", "calibration": None})
                else:
                    anomalies.append({**ev, "type": a["type"], "severity": a["severity"], "variable": a["variable"]})
        trends = [m.params["trend"] for m in mons.values() if isinstance(m.params.get("trend"), dict)]
        return entity_state(ent, trends=trends, anomalies=anomalies, swarm=swarm, alerts=alerts, recent_from=recent_from)

    def metrics(self) -> str:
        lines = ["# TYPE zon_up gauge", "zon_up 1", f"zon_uptime_seconds {time.time() - self.started:.0f}"]
        for st in ("abierta", "reconocida", "derivada", "cerrada"):
            n = self.con.execute("SELECT COUNT(*) FROM alerts WHERE state = ?", (st,)).fetchone()[0]
            lines.append(f'zon_alerts{{state="{st}"}} {n}')
        lines.append(f"zon_monitors {self.con.execute('SELECT COUNT(*) FROM monitors').fetchone()[0]}")
        lines.append(f"zon_audit_records {self.con.execute('SELECT COUNT(*) FROM audit').fetchone()[0]}")
        for r in self.con.execute("SELECT state, COUNT(*) n FROM jobs GROUP BY state"):
            lines.append(f'zon_jobs{{state="{r["state"]}"}} {r["n"]}')
        for h in health_report(self.con, self.clock()):
            lines.append(f'zon_source_failures{{source="{h["source"]}"}} {h["failures"]}')
            lines.append(f'zon_source_ok{{source="{h["source"]}"}} {1 if h["status"] == "ok" else 0}')
        return "\n".join(lines) + "\n"

    # ---------------------------------------------------------------- routing
    def handle(self, method: str, url: str, headers: dict, body: bytes = b""):
        u = urlsplit(url)
        parts = [unquote(p) for p in u.path.strip("/").split("/") if p]
        qs = {k: v[-1] for k, v in parse_qs(u.query).items()}
        try:
            if method == "GET" and parts == ["health"]:
                ok, n = self.store.verify_audit()
                return self._j(200, {"status": "ok", "audit_intact": ok, "audit_records": n, "sources": health_report(self.con, self.clock())})
            if method == "GET" and parts == ["metrics"]:
                return 200, {"Content-Type": "text/plain; version=0.0.4"}, self.metrics().encode()
            if method == "GET" and parts[:1] == ["bundles"] and self.bundles:
                f = (self.bundles / "/".join(parts[1:])).resolve()
                if self.bundles not in f.parents and f != self.bundles or not f.is_file():
                    return self._j(404, {"error": "no existe"})
                return 200, {"Content-Type": mimetypes.guess_type(f.name)[0] or "application/octet-stream",
                             "Cache-Control": "public, max-age=3600"}, f.read_bytes()
            who = self._who(headers)
            if who is None:
                return self._j(401, {"error": "falta una llave válida (Authorization: Bearer ...)"})
            if method == "GET":
                if parts == ["monitors"]:
                    return self._j(200, [{**m.__dict__, "org": self.store.monitor_org(k)} for k, m in self._visible(who).items()])
                if len(parts) == 3 and parts[0] == "monitors" and parts[2] == "observations":
                    if parts[1] not in self._visible(who):
                        return self._j(404, {"error": "monitor no encontrado"})
                    t, v = self.store.observations(parts[1])
                    keep = [(a, b) for a, b in zip(t, v) if "since" not in qs or a > qs["since"]]
                    return self._j(200, {"times": [a for a, _ in keep], "values": [None if not np.isfinite(b) else float(b) for _, b in keep]})
                if parts == ["alerts"]:
                    vis = self._visible(who)
                    al = [a for a in self.store.alerts(qs.get("monitor"), qs.get("state")) if a["monitor"] in vis]
                    return self._j(200, al)
                if len(parts) == 3 and parts[0] == "entities" and parts[2] == "state":
                    st = self.entity_view(parts[1], who, qs.get("recent_from"))
                    return self._j(200, st) if st else self._j(404, {"error": "entidad no encontrada"})
                if parts == ["swarm", "signals"]:
                    return self._j(200, self.swarm.signals())
                if parts == ["audit"]:
                    ok, n = self.store.verify_audit()
                    return self._j(200, {"intact": ok, "records": self.store.audit_records(int(qs.get("since", 0)))})
            if method == "POST":
                if len(body) > MAX_BODY:
                    return self._j(413, {"error": "cuerpo demasiado grande"})
                data = json.loads(body or b"{}")
                if len(parts) == 3 and parts[0] == "monitors" and parts[2] == "observations":
                    if not auth.allowed(who, "observar", self.store.monitor_org(parts[1])):
                        return self._j(403, {"error": "sin permiso"})
                    vals = [float("nan") if x is None else float(x) for x in data["values"]]
                    al = self.store.ingest(parts[1], data["times"], vals, actor=who["name"], signed=data.get("signed"))
                    return self._j(200, {"alerts_opened_or_updated": [a["id"] for a in al]})
                if parts == ["reports"]:
                    if not auth.allowed(who, "reportar"):
                        return self._j(403, {"error": "sin permiso"})
                    return self._j(201, self.swarm.add_report(data))
                if len(parts) == 3 and parts[0] == "alerts" and parts[2] == "transition":
                    a = self.store.alert(parts[1])
                    if a is None or not auth.allowed(who, "transicion", self.store.monitor_org(a["monitor"])):
                        return self._j(404 if a is None else 403, {"error": "alerta no encontrada" if a is None else "sin permiso"})
                    return self._j(200, self.store.transition(parts[1], data["to"], actor=who["name"], note=data.get("note", "")))
                if parts == ["monitors"]:
                    if not auth.allowed(who, "crear_monitor", data.get("org", "publica")):
                        return self._j(403, {"error": "sin permiso"})
                    org = data.pop("org", "publica")
                    m = self.store.add_monitor(Monitor(**data), actor=who["name"], org=org)
                    return self._j(201, m.__dict__)
            return self._j(404, {"error": "ruta desconocida"})
        except (MonitorError, SwarmError, KeyError, ValueError, TypeError) as e:
            return self._j(400, {"error": f"{type(e).__name__}: {e}"})

    def events_since(self, seq: int) -> list[dict]:
        return self.store.audit_records(seq)


def serve(root, port: int = 8247, host: str = "127.0.0.1", bundles: str | None = None, cors: str = "*") -> None:
    api = Api(root, bundles)

    class H(BaseHTTPRequestHandler):
        server_version = "ZON/1"

        def _send(self, status, hdrs, body):
            self.send_response(status)
            for k, v in {**hdrs, "Access-Control-Allow-Origin": cors, "Access-Control-Allow-Headers": "Authorization, Content-Type",
                         "Content-Length": str(len(body))}.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self._send(204, {"Access-Control-Allow-Methods": "GET, POST, OPTIONS"}, b"")

        def do_GET(self):
            if urlsplit(self.path).path == "/events":
                who = api._who(self.headers)
                if who is None:
                    return self._send(401, {"Content-Type": "application/json"}, b'{"error":"llave"}')
                self.send_response(200)
                for k, v in {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": cors}.items():
                    self.send_header(k, v)
                self.end_headers()
                seq = int(self.headers.get("Last-Event-ID") or parse_qs(urlsplit(self.path).query).get("since", ["0"])[0])
                try:
                    while True:
                        for rec in api.events_since(seq):
                            seq = rec["seq"]
                            self.wfile.write(f"id: {seq}\nevent: {rec['action']}\ndata: {json.dumps(rec, ensure_ascii=False, default=str)}\n\n".encode())
                        self.wfile.write(b": latido\n\n")
                        self.wfile.flush()
                        time.sleep(1.0)
                except (BrokenPipeError, ConnectionResetError):
                    return
            self._send(*api.handle("GET", self.path, dict(self.headers)))

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                return self._send(413, {"Content-Type": "application/json"}, b'{"error":"demasiado grande"}')
            self._send(*api.handle("POST", self.path, dict(self.headers), self.rfile.read(n)))

        def log_message(self, fmt, *args):
            pass

    httpd = ThreadingHTTPServer((host, port), H)
    print(f"ZON escuchando en http://{host}:{port}  (raíz {root})")
    httpd.serve_forever()
