"""Expanding windows: time machine, events and priority."""
import unittest

import numpy as np

from hori.api import Config, Cube, run_layer, run_timeline, summarize
from hori.windows import (EV_CAMBIO_SIGNO, EV_CRUZO, EV_NONE, EV_NUEVO, EV_SE_DEBILITO, TIER_EVENTO, TIER_POR_EMERGER,
                          TIER_PROBADO, TIER_RESTO)
from test_hori import ar1

I, P, C, N, S = 0, 1, 2, 3, 4


class TestSummarize(unittest.TestCase):
    def setUp(self):
        #           stays  late   lost   flick  never  flip   new    soon
        v = np.array([[P,   N,     P,     N,     N,     P,     I,     N],
                      [P,   N,     P,     P,     N,     C,     I,     N],
                      [P,   C,     P,     N,     N,     C,     I,     N],
                      [P,   P,     N,     P,     N,     P,     N,     N]], dtype=np.uint8)
        e = np.ones(v.shape, np.float32)
        e[3, 5] = -1.0                                           # proven up in 2001, proven down in 2004
        e[2, 5] = 1.0
        self.d = summarize([2001, 2002, 2003, 2004], v, e, np.full(8, 0.5, np.float32),
                           np.array([0, 0, 9, 0, 40, 0, 30, 3], np.float32))

    def test_emergence_and_first_year(self):
        em, fi = self.d["emergence_year"], self.d["first_probado_year"]
        self.assertEqual(em[:2].tolist(), [2001.0, 2004.0])
        self.assertTrue(np.isnan(em[2]) and np.isnan(em[4]))
        self.assertEqual((em[3], fi[3]), (2004.0, 2002.0))       # flickered: first claim 2002, holds only since 2004
        self.assertEqual(fi[2], 2001.0)

    def test_reversal_rates(self):
        self.assertEqual(self.d["reversals"].tolist(), [0, 0, 1, 1, 0, 1, 0, 0])
        s = self.d["stats"]
        self.assertEqual((s["ever_probado"], s["probado_now"]), (5, 4))
        self.assertAlmostEqual(s["withdrawn_share"], 1 / 5)       # only «lost» is not PROBADO today
        self.assertAlmostEqual(s["step_reversal_rate"], 3 / 8)       # 3 withdrawals / 8 PROBADO cell-years
        self.assertAlmostEqual(s["sign_reversal_share"], 1 / 5)
        self.assertTrue(self.d["sign_flip"][5])

    def test_events_of_the_last_step(self):
        self.assertEqual(self.d["event"].tolist(),
                         [EV_NONE, EV_CRUZO, EV_SE_DEBILITO, EV_CRUZO, EV_NONE, EV_CAMBIO_SIGNO, EV_NUEVO, EV_NONE])

    def test_priority_tiers_and_order(self):
        self.assertEqual(self.d["tier"].tolist(), [TIER_PROBADO, TIER_EVENTO, TIER_EVENTO, TIER_EVENTO, TIER_RESTO,
                                                   TIER_EVENTO, TIER_EVENTO, TIER_POR_EMERGER])
        order = self.d["order"].tolist()
        self.assertEqual(set(order[:5]), {1, 2, 3, 5, 6})        # events first
        self.assertEqual(order[5:], [0, 7, 4])                   # then proven, about to emerge, rest


class TestRunTimeline(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(4)
        self.annual = ar1(rng, 60, 30, 0.3).T                    # [n, cells]
        self.annual[:, :10] += 0.25 * np.arange(30)[:, None]     # 10 cells with a strong trend
        self.years = list(range(1991, 2021))
        self.cfg = Config(delta_per_decade=1.0)

    def test_last_window_equals_run_layer_and_workers_agree(self):
        t1 = run_timeline(self.annual, self.years, self.cfg, min_n=15)
        t2 = run_timeline(self.annual, self.years, self.cfg, min_n=15, workers=2, batch=7)
        self.assertTrue(np.array_equal(t1.verdict, t2.verdict) and np.array_equal(t1.effect, t2.effect))
        vals = self.annual[:, :, None].astype("float32")
        cube = Cube(vals, np.isfinite(vals), np.array([f"{y}-01-01" for y in self.years]), np.arange(60.0)[::-1] * 0 + 1,
                    np.array([0.0]), {"variable": {"name": "T", "unit": "C"}, "dataset": {"kind": "observation"}})
        one = run_layer(Cube(self.annual[:, :, None], np.isfinite(vals), cube.time, np.linspace(30, 0, 60), np.array([0.0]),
                             cube.meta), self.cfg)
        self.assertTrue(np.array_equal(t1.verdict[-1], one.verdict))
        self.assertEqual((len(t1.ends), t1.ends[0], t1.ends[-1]), (16, 2005, 2020))

    def test_strong_trends_emerge_and_noise_rarely_does(self):
        d = run_timeline(self.annual, self.years, self.cfg, min_n=15).derived
        self.assertGreaterEqual(int(np.isfinite(d["emergence_year"][:10]).sum()), 9)
        self.assertLessEqual(int(np.isfinite(d["emergence_year"][10:]).sum()), 2)
        self.assertEqual(d["stats"]["sign_reversal_share"], 0.0)

    def test_too_few_years_is_refused(self):
        with self.assertRaises(ValueError):
            run_timeline(self.annual[:10], self.years[:10], self.cfg, min_n=15)


if __name__ == "__main__":
    unittest.main()
