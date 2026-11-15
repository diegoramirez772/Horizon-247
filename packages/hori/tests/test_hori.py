"""HORI self-tests (docs/SPEC.md section 7): known answers, calibration, monotonic power, FDR, bundle writer.

Run:  cd packages/hori && python -m pytest tests -q
"""
import json
import math
import os
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from hori import api  # noqa: E402
from hori.config import Config  # noqa: E402
from hori.cube import Cube  # noqa: E402
from hori.detect import factor, years_more  # noqa: E402
from hori.engine import analyze  # noqa: E402
from hori.fdr import bh_qvalues  # noqa: E402
from hori.stats import mk_z, sen, trend_tests  # noqa: E402

RNG = np.random.default_rng(247)
Z = 1.959964


def gen(m, n, phi, slope=0.0):
    """m AR(1) series with marginal sd 1 plus a linear trend (slope per year)."""
    e = np.empty((m, n))
    e[:, 0] = RNG.standard_normal(m)
    s = math.sqrt(1 - phi ** 2)
    for t in range(1, n):
        e[:, t] = phi * e[:, t - 1] + s * RNG.standard_normal(m)
    return e + slope * np.arange(n)


def consensus_sig(Y, alpha=0.05):
    out = trend_tests(Y)
    return out["p_cons"] <= alpha


# ---- 1. Known answers ----

def test_sen_and_mk_known_answer():
    Y = np.arange(10, dtype=float)[None] * 0.5 + 3.0
    assert np.allclose(sen(Y), 0.5)
    # strictly increasing n=10: S = 45 -> z = 44 / sqrt(10*9*25/18)
    assert np.allclose(mk_z(Y), 44 / math.sqrt(10 * 9 * 25 / 18))


def test_bh_matches_definition():
    p = np.array([0.01, 0.04, 0.03, 0.20, np.nan])
    q = bh_qvalues(p)
    # sorted p: .01 .03 .04 .20 (m=4) -> .04 .06 .0533 .20 -> monotone: .04 .0533 .0533 .20
    assert np.allclose(q[[0, 2, 1, 3]], [0.04, 0.16 / 3, 0.16 / 3, 0.20])
    assert np.isnan(q[4])


def test_mde_factor_table_and_years_more():
    f, outside = factor(23, np.array([0.3]))
    assert abs(f[0] - 1.27) < 1e-9 and not outside
    _, outside = factor(45, np.array([0.0]))
    assert outside
    # MDE twice delta with n = 24 -> n' = 24 * 2^(2/3) = 38.1 -> 15 more years
    assert years_more(np.array([2.0]), np.array([1.0]), 24)[0] == 15
    assert years_more(np.array([100.0]), np.array([1.0]), 24)[0] == 255


# ---- 2. Calibration (tolerances from SPEC section 7) ----

def test_false_alarms_consensus_n24():
    for phi in (0.3, 0.5):
        rate = consensus_sig(gen(4000, 24, phi)).mean()
        assert rate <= 0.08, f"false alarms {rate:.3f} at phi={phi}"


def test_power_two_sigma_per_decade():
    power = consensus_sig(gen(4000, 24, 0.3, slope=0.2)).mean()
    assert power >= 0.75, f"power {power:.3f}"


# ---- 3. Monotonic power (catches the PW defect) ----

def test_power_does_not_drop_with_effect():
    powers = [consensus_sig(gen(3000, 23, 0.3, slope=e / 10)).mean() for e in (0, 1, 2, 3, 5)]
    assert all(b >= a - 0.02 for a, b in zip(powers, powers[1:])), powers


# ---- 4. FDR on a map: false share among flagged cells ----

def test_fdr_false_share_on_map():
    m, n = 3600, 23
    Y = gen(m, n, 0.3)
    real = np.zeros(m, bool)
    real[:576] = True                       # 16 % of the map with 2 sigma per decade
    Y[real] += 0.2 * np.arange(n)
    res = analyze(Y, Config(windows_expanding=False))
    flagged = res["verdict"] == 1
    false_share = (flagged & ~real).sum() / max(1, flagged.sum())
    assert false_share <= 0.15, false_share
    assert (flagged & real).sum() > 0


# ---- 5. Whole layer: cube -> result -> bundle ----

def _toy_cube(kind="simulated", start=2001, end=2024):
    years = np.arange(start, end + 1)
    lat = np.array([-1.0, 1.0, 3.0])        # ascending on purpose: HORI must flip to north -> south
    lon = np.array([-3.0, -1.0, 1.0, 3.0])
    T = len(years) * 12
    vals = np.empty((T, 3, 4), np.float32)
    trend = np.zeros((3, 4))
    trend[2, 0] = 0.1                       # northernmost row, first column: 1 unit per decade
    noise = gen(12, len(years), 0.2).reshape(3, 4, -1) * 0.05
    for k, y in enumerate(years):
        for mo in range(12):
            vals[k * 12 + mo] = trend * (y - start) + noise[:, :, k] + 0.3 * math.sin(mo / 12 * 2 * math.pi)
    valid = np.ones_like(vals, bool)
    valid[:, 0, 3] = False                  # one cell without data -> INSUFICIENTE
    time = np.array([f"{y}-{m + 1:02d}-15" for y in years for m in range(12)])
    meta = {"id": "toy", "profile": "earth", "title": {"es": "Prueba", "en": "Test"},
            "variable": {"name": "x", "unit": "u"},
            "dataset": {"name": "toy", "provider": "tests", "url": "", "version": "0", "sha256": "", "licence": "n/a", "kind": kind},
            "native_resolution_deg": 2.0, "window": {"start": start, "end": end, "step": "annual"}}
    return Cube(values=vals, valid=valid, time=time, lat=lat, lon=lon, meta=meta)


def test_run_layer_and_write_bundle():
    cube = _toy_cube()
    regions = [{"id": "r1", "name": {"es": "R", "en": "R"}, "bbox": [-4, 2, -2, 4]}]
    r = api.run_layer(cube, Config(), regions)
    m = r.manifest
    assert m["grid"]["lat0"] == 3.0 and m["grid"]["dlat"] == -2.0 and m["grid"]["lon0"] == -3.0
    assert r.verdict[0] == 1, "trend cell (north-west) must be PROBADO"
    assert r.flags[0] & 32, "simulated flag"
    # the cell without data was lat=-1 (south row), lon=3 -> after the flip it is the last cell
    assert r.verdict[-1] == 0
    assert m["honesty"]["simulated"] is True and m["summary"]["probado"] >= 1
    assert m["windows"]["ends"][0] == 2010 and m["windows"]["ends"][-1] == 2024
    assert r.regions and r.regions[0]["data"]["verdict"] == 1 and r.regions[0]["data"]["flags"] & 8
    with tempfile.TemporaryDirectory() as d:
        api.write_bundle(r, d)
        cells = 12
        for name, spec in m["arrays"].items():
            size = os.path.getsize(os.path.join(d, spec["file"]))
            assert size == cells * (4 if spec["dtype"] == "f32" else 1), name
        assert os.path.getsize(os.path.join(d, "series.f32")) == cells * 24 * 4
        assert os.path.exists(os.path.join(d, "windows", "2015", "verdict.u8"))
        with open(os.path.join(d, "manifest.json"), encoding="utf-8") as f:
            back = json.load(f)
        assert back["id"] == "toy"
        eff = np.fromfile(os.path.join(d, "effect.f32"), "<f4")
        assert abs(eff[0] - 1.0) < 0.1


def test_real_data_is_not_labelled_simulated():
    r = api.run_layer(_toy_cube(kind="analysis"), Config(windows_expanding=False))
    assert r.manifest["honesty"]["data_real"] is True
    assert not (r.flags & 32).any()
