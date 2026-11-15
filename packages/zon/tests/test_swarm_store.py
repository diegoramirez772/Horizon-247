"""ZON swarm store: privacy rounding, evidence by hash, chained log; regularize; swarm alerts on a monitor."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from zon.monitors import Monitor, MonitorStore, regularize
from zon.swarm import SwarmError, SwarmStore


class TestSwarmStore(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "a.jpg").write_bytes(b"same-photo")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_reports_are_rounded_hashed_chained_and_verified_only_with_a_voucher(self):
        sw = SwarmStore(self.tmp / "s", clock=lambda: "t")
        r = sw.add_report({"reporter": {"id": "u1", "type": "cientifico", "verified": True}, "lat": 24.031234, "lon": -104.65432,
                           "time": "2011-05-01T10:00", "text": "el río se secó"}, evidence=[self.tmp / "a.jpg"])
        self.assertEqual((r["lat"], r["lon"]), (24.03, -104.65))
        self.assertFalse(r["reporter"]["verified"])                                 # «verified» needs verified_by
        self.assertEqual(r["source_class"], "no_verificada")
        sw.add_report({"reporter": {"id": "u2"}, "lat": 24.0, "lon": -104.6, "time": "2011-05-02T10:00", "text": "río seco"},
                      evidence=[self.tmp / "a.jpg"])
        self.assertEqual(len(list((self.tmp / "s" / "evidence").iterdir())), 1)     # same photo stored once
        with self.assertRaises(SwarmError):
            sw.add_report({"reporter": {}, "lat": 0, "lon": 0, "time": "t", "text": "x"})
        self.assertEqual(sw.verify(), (True, 2))
        p = self.tmp / "s" / "reports.jsonl"
        lines = p.read_text().splitlines()
        rec = json.loads(lines[0])
        rec["report"]["text"] = "otra cosa"
        lines[0] = json.dumps(rec, ensure_ascii=False)
        p.write_text("\n".join(lines) + "\n")
        self.assertFalse(sw.verify()[0])

    def test_swarm_signal_becomes_an_alert_marked_unverified(self):
        sw = SwarmStore(self.tmp / "s")
        for i in range(3):
            sw.add_report({"reporter": {"id": f"u{i}"}, "lat": 24.0, "lon": -104.6, "time": f"2011-05-0{i + 1}T10:00",
                           "text": "el río está seco", "simulated": True})
        ms = MonitorStore(self.tmp / "m")
        ms.add_monitor(Monitor("mon-x", {"id": "earth-x", "status": "real"}, {"name": "P", "unit": "mm"}, 12))
        al = ms.open_swarm_alerts("mon-x", sw.signals())
        self.assertEqual(len(al), 1)
        self.assertEqual((al[0]["type"], al[0]["source_class"], al[0]["simulated"]), ("enjambre", "no_verificada", True))
        self.assertEqual(ms.open_swarm_alerts("mon-x", sw.signals()), [])            # same signal: no duplicate

    def test_regularize_keeps_silence_visible(self):
        g, v = regularize(["2026-01-01T00:00", "2026-01-01T00:04", "2026-01-01T00:31"], [1.0, 3.0, 5.0], 10)
        self.assertEqual(g, ["2026-01-01T00:00", "2026-01-01T00:10", "2026-01-01T00:20", "2026-01-01T00:30"])
        self.assertTrue(np.allclose(v[[0, 3]], [2.0, 5.0]) and np.isnan(v[1:3]).all())


if __name__ == "__main__":
    unittest.main()
