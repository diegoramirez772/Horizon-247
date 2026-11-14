"""ZON -> HORI integration through the public API, using the fake POWER server (no network)."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

try:
    import hori.api  # noqa: F401
    HAVE_HORI = True
except ImportError:
    HAVE_HORI = False

from fake_power import FakePower


@unittest.skipUnless(HAVE_HORI, "hori not on PYTHONPATH")
class TestBuild(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.srv = FakePower().start()

    def tearDown(self):
        self.srv.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_power_box_to_bundle(self):
        from zon.build import build_power_layer
        from zon.fetch import power
        old = power.BASE_URL
        power.BASE_URL = self.srv.url
        try:
            orig = power.PowerClient.__init__
            power.PowerClient.__init__ = lambda s, *a, **k: orig(s, *a, **{**k, "base_url": self.srv.url, "min_interval": 0.0})
            bundle, res = build_power_layer((24.0, -105.0, 25.0, -104.0), "T2M", 2001, 2014, self.tmp, region="test",
                                            cache_dir=Path(self.tmp) / "cache")
        finally:
            power.PowerClient.__init__ = orig
            power.BASE_URL = old
        m = json.loads((bundle / "manifest.json").read_text())
        self.assertEqual(m["entity"]["count"], 6)                         # 3 lat x 2 lon cells
        self.assertEqual(m["window"]["n"], 14)
        self.assertEqual((bundle / "verdict.u8").stat().st_size, 6)
        self.assertEqual(m["dataset"]["kind"], "reanalysis")
        self.assertEqual(len(m["dataset"]["sha256"]), 64)
        self.assertTrue(m["honesty"]["data_real"])


if __name__ == "__main__":
    unittest.main()
