"""H12 multi-source rule: known answers for every label and the dependence-safe combination."""
import unittest

from hori.multisource import combine_sources

P = lambda s, b, lo, hi, e: {"source": s, "verdict": "PROBADO", "effect": b, "ci": [lo, hi], "e": e}
C = lambda s, b, lo, hi, e: {"source": s, "verdict": "CANDIDATA", "effect": b, "ci": [lo, hi], "e": e}


class TestMultiSource(unittest.TestCase):
    def test_confirmed_with_compatible_magnitudes(self):
        r = combine_sources([P("power", 0.40, 0.30, 0.50, 100.0), P("gistemp", 0.35, 0.28, 0.42, 300.0)])
        self.assertEqual((r["label"], r["confirmed_by"], r["sign"], r["magnitudes_compatible"]), ("CONFIRMADO", 2, 1.0, True))
        self.assertEqual(r["e_mean"], 200.0)                       # mean, not the product (sources share observations)
        self.assertEqual(r["e_if_independent"], 30000.0)

    def test_confirmed_direction_but_not_magnitude(self):
        r = combine_sources([P("a", 1.0, 0.9, 1.1, 50.0), P("b", 0.3, 0.25, 0.35, 50.0)])
        self.assertEqual(r["label"], "CONFIRMADO")
        self.assertFalse(r["magnitudes_compatible"])
        self.assertIn("NO en la magnitud", r["text"]["es"])

    def test_contradiction_is_never_averaged(self):
        r = combine_sources([P("a", 0.4, 0.3, 0.5, 1e6), P("b", -0.4, -0.5, -0.3, 1e6)])
        self.assertEqual((r["label"], r["confirmed_by"], r["sign"]), ("CONTRADICCION", 0, None))

    def test_one_source_or_none(self):
        self.assertEqual(combine_sources([P("a", 0.4, 0.3, 0.5, 90.0), C("b", 0.2, -0.1, 0.5, 2.0)])["label"], "UNA_FUENTE")
        self.assertEqual(combine_sources([C("a", 0.2, -0.1, 0.5, 2.0)])["label"], "SIN_CONFIRMAR")

    def test_two_proven_but_weak_combined_evidence_is_not_confirmed(self):
        self.assertNotEqual(combine_sources([P("a", 0.4, 0.3, 0.5, 5.0), P("b", 0.4, 0.3, 0.5, 5.0)])["label"], "CONFIRMADO")


if __name__ == "__main__":
    unittest.main()
