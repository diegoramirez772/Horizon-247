"""zon.earthdata (any NASA mission): decoding, regridding, readers, token handling. Offline: no request is made."""
import io
import os
import unittest
from unittest import mock

import numpy as np

from zon import earthdata as ed
from zon.fetch import seaice
from zon.fetch.earthdata_recipes import RECIPES

try:
    import h5py
except ImportError:                      # h5py is optional for ZON; these tests need it
    h5py = None


class TestDecode(unittest.TestCase):
    def test_cf_scale_fill_and_valid_range(self):
        raw = np.array([0, 100, 250, 251, 255], dtype=np.uint8)
        x = ed.decode(raw, {"_FillValue": 255, "valid_range": [0, 250], "scale_factor": 0.004, "add_offset": 0.0})
        np.testing.assert_allclose(x[:3], [0.0, 0.4, 1.0])
        self.assertTrue(np.isnan(x[3:]).all())             # flag 251 (pole hole) and fill are not values

    def test_modis_divide_convention(self):
        raw = np.array([-3000, 4176, 10000, -2001], dtype=np.int16)
        x = ed.decode(raw, {"_FillValue": -3000, "valid_range": [-2000, 10000], "scale_factor": 10000.0}, scale="divide")
        np.testing.assert_allclose(x[1:3], [0.4176, 1.0])
        self.assertTrue(np.isnan(x[0]) and np.isnan(x[3]))

    def test_valid_min_max(self):
        x = ed.decode(np.array([0.01, 0.3, 0.7]), {"valid_min": 0.02, "valid_max": 0.5})
        self.assertEqual(np.isnan(x).tolist(), [True, False, True])


class TestGrid(unittest.TestCase):
    def test_box_mean_with_1d_axes(self):
        lat = np.array([0.75, 0.25])              # two rows inside the box 0..1 N
        lon = np.array([10.25, 10.75])
        g, c = ed.to_grid(np.array([[1.0, 3.0], [np.nan, 5.0]]), lat, lon, 1.0)
        self.assertEqual(g.shape, (180, 360))
        self.assertEqual(float(g[89, 190]), 3.0)  # row 89 = 0..1 N, column 190 = 10..11 E; NaN is ignored
        self.assertEqual(int(c[89, 190]), 3)
        self.assertEqual(int(np.isfinite(g).sum()), 1)

    def test_2d_coordinates_and_wraparound(self):
        lat = np.array([[-89.9, 45.5]])
        lon = np.array([[179.99, 181.5]])         # 181.5 E = 178.5 W
        g, _ = ed.to_grid(np.array([[2.0, 4.0]]), lat, lon, 1.0)
        self.assertEqual(float(g[179, 359]), 2.0)
        self.assertEqual(float(g[44, 1]), 4.0)

    def test_regular_axis_spec(self):
        a = ed._axis("axis:89.975,-0.05,4", 900)
        self.assertAlmostEqual(a[0], 89.975)
        self.assertAlmostEqual(a[1], 89.775)
        self.assertAlmostEqual(a[-1], 89.975 - 0.2 * 899)


@unittest.skipIf(h5py is None, "h5py not installed")
class TestReaders(unittest.TestCase):
    def _h5(self):
        b = io.BytesIO()
        with h5py.File(b, "w") as f:
            d = f.create_dataset("g/sm", data=np.array([[0.2, -9999.0]], dtype="f4"))
            d.attrs["_FillValue"] = np.float32(-9999.0)
            d.attrs["units"] = b"cm**3/cm**3"
            f.create_dataset("g/lat", data=np.array([[10.5, 10.5]]))
            f.create_dataset("g/lon", data=np.array([[-100.5, -99.5]]))
        return b.getvalue()

    def test_read_hdf5_bytes(self):
        out = ed.read_vars(self._h5(), ["/g/sm", "/g/lat"])
        raw, attrs = out["/g/sm"]
        self.assertEqual(attrs["units"], "cm**3/cm**3")
        x = ed.decode(raw, attrs)
        self.assertEqual(float(x[0, 0]), np.float32(0.2))
        self.assertTrue(np.isnan(x[0, 1]))

    def test_missing_variable_lists_what_exists(self):
        with self.assertRaises(ed.EarthdataError) as e:
            ed.read_vars(self._h5(), ["/g/nope"])
        self.assertIn("g/sm", str(e.exception))

    def test_hdf4_is_refused_clearly(self):
        with self.assertRaises(ed.EarthdataError) as e:
            ed.read_vars(b"\x0e\x03\x13\x01" + b"\0" * 20, ["/x"])
        self.assertIn("opendap", str(e.exception))

    def test_read_granule_end_to_end_with_quality_and_range(self):
        r = ed.Recipe(id="t", short_name="X", version="1", variable="/g/sm", lat="/g/lat", lon="/g/lon",
                      access="download", phys_min=0.0, phys_max=0.1)
        with mock.patch.object(ed, "http_get", return_value=(self._h5(), "https://x", 200)):
            grid, row = ed.read_granule(r, ed.Granule("G1", "file.h5", "2020-01-01", "2020-01-01", "https://x"), "C1")
        self.assertEqual(row["dropped_physical_range"], 1)     # 0.2 > phys_max 0.1
        self.assertEqual(row["valid_pixels"], 0)
        self.assertEqual(len(row["array_sha256"]), 64)
        self.assertTrue(np.isnan(grid).all())


class TestTokenAndRecipes(unittest.TestCase):
    def test_token_only_to_earthdata_hosts(self):
        self.assertTrue(ed._trusted("https://data.lpdaac.earthdatacloud.nasa.gov/x"))
        self.assertTrue(ed._trusted("https://opendap.earthdata.nasa.gov/x"))
        self.assertFalse(ed._trusted("https://bucket.s3.us-west-2.amazonaws.com/x"))
        self.assertFalse(ed._trusted("https://earthdata.nasa.gov.evil.com/x"))

    def test_token_is_redacted(self):
        with mock.patch.dict(os.environ, {ed.TOKEN_ENV: "SECRET123"}):
            self.assertEqual(ed._redact("bad SECRET123 here"), "bad *** here")

    def test_select_days_keeps_latest_processing(self):
        r = ed.Recipe(id="t", short_name="X", version="1", variable="v", lat="a", lon="b", days=[1, 6])
        gs = [ed.Granule(str(i), f"g{i}", t, t, "u") for i, t in enumerate(["2020-01-01T00", "2020-01-01T00", "2020-01-02T00", "2020-01-06T00"])]
        self.assertEqual([g.title for g in ed.select(r, gs)], ["g1", "g3"])

    def test_recipes_say_what_they_are(self):
        for r in RECIPES.values():
            self.assertIn(r.kind, ("satellite", "reanalysis"))
            self.assertTrue(r.units and r.long_name and r.notes)
        self.assertEqual(RECIPES["aod"].kind, "reanalysis")
        self.assertEqual(RECIPES["ndvi"].scale, "divide")


class TestSeaIceGeometry(unittest.TestCase):
    def test_true_scale_at_70_degrees(self):
        lat, lon, area = seaice.lat_lon_area("N")
        near70 = np.abs(lat - 70.0) < 0.1
        np.testing.assert_allclose(area[near70], 625.0, rtol=0.003)   # 25 km x 25 km where the map is true to scale
        self.assertGreater(lat.max(), 89.5)
        self.assertLess(lat.min(), 32)
        s_lat, _, _ = seaice.lat_lon_area("S")
        self.assertLess(s_lat.min(), -89.5)

    def test_projection_orientation(self):
        lat, lon, _ = seaice.lat_lon_area("N")
        # EPSG:3411: the meridian -45 points down (+y = 135 E); cell (row 0, middle column) lies toward 135 E
        self.assertAlmostEqual(float(lon[0, 152]), 135.0, delta=1.0)


if __name__ == "__main__":
    unittest.main()
