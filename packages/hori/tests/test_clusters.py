"""Significant regions (hori.clusters). Run: PYTHONPATH=src python3 -m unittest tests.test_clusters"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hori.api import significant_regions
from hori.clusters import label, z_map

NY = NX = 20
N = 40


def noise_map(rng, phi=0.3, common=0.5):
    """[N, NY, NX] AR(1) noise per cell plus a shared regional factor (neighbours are correlated, like a real map)."""
    e = rng.standard_normal((N + 30, NY, NX)) + common * rng.standard_normal((N + 30, 1, 1))
    x = np.empty_like(e)
    x[0] = e[0]
    for t in range(1, N + 30):
        x[t] = phi * x[t - 1] + np.sqrt(1 - phi * phi) * e[t]
    return x[30:]


class TestLabel(unittest.TestCase):
    def test_components_and_wrap(self):
        m = np.zeros((3, 5), bool)
        m[0, 0] = m[0, 4] = m[2, 2] = True
        self.assertEqual(label(m, wrap=False)[1], 3)
        lab, k = label(m, wrap=True)
        self.assertEqual(k, 2)
        self.assertEqual(lab[0, 0], lab[0, 4])

    def test_z_map_matches_the_ols_ar1_statistic(self):
        from hori.stats import analyze
        Y = np.random.default_rng(0).standard_normal((50, N)) + 0.03 * np.arange(N)
        self.assertTrue(np.allclose(z_map(Y), analyze(Y)["z_ols"]))


class TestRegions(unittest.TestCase):
    def test_noise_alone_rarely_gives_a_region(self):
        rng = np.random.default_rng(1)
        hits = sum(len(significant_regions(noise_map(rng), surrogates=100).regions) > 0 for _ in range(30))
        print(f"\n[regions] maps of pure noise with any region: {hits}/30 (nominal 5 %)")
        self.assertLessEqual(hits, 4)

    def test_a_weak_regional_change_is_found_as_a_region(self):
        rng = np.random.default_rng(2)
        found = cover = 0
        for _ in range(10):
            s = noise_map(rng)
            s[:, 6:14, 6:14] += (0.045 * np.arange(N))[:, None, None]          # 0.45 sigma per decade in an 8x8 block
            R = significant_regions(s, surrogates=100)
            inside = (R.labels[6:14, 6:14] > 0).mean()
            found += inside > 0
            cover += inside
            self.assertFalse((R.labels < 0).any())                             # never a falling region
        print(f"[regions] weak 8x8 block found in {found}/10 maps, mean share of the block inside a region {cover / 10:.0%}")
        self.assertGreaterEqual(found, 8)

    def test_deterministic_and_documented(self):
        s = noise_map(np.random.default_rng(3))
        s[:, :6, :6] -= (0.08 * np.arange(N))[:, None, None]
        a, b = significant_regions(s), significant_regions(s)
        self.assertTrue(np.array_equal(a.labels, b.labels))
        self.assertTrue(a.regions and a.regions[0]["sign"] == -1 and a.regions[0]["p"] <= 0.05)
        self.assertEqual(a.params["error"], "family-wise over regions")


if __name__ == "__main__":
    unittest.main()
