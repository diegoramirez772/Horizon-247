"""Vertical 2: the same HORI core reads Mars. Uses the real files if they were downloaded (data/mars), else skips."""
import unittest
from pathlib import Path

import numpy as np

DATA = Path("data/mars")


@unittest.skipUnless(DATA.exists() and len(list(DATA.glob("dustscenario_MY*.nc"))) >= 10, "Mars files not downloaded (sim/mars_demo.py)")
class TestMars(unittest.TestCase):
    def test_mars_is_a_mars_entity_marked_reconstruction_and_small_n_is_not_called_calibrated(self):
        from hori.api import Config, Cube, run_layer
        from zon.fetch.mars_dust import load_mars_dust
        d = load_mars_dust(DATA)
        a = d["annual"]
        res = run_layer(Cube(a.astype("float32"), np.isfinite(a), np.array([f"{y:04d}-01-01" for y in d["years"]]), d["lat"], d["lon"],
                             d["meta"]), Config(), profile="auto")
        m = res.manifest
        self.assertEqual((m["entity"]["body"], m["entity"]["status"], m["profile"]), ("mars", "real", "mars"))
        self.assertTrue(((res.flags & 16) > 0).all())                         # reconstruction flag on every cell
        self.assertIn("NOT calibrated", m["calibration"]["note"])             # 13 Martian years < 15
        self.assertIn("DELTA_AUTOMATICO", m["profile_spec"]["flags"])         # no physical class for CDOD: delta = 2 sigma
        self.assertTrue(any("AÑOS MARCIANOS" in w for w in m["warnings"]))

    def test_the_2018_global_dust_storm_is_the_strongest_anomaly(self):
        from hori.api import anomaly_events, detect_anomalies
        from zon.fetch.mars_dust import load_mars_dust
        d = load_mars_dust(DATA)
        ev = anomaly_events(detect_anomalies(d["daily_global"], 669), d["daily_labels"])
        top = max(ev, key=lambda e: abs(e.get("peak_z", e.get("mean_z", 0))))
        self.assertTrue(top["t_start"].startswith("MY34"), top)               # MY34 = 2018
        self.assertGreater(abs(top.get("peak_z", top.get("mean_z"))), 20)


if __name__ == "__main__":
    unittest.main()
