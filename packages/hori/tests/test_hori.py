"""HORI tests. Run:  PYTHONPATH=packages/hori/src python3 -m unittest discover -s packages/hori/tests -v"""
import json
import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

from hori.aggregate import prepare, to_annual
from hori.api import run_layer, write_bundle
from hori.config import Config
from hori.cube import Cube
from hori.detect import YEARS_CAP, mde_factor, mde_per_decade, years_more
from hori.fdr import bh_adjust
from hori.stats import Z_CRIT, analyze, mk_z, p_two, sen_slope
from hori.verdict import (CANDIDATA, INSUFICIENTE, NO_CONCLUYENTE, PROBADO, SIN_CAMBIO, decide)


def ar1(rng, m, n, phi, slope_per_decade=0.0):
    """m AR(1) series with marginal sd 1; slope in sigma per decade."""
    e = np.empty((m, n))
    e[:, 0] = rng.standard_normal(m)
    s = math.sqrt(1 - phi ** 2)
    for t in range(1, n):
        e[:, t] = phi * e[:, t - 1] + s * rng.standard_normal(m)
    return e + (slope_per_decade / 10.0) * np.arange(n)


def consensus_sig(Y):
    s = analyze(Y)
    return (np.abs(s["z_vc"]) > Z_CRIT) & (np.abs(s["z_ws"]) > Z_CRIT) & (np.abs(s["z_ols"]) > Z_CRIT)


class TestKnownAnswers(unittest.TestCase):
    def test_mann_kendall_perfect_trend(self):
        z = mk_z(np.arange(10, dtype=float)[None, :])[0]
        self.assertAlmostEqual(z, (45 - 1) / math.sqrt(10 * 9 * 25 / 18), places=9)

    def test_sen_slope_recovers_a_line(self):
        t = np.arange(12)
        self.assertAlmostEqual(sen_slope((2.0 * t + 1)[None, :])[0], 2.0)
        self.assertAlmostEqual(sen_slope(((-0.5) * t)[None, :])[0], -0.5)

    def test_p_two_matches_normal(self):
        self.assertAlmostEqual(p_two(np.array([1.959964]))[0], 0.05, places=5)
        self.assertAlmostEqual(p_two(np.array([0.0]))[0], 1.0)

    def test_bh_adjust_known_values(self):
        q = bh_adjust(np.array([0.01, 0.04, 0.03, 0.005, np.nan]))
        # sorted p: .005 .01 .03 .04 -> adjusted .02 .02 .04 .04; back in the ORIGINAL order (.01 .04 .03 .005):
        self.assertTrue(np.allclose(q[:4], [0.02, 0.04, 0.04, 0.02]))
        self.assertTrue(np.isnan(q[4]))

    def test_mde_factor_table_and_clamping(self):
        self.assertAlmostEqual(float(mde_factor(23, np.array([0.3]))[0]), 1.27)
        self.assertAlmostEqual(float(mde_factor(40, np.array([0.5]))[0]), 1.22)
        self.assertAlmostEqual(float(mde_factor(10, np.array([0.9]))[0]), 1.73)     # clamped to n=15, phi=0.5
        self.assertGreater(float(mde_factor(30, np.array([0.2]))[0]), 1.1)

    def test_mde_matches_the_measured_example(self):
        # n=23, phi=0.3: ideal MDE 1.20 sigma/decade * factor 1.27 = 1.53 (measured 1.53)
        mde = mde_per_decade(np.array([1.0]), np.array([0.3]), 23)[0]
        self.assertAlmostEqual(mde, 1.53, delta=0.03)

    def test_years_more_scaling_and_cap(self):
        ym = years_more(np.array([2.0, 1.0, 0.5, 30.0]), np.array([1.0, 1.0, 1.0, 1.0]), 24)
        self.assertEqual(ym[1], 0.0)                         # MDE == delta: nothing more needed
        self.assertEqual(ym[2], 0.0)
        self.assertEqual(ym[0], math.ceil(24 * 2 ** (2 / 3) - 24))   # MDE halves with n^(-3/2)
        self.assertEqual(ym[3], YEARS_CAP)


class TestVerdictLogic(unittest.TestCase):
    def test_all_five_verdicts(self):
        usable = np.array([True, True, True, True, False, True])
        q = np.array([0.01, 0.20, 0.50, 0.50, np.nan, 0.04])
        nsig = np.array([3, 1, 0, 0, 0, 2], dtype=np.uint8)
        mde = np.array([1.0, 1.0, 5.0, 0.5, np.nan, 1.0])
        delta = np.array([2.0, 2.0, 2.0, 2.0, np.nan, 2.0])
        v = decide(usable, q, nsig, mde, delta, 0.10)
        self.assertEqual(v.tolist(), [PROBADO, CANDIDATA, NO_CONCLUYENTE, SIN_CAMBIO, INSUFICIENTE, CANDIDATA])


class TestStatisticalBehaviour(unittest.TestCase):
    """The behaviour measured in sim/ must hold in the ported code (and these tests would have caught the PW defect)."""

    def test_power_never_drops_as_the_effect_grows(self):
        rng = np.random.default_rng(7)
        rates = [consensus_sig(ar1(rng, 1500, 24, 0.3, eff)).mean() for eff in (0.0, 1.0, 2.0, 3.0, 5.0)]
        for a, b in zip(rates, rates[1:]):
            self.assertGreaterEqual(b + 0.02, a, rates)      # monotone within sampling noise
        self.assertGreater(rates[-1], 0.97, rates)           # a strong trend must be detected

    def test_calibration_false_alarms_and_power(self):
        rng = np.random.default_rng(11)
        fa3 = consensus_sig(ar1(rng, 4000, 24, 0.3)).mean()
        fa5 = consensus_sig(ar1(rng, 4000, 24, 0.5)).mean()
        pw = consensus_sig(ar1(rng, 4000, 24, 0.3, 2.0)).mean()
        self.assertLess(fa3, 0.08, fa3)
        self.assertLess(fa5, 0.09, fa5)
        self.assertGreater(pw, 0.75, pw)

    def test_fdr_keeps_an_empty_map_empty(self):
        rng = np.random.default_rng(5)
        s = analyze(ar1(rng, 2000, 24, 0.3))
        p = np.maximum.reduce([p_two(s["z_vc"]), p_two(s["z_ws"]), p_two(s["z_ols"])])
        self.assertLess((bh_adjust(p) <= 0.10).mean(), 0.01)


class TestAggregation(unittest.TestCase):
    def test_monthly_to_annual_anomalies_with_missing_months(self):
        years = [2001, 2002, 2003, 2004]
        time = [f"{y}-{m:02d}-01" for y in years for m in range(1, 13)]
        v = np.array([10 + m + 0.5 * (y - 2001) for y in years for m in range(1, 13)], dtype=float)[:, None]
        v[(1 * 12):(1 * 12 + 4), 0] = np.nan                  # 2002: 4 months missing -> 8 valid < 9 -> year invalid
        v[2 * 12, 0] = np.nan                                  # 2003: 1 missing -> still valid
        annual, yrs, anomaly = to_annual(v, time, 9)
        self.assertTrue(anomaly)
        self.assertEqual(yrs, years)
        self.assertTrue(np.isnan(annual[1, 0]))
        self.assertTrue(np.isfinite(annual[[0, 2, 3], 0]).all())
        self.assertLess(annual[0, 0], annual[3, 0])            # the +0.5/yr trend survives the anomaly step

    def test_prepare_fills_interior_gaps_and_rejects_bad_cells(self):
        Z = np.tile(np.arange(24, dtype=float), (4, 1))
        Z[1, 5:7] = np.nan            # interior gap of 2: filled
        Z[2, 5:9] = np.nan            # interior gap of 4: rejected
        Z[3, 0] = np.nan              # missing at the start: rejected
        out, nvalid, usable, filled = prepare(Z, 10, 0.8, 2)
        self.assertEqual(usable.tolist(), [True, True, False, False])
        self.assertEqual(filled.tolist(), [False, True, False, False])
        self.assertTrue(np.allclose(out[1], np.arange(24)))    # linear interpolation of a line is exact


def make_cube(rng, trend_cells, trend_sigma_dec=3.0, y=5, x=5, n=24, phi=0.3, simulated=False):
    vals = ar1(rng, y * x, n, phi).reshape(y, x, n)
    for (i, j) in trend_cells:
        vals += 0
        vals[i, j] += (trend_sigma_dec / 10.0) * np.arange(n)
    values = np.transpose(vals, (2, 0, 1)).astype("float32")           # [T, Y, X]
    time = np.array([f"{2001 + k}-01-01" for k in range(n)])
    meta = {"id": "synthetic", "profile": "earth", "variable": {"name": "T", "unit": "C"},
            "dataset": {"name": "test", "kind": "simulated" if simulated else "observation"},
            "native_resolution_deg": 0.5, "notes": []}
    return Cube(values, np.isfinite(values), time, np.array([25.0, 24.5, 24.0, 23.5, 23.0][:y]),
                np.array([-105.0, -104.375, -103.75, -103.125, -102.5][:x]), meta)


class TestEndToEnd(unittest.TestCase):
    def setUp(self):
        self.rng = np.random.default_rng(2026)
        self.block = [(0, 0), (0, 1), (1, 0), (1, 1)]
        self.cube = make_cube(self.rng, self.block)
        self.res = run_layer(self.cube, Config())

    def test_planted_trend_is_found_and_empty_cells_are_not(self):
        v = self.res.verdict.reshape(5, 5)
        found = sum(int(v[i, j] == PROBADO) for i, j in self.block)
        false = int((v == PROBADO).sum()) - found
        self.assertGreaterEqual(found, 3)
        self.assertLessEqual(false, 1)

    def test_effect_is_per_decade_and_close_to_the_truth(self):
        eff = self.res.effect.reshape(5, 5)
        self.assertTrue(all(2.0 < eff[i, j] < 4.5 for i, j in self.block), eff[:2, :2])   # planted 3 sigma/decade

    def test_arrays_and_manifest_are_consistent(self):
        r = self.res
        self.assertEqual(r.effect.shape, (25,))
        self.assertEqual(r.series.shape, (25, 24))
        self.assertEqual(r.manifest["window"]["n"], 24)
        self.assertEqual(sum(r.manifest["summary"][k] for k in ("insuficiente", "probado", "candidata", "no_concluyente",
                                                                 "sin_cambio_mayor_que_delta")), 25)
        self.assertTrue(r.manifest["honesty"]["data_real"])

    def test_naive_marks_more_than_the_honest_map(self):
        rng = np.random.default_rng(9)
        res = run_layer(make_cube(rng, [], phi=0.5, y=5, x=5), Config())     # no real trend anywhere
        self.assertGreaterEqual(int(res.naive_sig.sum()), int((res.verdict == PROBADO).sum()))

    def test_simulated_data_is_flagged(self):
        res = run_layer(make_cube(np.random.default_rng(1), [], simulated=True), Config())
        self.assertTrue(res.manifest["honesty"]["simulated"])
        self.assertTrue((res.flags[res.verdict != INSUFICIENTE] & 32).all())

    def test_physical_delta_overrides_sigma_delta(self):
        rng = np.random.default_rng(3)
        cube = make_cube(rng, [], phi=0.2)                       # no trend anywhere
        big = run_layer(cube, Config(delta_per_decade=50.0))     # a huge delta: the record could surely have seen it
        small = run_layer(cube, Config(delta_per_decade=0.001))  # a tiny delta: cannot be ruled out
        self.assertGreater(int((big.verdict == SIN_CAMBIO).sum()), int((small.verdict == SIN_CAMBIO).sum()))
        self.assertGreater(int((small.verdict == NO_CONCLUYENTE).sum()), 0)
        self.assertEqual(big.manifest["params"]["delta_per_decade"], 50.0)

    def test_too_short_a_series_is_insufficient(self):
        cube = make_cube(self.rng, [], n=24)
        cube.values[:20] = np.nan                                              # only 4 valid years
        self.assertTrue((run_layer(cube, Config()).verdict == INSUFICIENTE).all())

    def test_bundle_files_match_the_contract(self):
        with tempfile.TemporaryDirectory() as d:
            out = write_bundle(self.res, d, title_es="Prueba", title_en="Test")
            m = json.loads((out / "manifest.json").read_text())
            self.assertEqual(m["contract"], "0.1")
            self.assertEqual(m["title"]["en"], "Test")
            for name, spec in m["arrays"].items():
                size = (out / spec["file"]).stat().st_size
                self.assertEqual(size, 25 * (4 if spec["dtype"] == "f32" else 1), name)
            self.assertEqual((out / "series.f32").stat().st_size, 25 * 24 * 4)

    def test_cube_roundtrip_through_npz(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.npz"
            c = self.cube
            np.savez_compressed(p, values=c.values, valid=c.valid, time=c.time, lat=c.lat, lon=c.lon,
                                meta=np.array(json.dumps(c.meta)))
            back = Cube.from_npz(str(p))
            self.assertEqual(back.values.shape, c.values.shape)
            self.assertEqual(back.meta["id"], "synthetic")


if __name__ == "__main__":
    unittest.main()
