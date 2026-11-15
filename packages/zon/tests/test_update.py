"""Z3: look at the store, recompute only when a month is new, and emit events against the previous bundle (offline)."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from test_zarr import make_store, zstd
from zon.update import update_planet, window_end_year


class _NoNet:
    def get(self, url, *a, **k):
        raise RuntimeError("network touched: " + url)


class TestWindowEnd(unittest.TestCase):
    def test_a_year_counts_only_with_enough_months(self):
        self.assertEqual(window_end_year("2026-09"), 2026)         # 9 months: valid
        self.assertEqual(window_end_year("2026-08"), 2025)         # 8 months: the year waits
        self.assertEqual(window_end_year("2026-01"), 2025)
        self.assertEqual(window_end_year("2026-12"), 2026)


@unittest.skipIf(zstd is None, "needs Python 3.14 compression.zstd")
class TestUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.out = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        shutil.rmtree(self.out, ignore_errors=True)

    def store(self, valid_months, **kw):
        make_store(self.tmp, months=360, valid_months=valid_months, noise=0.3, seed=7, **kw)
        from zon.fetch.power_zarr import PowerZarr
        return PowerZarr(self.tmp, offline=True)

    def test_first_build_then_nothing_new_then_new_month_with_events(self):
        a = update_planet("T2M", self.out, start=1981, store=self.store(330))        # data up to 2008-06 -> window ends 2007
        self.assertEqual((a["status"], a["last_month"]), ("primera_construccion", "2008-06"))
        man = json.loads((Path(a["bundle"]) / "manifest.json").read_text())
        self.assertEqual((man["window"]["end"], man["dataset"]["last_month"]), (2007, "2008-06"))
        b = update_planet("T2M", self.out, start=1981, store=self.store(330))
        self.assertEqual(b["status"], "sin_novedad")                                  # same last month: no recompute
        c = update_planet("T2M", self.out, start=1981, store=self.store(334, bump=(330, 4.0)))   # 2008-10, late +4 C shift
        self.assertEqual((c["status"], c["last_month"], c["previous_last_month"]), ("actualizado", "2008-10", "2008-06"))
        new = Path(c["bundle"])
        self.assertEqual(json.loads((new / "manifest.json").read_text())["window"]["end"], 2008)
        ev = np.fromfile(new / "event.u8", "u1")
        doc = json.loads((new / "events.json").read_text())
        self.assertEqual(ev.size, 90)
        self.assertEqual(sum(doc["counts"].values()), int((ev > 0).sum()))            # events.json agrees with the array
        self.assertEqual(doc["previous"]["window_end"], 2007)
        self.assertTrue((self.out / "earth" / "updates.json").exists())
        log = json.loads((self.out / "earth" / "updates.json").read_text())
        self.assertEqual([h["status"] for h in log], ["primera_construccion", "actualizado"])
        self.assertTrue(all(e["reason"]["origin"] == "HORI" for e in doc["events_top"]))
        idx = json.loads((self.out / "index.json").read_text())
        self.assertEqual(len(idx), 2)                                                 # history kept: two windows

    def test_refresh_never_trusts_the_cache_but_default_does(self):
        from zon.fetch.power_zarr import PowerZarr
        self.store(330)
        ok = PowerZarr(self.tmp, http=_NoNet())                       # cached chunk: no network needed
        self.assertEqual(ok.read_block("T2M", 0, 0).months[-1], "2008-06")
        fresh = PowerZarr(self.tmp, http=_NoNet(), refresh=True)
        with self.assertRaises(RuntimeError):                         # refresh must go to the network (the stub refuses)
            fresh.axes


if __name__ == "__main__":
    unittest.main()
