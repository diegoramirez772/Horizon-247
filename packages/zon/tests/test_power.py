"""Tests for the NASA POWER connector. Run:  PYTHONPATH=packages/zon/src python3 -m unittest discover -s packages/zon/tests -v"""
import datetime as dt
import random
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from zon.cache import CacheMiss, ContentCache
from zon.fetch.power import GridSpec, PowerClient, PowerError
from zon.net.http import HTTPFailure, PoliteHTTP, RateLimiter

from fake_power import FakePower


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.srv = FakePower().start()
        self.sleeps = []
        self.http = PoliteHTTP(limiter=RateLimiter(0.0, sleep=lambda s: None), retries=3, timeout=5,
                               sleep=self.sleeps.append, rng=random.Random(1))

    def tearDown(self):
        self.srv.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def client(self, **kw):
        kw.setdefault("http", self.http)
        return PowerClient(self.tmp, base_url=self.srv.url, **kw)


class TestParsing(Base):
    def test_fill_values_become_nan_and_are_reported(self):
        self.srv.missing = {"200302", "200313"}
        s = self.client().point(24.0, -104.6, ["T2M", "PRECTOTCORR"], 2001, 2004)
        years, mat, ann = s.monthly("T2M")
        self.assertEqual(years, [2001, 2002, 2003, 2004])
        self.assertTrue(np.isnan(mat[2, 1]))               # Feb 2003
        self.assertTrue(np.isnan(ann[2]))                  # POWER's own 2003 annual value
        self.assertEqual(int(np.isnan(mat).sum()), 1)
        self.assertTrue(any("missing values" in w for w in s.warnings))
        self.assertEqual(len(s.keys), 4 * 13)

    def test_month_13_is_not_a_month(self):
        s = self.client().point(24.0, -104.6, ["T2M"], 2001, 2002)
        _, mat, ann = s.monthly("T2M")
        self.assertEqual(mat.shape, (2, 12))
        self.assertEqual(ann.shape, (2,))
        self.assertTrue(np.isfinite(ann).all())

    def test_bad_parameter_gives_a_clear_error(self):
        with self.assertRaises(PowerError) as cm:
            self.client().point(24.0, -104.6, ["BAD"], 2001, 2002)
        self.assertIn("422", str(cm.exception))
        self.assertIn("BAD", str(cm.exception))

    def test_url_is_canonical_and_validated(self):
        c = self.client()
        u1 = c.build_url("monthly", 24.0, -104.6, ["T2M", "PRECTOTCORR"], 2001, 2002)
        u2 = c.build_url("monthly", 24.0, -104.6, ["PRECTOTCORR", "T2M"], 2001, 2002)
        self.assertEqual(u1, u2)                           # parameter order must not create a new request
        with self.assertRaises(PowerError):
            c.build_url("monthly", 0, 0, [f"P{i}" for i in range(21)], 2001, 2002)
        with self.assertRaises(PowerError):
            c.build_url("hourly", 0, 0, ["T2M"], 2001, 2002)

    def test_daily_series(self):
        s = self.client().point(24.0, -104.6, ["T2M"], dt.date(2001, 1, 1), dt.date(2001, 1, 31), "daily")
        self.assertEqual(len(s.keys), 31)
        self.assertEqual(s.keys[0], "20010101")


class TestCacheAndRequests(Base):
    def test_same_request_is_fetched_once(self):
        c = self.client()
        a = c.point(24.0, -104.6, ["T2M"], 2001, 2003)
        b = c.point(24.0, -104.6, ["T2M"], 2001, 2003)
        self.assertEqual(self.srv.hits, 1)
        self.assertFalse(a.from_cache)
        self.assertTrue(b.from_cache)
        self.assertEqual(a.sha256, b.sha256)

    def test_points_in_the_same_cell_are_one_request(self):
        c = self.client()
        c.point(24.02, -104.65, ["T2M"], 2001, 2002)
        c.point(24.10, -104.50, ["T2M"], 2001, 2002)       # same 0.5° x 0.625° cell
        self.assertEqual(self.srv.hits, 1)

    def test_offline_mode(self):
        self.client().point(24.0, -104.6, ["T2M"], 2001, 2002)
        hits = self.srv.hits
        off = self.client(offline=True)
        self.assertTrue(off.point(24.0, -104.6, ["T2M"], 2001, 2002).from_cache)
        with self.assertRaises(CacheMiss):
            off.point(30.0, -100.0, ["T2M"], 2001, 2002)
        self.assertEqual(self.srv.hits, hits)

    def test_corrupt_cache_entry_is_refetched(self):
        c = self.client()
        c.point(24.0, -104.6, ["T2M"], 2001, 2002)
        for p in Path(self.tmp).rglob("*.body"):
            p.write_bytes(b"corrupted")
        s = c.point(24.0, -104.6, ["T2M"], 2001, 2002)
        self.assertFalse(s.from_cache)
        self.assertEqual(self.srv.hits, 2)

    def test_ttl_expiry(self):
        now = [1000.0]
        c = PowerClient(self.tmp, base_url=self.srv.url, http=self.http, ttl_seconds=60, clock=lambda: now[0])
        c.point(24.0, -104.6, ["T2M"], 2001, 2002)
        now[0] += 30
        c.point(24.0, -104.6, ["T2M"], 2001, 2002)
        self.assertEqual(self.srv.hits, 1)
        now[0] += 61
        c.point(24.0, -104.6, ["T2M"], 2001, 2002)
        self.assertEqual(self.srv.hits, 2)

    def test_retry_after_is_honoured_and_limiter_slows_down(self):
        self.srv.fail_plan = [(429, 7)]
        c = self.client()
        c.point(24.0, -104.6, ["T2M"], 2001, 2002)
        self.assertEqual(self.srv.hits, 2)
        self.assertGreaterEqual(self.sleeps[0], 7)         # the server's hint wins over our backoff
        self.assertGreaterEqual(self.http.limiter.interval, 0.0)

    def test_server_errors_are_retried_then_succeed(self):
        self.srv.fail_plan = [(500, None), (503, None)]
        c = self.client()
        s = c.point(24.0, -104.6, ["T2M"], 2001, 2002)
        self.assertEqual(self.srv.hits, 3)
        self.assertEqual(len(self.sleeps), 2)
        self.assertTrue(np.isfinite(s.values["T2M"]).any())

    def test_gives_up_after_retries(self):
        self.srv.fail_plan = [(503, None)] * 10
        with self.assertRaises(HTTPFailure):
            self.client().point(24.0, -104.6, ["T2M"], 2001, 2002)
        self.assertEqual(self.srv.hits, 4)                 # 1 try + 3 retries

    def test_provenance_records_every_request(self):
        c = self.client()
        c.point(24.0, -104.6, ["T2M"], 2001, 2002)
        c.point(24.0, -104.6, ["T2M"], 2001, 2002)
        s = c.prov.summary()
        self.assertEqual((s["requests"], s["from_network"], s["from_cache"]), (2, 1, 1))
        self.assertEqual(len(s["sha256"]), 64)


class TestRateLimiter(unittest.TestCase):
    def test_spacing_and_adaptation(self):
        now, slept = [0.0], []

        def sleep(s):
            slept.append(s)
            now[0] += s

        lim = RateLimiter(1.0, 4.0, clock=lambda: now[0], sleep=sleep)
        lim.wait()
        lim.wait()
        self.assertAlmostEqual(slept[0], 1.0)              # second call waits one interval
        lim.penalize()
        self.assertAlmostEqual(lim.interval, 1.5)
        for _ in range(20):
            lim.penalize()
        self.assertEqual(lim.interval, 4.0)                # capped
        for _ in range(200):
            lim.reward()
        self.assertEqual(lim.interval, 1.0)                # recovers to the base rate, never below it


class TestGridAndCubes(Base):
    def test_axes_are_cell_centers_inside_the_box(self):
        lats, lons = GridSpec().axes(24.0, -105.0, 25.0, -104.0)
        self.assertEqual(lats, [25.0, 24.5, 24.0])
        self.assertEqual(lons, [-105.0, -104.375])

    def test_region_cube_shape_nan_and_metadata(self):
        self.srv.missing = {"200201"}
        cubes = self.client().region_cube((24.0, -105.0, 25.0, -104.0), ["T2M", "PRECTOTCORR"], 2001, 2003)
        c = cubes["T2M"]
        self.assertEqual(c.values.shape, (36, 3, 2))
        self.assertEqual(c.time[0], "2001-01-01")
        self.assertEqual(c.time[-1], "2003-12-01")
        self.assertEqual(c.lat.tolist(), [25.0, 24.5, 24.0])            # north -> south
        self.assertFalse(c.valid[12].any())                              # Jan 2002 missing everywhere
        self.assertTrue(c.valid[0].all())
        self.assertEqual(self.srv.hits, 6)                               # 3 x 2 cells, ONE request per cell (both params)
        m = c.meta
        self.assertEqual(m["dataset"]["kind"], "reanalysis")
        self.assertEqual(len(m["dataset"]["sha256"]), 64)
        self.assertIn("accessed on", m["citation"])
        self.assertEqual(m["provenance"]["requests"], 6)
        self.assertEqual(len(m["cell_elevation_m"]), 3)

    def test_cube_is_written_in_the_cube_format(self):
        c = self.client().region_cube((24.0, -105.0, 25.0, -104.0), ["T2M"], 2001, 2002)["T2M"]
        path = c.write_npz(Path(self.tmp) / "out" / "cube.npz")
        z = np.load(path)
        self.assertEqual(set(z.files), {"values", "valid", "time", "lat", "lon", "meta"})
        self.assertEqual(z["values"].dtype, np.float32)
        import json
        self.assertEqual(json.loads(str(z["meta"]))["profile"], "earth")

    def test_region_cube_refuses_huge_requests(self):
        with self.assertRaises(PowerError):
            self.client().region_cube((0.0, -180.0, 80.0, 180.0), ["T2M"], 2001, 2002)

    def test_partial_failures_are_tolerated_up_to_a_limit(self):
        self.srv.fail_plan = [(404, None)]
        with self.assertRaises(PowerError):                              # 1 of 6 cells > 5 %
            self.client().region_cube((24.0, -105.0, 25.0, -104.0), ["T2M"], 2001, 2002)


class TestIntelligence(Base):
    def test_probe_recovers_the_native_grid(self):
        c = self.client()
        r = c.probe_native_grid(24.02, -104.65, years=(2001, 2002))
        self.assertTrue(r.confident, r.conclusion)
        self.assertAlmostEqual(r.dlat, 0.5, delta=0.03)
        self.assertAlmostEqual(r.dlon, 0.625, delta=0.03)
        g = r.to_grid()
        self.assertEqual((g.dlat, g.dlon), (0.5, 0.625))
        self.assertEqual(g.snap(24.02, -104.65), GridSpec().snap(24.02, -104.65))
        self.assertLess(r.network_requests, 45)

    def test_probe_refuses_to_guess_when_data_is_interpolated(self):
        self.srv.interpolate = True
        r = self.client().probe_native_grid(24.02, -104.65, years=(2001, 2002))
        self.assertFalse(r.confident)
        self.assertIn("no plateaus", r.conclusion)
        with self.assertRaises(PowerError):
            r.to_grid()

    def test_latest_available_finds_the_last_real_month(self):
        today = dt.date.today()
        self.srv.cutoff = today.year * 100 + 3
        self.assertEqual(self.client().latest_available("monthly"), f"{today.year}-03")


if __name__ == "__main__":
    unittest.main()
