"""ZON as a runtime: SQLite store, connectors + health, isolated jobs, keys and roles, the API, offline sync, planet maps."""
import io
import json
import shutil
import tempfile
import time
import unittest
from pathlib import Path

import numpy as np

from hori.api import detect_anomalies, z_last
from zon import auth, db
from zon.connectors import CmrSearch, CsvSeries, HttpJsonSeries, health_report, run_source
from zon.jobs import enqueue, jobs, run_due
from zon.monitors import Monitor, MonitorStore
from zon.server import Api
from zon.swarm import SwarmStore
from zon.sync import apply_ops, export_ops

ENT = {"id": "earth-x", "type": "region", "body": "earth", "name": {"es": "X", "en": "X"}, "status": "real", "source": {"name": "t"}}


def series(n=400, seed=1, spike=None):
    x = 5 * np.sin(2 * np.pi * np.arange(n) / 12) + np.random.default_rng(seed).standard_normal(n)
    if spike:
        x[spike] += 12
    return [f"{1900 + k // 12}-{k % 12 + 1:02d}" for k in range(n)], x


class Resp(io.BytesIO):
    status = 200
    def __enter__(self): return self
    def __exit__(self, *a): return False


def ok_job(args):
    return {"double": args["x"] * 2}


def bad_job(args):
    raise RuntimeError("fuente caída")


def slow_job(args):
    time.sleep(30)


def hog_job(args):
    return len(bytearray(2_000_000_000))                                # 2 GB: must die under the memory ceiling


class TestRuntime(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_connectors_and_health(self):
        f = self.tmp / "s.csv"
        f.write_text("time,value\n2026-01,1.0\n2026-02,\n2026-03,3.5\n")
        c = CsvSeries(str(f))
        out = c.fetch(since="2026-01")
        self.assertEqual(out["times"], ["2026-02", "2026-03"])
        self.assertIsNone(out["values"][0])
        self.assertEqual(len(out["provenance"]["sha256"]), 64)
        h = HttpJsonSeries("http://x", opener=lambda url, timeout: Resp(json.dumps({"times": ["a", "b"], "values": [1, None]}).encode()))
        self.assertEqual(h.fetch()["times"], ["a", "b"])
        g = CmrSearch("GPM_3IMERGM", (20, -110, 30, -100), ("2020-01-01", "2020-12-31"),
                      opener=lambda url, timeout: Resp(json.dumps({"feed": {"entry": [{"id": "G1", "title": "t", "time_start": "2020-01-01",
                                                                                      "links": [{"rel": "http://esipfed.org/ns/fedsearch/1.1/data#", "href": "https://x/g1.h5"}]}]}}).encode()))
        self.assertEqual(g.fetch()["granules"][0]["links"], ["https://x/g1.h5"])
        con = db.connect(self.tmp)
        run_source(con, "csv", lambda: c.fetch(), now="2026-11-15T00:00:00Z")
        for _ in range(3):
            with self.assertRaises(OSError):
                run_source(con, "api", lambda: (_ for _ in ()).throw(OSError("timeout")), now="2026-11-15T00:00:00Z")
        st = {h["source"]: h["status"] for h in health_report(con, "2026-11-15T01:00:00Z")}
        self.assertEqual(st, {"api": "caida", "csv": "ok"})

    def test_jobs_are_isolated_retried_and_rescheduled(self):
        con = db.connect(self.tmp)
        H = {"ok": ok_job, "bad": bad_job, "slow": slow_job, "hog": hog_job}
        enqueue(con, "ok", {"x": 21}, at="2026-01-01T00:00:00Z", every_s=3600)
        enqueue(con, "bad", {}, at="2026-01-01T00:00:00Z", max_attempts=2)
        enqueue(con, "slow", {}, at="2026-01-01T00:00:00Z", max_attempts=1)
        enqueue(con, "hog", {}, at="2026-01-01T00:00:00Z", max_attempts=1)
        r = {d["kind"]: d for d in run_due(con, H, "2026-01-01T00:00:00Z", timeout_s=3, mem_mb=400)}
        self.assertEqual((r["ok"]["status"], r["ok"]["state"], r["ok"]["next_run"]), ("ok", "pendiente", "2026-01-01T01:00:00Z"))
        self.assertEqual((r["bad"]["status"], r["bad"]["state"], r["bad"]["next_run"]), ("error", "pendiente", "2026-01-01T00:01:00Z"))
        self.assertEqual((r["slow"]["status"], r["slow"]["state"]), ("timeout", "fallido"))
        self.assertEqual((r["hog"]["status"], r["hog"]["state"]), ("error", "fallido"))                 # killed by the memory ceiling
        r2 = {d["kind"]: d for d in run_due(con, H, "2026-01-01T00:02:00Z")}
        self.assertEqual(r2["bad"]["state"], "fallido")                                                  # 2 attempts and out
        self.assertEqual(json.loads([j for j in jobs(con) if j["kind"] == "ok"][0]["last_result"]), {"double": 42})

    def test_keys_roles_orgs_and_the_api(self):
        api = Api(self.tmp / "z", bundles=str(self.tmp / "b"), clock=lambda: "2026-11-15T00:00:00Z")
        (self.tmp / "b").mkdir()
        (self.tmp / "b" / "index.json").write_text("[]")
        admin = auth.create_key(api.con, "diego", "admin", ["*"])
        op = auth.create_key(api.con, "carolina", "operador", ["aethra"])
        reader_other = auth.create_key(api.con, "otro", "lector", ["otra-org"])
        H = lambda k: {"Authorization": f"Bearer {k}"}
        self.assertEqual(api.handle("GET", "/monitors", {})[0], 401)
        body = json.dumps({"id": "mon-x", "entity": ENT, "variable": {"name": "T", "unit": "C"}, "period": 12, "org": "aethra"}).encode()
        self.assertEqual(api.handle("POST", "/monitors", H(op), body)[0], 403)                          # operador cannot create
        self.assertEqual(api.handle("POST", "/monitors", H(admin), body)[0], 201)
        t, x = series(spike=390)
        st, _, b = api.handle("POST", "/monitors/mon-x/observations", H(op),
                              json.dumps({"times": t, "values": [float(v) for v in x]}).encode())
        self.assertEqual(st, 200)
        self.assertTrue(json.loads(b)["alerts_opened_or_updated"])
        self.assertEqual(json.loads(api.handle("GET", "/monitors", H(reader_other))[2]), [])            # another org sees nothing
        al = json.loads(api.handle("GET", "/alerts", H(op))[2])
        st, _, b = api.handle("POST", f"/alerts/{al[0]['id']}/transition", H(op), json.dumps({"to": "reconocida", "note": "ok"}).encode())
        self.assertEqual((st, json.loads(b)["history"][0]["actor"]), (200, "carolina"))                 # the key's name is the actor
        state = json.loads(api.handle("GET", "/entities/earth-x/state", H(op))[2])
        self.assertIn(state["status"], ("atencion", "hallazgos", "vigilando", "sin_novedad"))
        self.assertIn("priority", state)
        self.assertTrue(json.loads(api.handle("GET", "/health", {})[2])["audit_intact"])
        self.assertIn(b"zon_alerts", api.handle("GET", "/metrics", {})[2])
        self.assertEqual(api.handle("GET", "/bundles/index.json", {})[0], 200)
        self.assertEqual(api.handle("GET", "/bundles/../z/zon.db", {})[0], 404)                         # no path traversal
        self.assertEqual(api.handle("POST", "/reports", H(op), json.dumps({"reporter": {"id": "u1"}, "lat": 24, "lon": -104,
                                                                           "time": "2011-05-01T10:00", "text": "río seco"}).encode())[0], 201)
        auth.revoke_key(api.con, op)
        self.assertEqual(api.handle("GET", "/alerts", H(op))[0], 401)

    def test_offline_laptop_syncs_to_server_idempotently(self):
        lap, srv = MonitorStore(self.tmp / "lap"), MonitorStore(self.tmp / "srv")
        lsw, ssw = SwarmStore(self.tmp / "lap" / "sw"), SwarmStore(self.tmp / "srv" / "sw")
        lap.add_monitor(Monitor("mon-x", ENT, {"name": "T", "unit": "C"}, 12), org="aethra")
        t, x = series(spike=390)
        lap.ingest("mon-x", t, x)
        aid = lap.alerts()[0]["id"]
        lap.transition(aid, "reconocida", actor="carolina", note="en campo")
        lsw.add_report({"reporter": {"id": "u1"}, "lat": 24, "lon": -104, "time": "2011-05-01T10:00", "text": "río seco"})
        ops = export_ops(lap, lsw)
        r1 = apply_ops(srv, ssw, ops)
        self.assertEqual((r1["monitors_created"], r1["observations_added"], r1["transitions_applied"], r1["reports_added"]), (1, 400, 1, 1))
        self.assertEqual(srv.alert(aid)["state"], "reconocida")                                         # same data -> same alert id
        r2 = apply_ops(srv, ssw, ops)                                                                    # again: nothing changes
        self.assertEqual((r2["observations_added"], r2["transitions_applied"], r2["reports_added"]), (0, 0, 0))
        srv.transition(aid, "cerrada", actor="diego")
        lap.transition(aid, "derivada", actor="carolina")
        r3 = apply_ops(srv, ssw, export_ops(lap, lsw, ops["cursor"] | {"reports": 1}))
        self.assertEqual(r3["conflicts"][0]["kind"], "transicion")                                       # closed there: reported, not forced
        self.assertTrue(srv.verify_audit()[0])

    def test_planet_last_month_z_equals_the_detector(self):
        rng = np.random.default_rng(5)
        X = 5 * np.sin(2 * np.pi * np.arange(300) / 12)[:, None] + rng.standard_normal((300, 25))
        X[100:104, 2] = np.nan
        zl = z_last(X, 12)
        zd = np.array([detect_anomalies(X[:, c], 12).z[-1] for c in range(25)])
        self.assertLess(np.nanmax(np.abs(zl - zd)), 1e-9)


if __name__ == "__main__":
    unittest.main()
