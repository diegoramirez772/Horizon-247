"""IMERG HDF5 reader (needs h5py: BSD; installed in .venv). Skips cleanly where h5py is absent."""
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

try:
    import h5py
except ImportError:                                                      # pragma: no cover
    h5py = None


@unittest.skipIf(h5py is None, "h5py not installed (use .venv/bin/python)")
class TestImerg(unittest.TestCase):
    def test_granule_is_read_flipped_and_averaged_to_one_degree(self):
        from zon.fetch.imerg import read_granule
        tmp = Path(tempfile.mkdtemp())
        try:
            v = np.zeros((1, 3600, 1800), dtype="float32")              # [time, lon, lat], mm/hr
            v[0, 0:10, 1790:1800] = 1.0                                  # west-most, north-most 1-degree box: 1 mm/hr
            v[0, 10, 1795] = -9999.9                                     # missing inside another box
            with h5py.File(tmp / "g.HDF5", "w") as f:
                f.create_dataset("Grid/precipitation", data=v)
            g = read_granule(tmp / "g.HDF5")
            self.assertEqual(g.shape, (180, 360))
            self.assertAlmostEqual(g[0, 0], 24.0)                        # north -> south, mm/day
            self.assertAlmostEqual(g[0, 1], 0.0)                         # the missing cell is ignored, not a zero
            self.assertAlmostEqual(g[90, 180], 0.0)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
