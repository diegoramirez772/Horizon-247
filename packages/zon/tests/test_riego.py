"""zon.riego: the green rule ignores wet-year greening, the floor is the minimum year, the shift has a direction,
and fetch keeps evidence and resumes. No network: the ORNL answer is built here."""
import json
import tempfile
import unittest

import numpy as np

from zon import riego


def answer(a: np.ndarray) -> bytes:
    return json.dumps({"xllcorner": "-10443531.92", "yllcorner": "2794470.65", "cellsize": 231.656358264,
                       "nrows": a.shape[0], "ncols": a.shape[1],
                       "subset": [{"proc_date": "2020070235735", "tile": "h08v06", "data": a.ravel().tolist()}]}).encode()


class GreenRule(unittest.TestCase):
    def test_wet_year_does_not_count_as_irrigation(self):
        pre = np.full((2, 10, 10), 0.18, dtype="float32")
        pre[:, :2] = 0.60                                # 20 irrigated pixels, both years
        pre[1] += 0.25                                   # a wet year: everything greener (desert reaches 0.43)
        g = riego.green_mask(pre, 0.40, 0.20)
        self.assertEqual(g.sum(axis=(1, 2)).tolist(), [20, 20])
        self.assertEqual(int((pre[1] >= 0.40).sum()), 100)   # the plain threshold would have counted the whole scene

    def test_nan_is_never_green(self):
        pre = np.full((1, 4, 4), np.nan, dtype="float32")
        pre[0, 0, 0], pre[0, 1, 1] = 0.7, 0.1
        self.assertEqual(int(riego.green_mask(pre, 0.4, 0.2).sum()), 1)


class Summary(unittest.TestCase):
    def setUp(self):
        self.lat = 25.5 - 0.002 * np.arange(20)
        self.lon = np.broadcast_to(-103.5 + 0.002 * np.arange(20), (20, 20))
        g = np.zeros((10, 20, 20), bool)
        g[:5, :4, :4] = True                             # first years: 16 px in the north-west
        g[5:, 16:, 16:] = True                           # last years: 16 px in the south-east
        g[3, :4, :2] = False                             # one poorer year: 8 px
        self.g, self.years = g, list(range(2001, 2011))

    def test_floor_is_the_minimum_year_and_water_is_hectares_times_depth(self):
        s = riego.summarize(self.years, self.g, 5.0, self.lat, self.lon, depths_m={"low": 0.5, "high": 1.5})
        self.assertEqual((s["floor_ha"], s["floor_year"]), (40, 2004))
        self.assertEqual(s["floor_water_hm3"], {"low": 0.2, "high": 0.6})   # 40 ha x 0.5 m = 0.2 hm3
        self.assertEqual((s["new_ha"], s["lost_ha"]), (80, 80))

    def test_shift_points_south_east(self):
        s = riego.summarize(self.years, self.g, 5.0, self.lat, self.lon)["shift"]
        self.assertTrue(90 < s["bearing_deg"] < 180)
        self.assertGreater(s["km"], 3)

    def test_inside_restricts_every_count(self):
        inside = np.zeros((20, 20), bool)
        inside[:10] = True                               # only the north half
        s = riego.summarize(self.years, self.g, 5.0, self.lat, self.lon, inside=inside)
        self.assertEqual((s["new_ha"], s["lost_ha"], s["floor_ha"]), (0, 80, 0))


class Fetch(unittest.TestCase):
    def test_evidence_and_resume(self):
        calls = []
        a = np.array([[1000, -3000], [6000, 2000]], dtype=np.int16)

        def opener(url):
            calls.append(url)
            if "A2002081" in url and len(calls) < 99 and not getattr(opener, "ok", False):
                raise OSError("down")
            return answer(a)
        with tempfile.TemporaryDirectory() as d:
            ev = riego.fetch(25.55, -103.5, 50, 65, [2001, 2002], d, doys=(65, 81), opener=opener)
            self.assertIn("error", ev["2002081"])
            self.assertEqual(len(ev["2001065"]["sha256"]), 64)
            n = len(calls)
            opener.ok = True
            ev = riego.fetch(25.55, -103.5, 50, 65, [2001, 2002], d, doys=(65, 81), opener=opener)
            self.assertEqual(len(calls), n + 1)          # only the failed date is asked again
            data = riego.load(d)
            self.assertTrue(np.isnan(data["ndvi"][2001][65][0, 1]))      # fill -> NaN
            self.assertAlmostEqual(float(data["ndvi"][2001][65][1, 0]), 0.6, places=5)
            years, pre = riego.window_mean(data["ndvi"], (65, 81))
            self.assertEqual(years, [2001, 2002])
            self.assertAlmostEqual(data["ha"], 5.3665, places=3)

    def test_box_limit(self):
        with self.assertRaises(riego.RiegoError):
            riego.fetch(0, 0, 150, 50, [2001], tempfile.mkdtemp())


if __name__ == "__main__":
    unittest.main()
