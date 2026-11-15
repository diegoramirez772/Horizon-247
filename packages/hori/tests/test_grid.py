"""H2: block-by-block grid run == one-shot run_layer (same per-cell numbers, one FDR family for the whole map)."""
import unittest

import numpy as np

from hori.api import Config, run_grid, run_layer
from test_hori import make_cube

ARRAYS = ("effect", "ci_lo", "ci_hi", "sigma", "r1", "p_cons", "q_cons", "mde", "years_more", "verdict", "flags",
          "nvalid", "nsig_methods", "naive_sig")


def blocks_of(cube, by, bx):
    T, Y, X = cube.values.shape
    for y0 in range(0, Y, by):
        for x0 in range(0, X, bx):
            yield y0, x0, cube.values[:, y0:y0 + by, x0:x0 + bx]


class TestGrid(unittest.TestCase):
    def setUp(self):
        self.cube = make_cube(np.random.default_rng(11), [(0, 0), (1, 1), (3, 4)], y=5, x=5)
        self.cube.values[:3, 2, 2] = np.nan                                  # a cell with a gap at the start

    def test_blocks_reproduce_run_layer_exactly(self):
        one = run_layer(self.cube, Config(delta_per_decade=0.5))
        for by, bx in ((2, 2), (5, 1), (3, 5), (5, 5)):                     # uneven edges included
            grid = run_grid(blocks_of(self.cube, by, bx), self.cube.lat, self.cube.lon, self.cube.time, self.cube.meta,
                            Config(delta_per_decade=0.5), keep_series=True)
            for a in ARRAYS:
                self.assertTrue(np.array_equal(getattr(one, a), getattr(grid, a), equal_nan=True), (by, bx, a))
            self.assertTrue(np.array_equal(one.series, grid.series.astype(float), equal_nan=True) or
                            np.allclose(one.series, grid.series, equal_nan=True))
            self.assertEqual(one.manifest["summary"], grid.manifest["summary"])

    def test_fdr_is_one_family_for_the_whole_map(self):
        grid = run_grid(blocks_of(self.cube, 2, 2), self.cube.lat, self.cube.lon, self.cube.time, self.cube.meta)
        part = run_layer(type(self.cube)(self.cube.values[:, :2, :2], self.cube.valid[:, :2, :2], self.cube.time,
                                         self.cube.lat[:2], self.cube.lon[:2], self.cube.meta))
        self.assertTrue(np.allclose(grid.p_cons.reshape(5, 5)[:2, :2].ravel(), part.p_cons))   # same p per cell
        self.assertTrue((grid.q_cons.reshape(5, 5)[:2, :2].ravel() >= part.q_cons - 1e-12).all())  # stricter q

    def test_bad_tilings_fail(self):
        c = self.cube
        with self.assertRaises(ValueError):                                 # gap: last column missing
            run_grid(((0, 0, c.values[:, :, :4]),), c.lat, c.lon, c.time, c.meta)
        with self.assertRaises(ValueError):                                 # overlap
            run_grid(((0, 0, c.values), (0, 0, c.values[:, :1, :1])), c.lat, c.lon, c.time, c.meta)

    def test_global_result_has_no_series_by_default(self):
        g = run_grid(blocks_of(self.cube, 2, 2), self.cube.lat, self.cube.lon, self.cube.time, self.cube.meta)
        self.assertIsNone(g.series)


if __name__ == "__main__":
    unittest.main()
