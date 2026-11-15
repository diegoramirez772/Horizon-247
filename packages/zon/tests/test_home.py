"""home.json («Mis monitores»): same regional verdict as zon.query, a consistent time machine, stable event ids, JSON-safe."""
import json
import shutil
import tempfile
import unittest

import numpy as np

try:
    from compression import zstd
except ImportError:  # pragma: no cover
    zstd = None

from test_zarr import make_store


@unittest.skipIf(zstd is None, "needs Python 3.14 compression.zstd")
class TestHome(unittest.TestCase):
    def setUp(self):
        try:
            import hori.api  # noqa: F401
        except ImportError:
            self.skipTest("hori not on PYTHONPATH")
        self.tmp = tempfile.mkdtemp()
        make_store(self.tmp, months=216, valid_months=213, noise=0.3, seed=7)      # 18 years; the last 3 months not out yet
        from zon.fetch.power_zarr import PowerZarr
        from zon.places import Place, PlaceIndex
        self.z = PowerZarr(self.tmp, offline=True)
        poly = np.array([[0.9, -1.1], [0.9, 1.1], [3.2, 1.1], [3.2, -1.1], [0.9, -1.1]])
        self.idx = PlaceIndex([Place("xx-test", "admin1", {"es": "Tierra de Prueba", "en": "Test Land"}, "Nowhere", [poly])])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def build(self):
        from zon.home import build_home
        return build_home(["tierra de prueba"], ["T2M"], 1981, 1998, index=self.idx, store=self.z, out_dir=self.tmp)

    def test_same_verdict_as_query_and_consistent_timeline(self):
        from zon.query import query_place
        doc = self.build()
        mon = doc["entities"][0]["monitors"][0]
        f = mon["finding"]
        # only complete years enter the trend: 1998 has 9 months -> window 1981-1997, like query_place over 1981-1997
        self.assertEqual(f["window"], {"start": 1981, "end": 1997})
        q = query_place("tierra de prueba", "T2M", 1981, 1997, index=self.idx, store=self.z)["regional"]
        self.assertEqual(f["verdict"], int(q.verdict[0]))
        self.assertAlmostEqual(f["effect"], float(q.effect[0]), places=4)
        self.assertTrue(mon["timeline"]["consistent"])                     # last growing window == full window
        self.assertEqual(mon["timeline"]["ends"][-1], 1997)
        self.assertEqual(mon["data"]["last_month"], "1998-09")              # monitoring reads up to the last month with data
        self.assertEqual(mon["data"]["n_cells"], 20)

    def test_state_priority_events_and_json(self):
        doc = self.build()
        e = doc["entities"][0]
        self.assertIn(e["state"]["status"], ("atencion", "hallazgos", "vigilando", "sin_novedad"))
        self.assertTrue(all(it["priority"] in ("P0", "P1", "P2", "P3", "P4") for it in e["state"]["priority"]))
        for ev in doc["events"]:
            self.assertIn(ev["tray"], ("evidencia", "calidad", "seguimiento"))
            self.assertTrue(ev["id"].startswith(ev["monitor"] + ":"))
        json.dumps(doc, allow_nan=False)                                   # no NaN/inf can reach the web
        with open(f"{self.tmp}/home.json", encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["kind"], "home")

    def test_deterministic_except_clock(self):
        a, b = self.build(), self.build()
        strip = lambda d: json.dumps(d, sort_keys=True).replace(a["entities"][0]["monitors"][0]["data"]["computed_at"] or "", "")
        b["entities"][0]["monitors"][0]["data"]["computed_at"] = a["entities"][0]["monitors"][0]["data"]["computed_at"]
        self.assertEqual(strip(a), strip(b))
        self.assertEqual([x["id"] for x in a["events"]], [x["id"] for x in b["events"]])   # the web's cursor keys on these


if __name__ == "__main__":
    unittest.main()
