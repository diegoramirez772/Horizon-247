"""Golden bundles: the real Durango cubes (contract/examples/cubes) must give exactly the committed example arrays.

If this fails on purpose (a method changed), regenerate the examples and explain every verdict change in the commit.
"""
import unittest
from pathlib import Path

import numpy as np

from hori.api import Cube, run_layer, write_bundle

ROOT = Path(__file__).resolve().parents[3] / "contract" / "examples"
DGO = {"name": {"es": "Durango", "en": "Durango"}, "source": {"name": "caja aproximada (golden)"}}
CASES = [("power_T2M_monthly_2001-2024.npz", 0.3, "power_t2m_dgo_2001-2024", (66, 1, 5)),
         ("power_PRECTOTCORR_monthly_2001-2024.npz", 0.2, "power_prectotcorr_dgo_2001-2024", (2, 23, 47))]


@unittest.skipUnless((ROOT / "cubes").is_dir(), "golden cubes not present")
class TestGolden(unittest.TestCase):
    def test_durango_bundles_are_unchanged(self):
        import tempfile
        for cube_file, delta, bundle, (prob, cand, nocon) in CASES:
            res = run_layer(Cube.from_npz(str(ROOT / "cubes" / cube_file)), profile="auto", place=DGO)
            self.assertEqual(res.manifest["params"]["delta_per_decade"], delta)        # the inferred class gives the same δ
            s = res.manifest["summary"]
            self.assertEqual((s["probado"], s["candidata"], s["no_concluyente"]), (prob, cand, nocon), bundle)
            with tempfile.TemporaryDirectory() as d:
                out = write_bundle(res, d)
                for f in sorted((ROOT / "earth" / bundle).glob("*.*")):
                    if f.suffix in (".f32", ".u8"):
                        self.assertEqual((out / f.name).read_bytes(), f.read_bytes(), f"{bundle}/{f.name}")


if __name__ == "__main__":
    unittest.main()
