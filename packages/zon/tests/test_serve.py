"""Z7: static export with an index that lets the web verify what it loads."""
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from zon.serve import export_for_web


class TestExport(unittest.TestCase):
    def setUp(self):
        self.src, self.out = Path(tempfile.mkdtemp()), Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.src, ignore_errors=True)
        shutil.rmtree(self.out, ignore_errors=True)

    def test_layers_and_timelines_are_indexed_with_hashes_and_export_is_idempotent(self):
        a = self.src / "earth" / "global_t2m_1981-2025"
        a.mkdir(parents=True)
        (a / "manifest.json").write_text(json.dumps({"id": "g", "variable": {"name": "T2M", "unit": "C"}, "entity": {"count": 4},
                                                     "window": {"start": 1981, "end": 2025}, "dataset": {"last_month": "2026-09"},
                                                     "honesty": {"data_real": True}}))
        (a / "verdict.u8").write_bytes(bytes([1, 2, 3, 4]))
        (a / "events.json").write_text("{}")
        t = self.src / "earth" / "timeline_t2m_1981-2025"
        t.mkdir()
        (t / "timeline.json").write_text(json.dumps({"id": "t", "variable": {"name": "T2M", "unit": "C"}, "grid": {"nlat": 2, "nlon": 2},
                                                     "windows": {"start": 1981, "ends": [1995, 2025]}}))
        (self.src / "earth" / "updates.json").write_text("[]")
        r1 = export_for_web(self.src, self.out)
        r2 = export_for_web(self.src, self.out)                                    # again: same result, no duplicates
        self.assertEqual((r1["bundles"], r2["bundles"]), (2, 2))
        idx = json.loads((self.out / "index.json").read_text())
        by = {e["kind"]: e for e in idx["bundles"]}
        self.assertEqual((by["layer"]["window"], by["layer"]["cells"], by["layer"]["last_month"], by["layer"]["has_events"]),
                         ("1981-2025", 4, "2026-09", True))
        self.assertEqual((by["timeline"]["window"], by["timeline"]["cells"]), ("1981-2025", 4))
        sha = by["layer"]["files"]["verdict.u8"]["sha256"]
        self.assertEqual(sha, hashlib.sha256((self.out / by["layer"]["path"] / "verdict.u8").read_bytes()).hexdigest())
        self.assertTrue((self.out / "earth" / "updates.json").exists())
        only = export_for_web(self.src, self.out / "x", include=["earth/timeline"])
        self.assertEqual(only["bundles"], 1)


if __name__ == "__main__":
    unittest.main()
