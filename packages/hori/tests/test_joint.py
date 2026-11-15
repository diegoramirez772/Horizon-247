"""Joint change (hori.joint): known answers and the error rate of CONJUNTO_PROBADO measured by simulation.

The dangerous case is «a real, b null»: one variable truly changes and the other is noise. A joint claim there is false.
"""
import unittest

import numpy as np

from hori.api import JOINT_RULES, Config, Cube, joint_explain, joint_rule, run_joint, run_layer
from hori.joint import Rule

N, SIDE = 25, 40                      # 25 years, 40 x 40 cells


def layer(rng, trend_mask, slope_sigma, phi=0.3, name="X"):
    """AR(1) noise with a linear trend (in sigma per decade) where trend_mask is True. -> HORI result as dict."""
    cells = SIDE * SIDE
    e = rng.standard_normal((N, cells))
    x = np.empty_like(e)
    x[0] = e[0]
    for t in range(1, N):
        x[t] = phi * x[t - 1] + np.sqrt(1 - phi ** 2) * e[t]
    x += np.outer(np.arange(N) / 10.0, np.where(trend_mask.ravel(), slope_sigma, 0.0))
    v = x.reshape(N, SIDE, SIDE).astype("float32")
    cube = Cube(v, np.isfinite(v), np.array([f"{2001 + i}-01-01" for i in range(N)]), np.linspace(40, 1, SIDE),
                np.linspace(-100, -61, SIDE), {"variable": {"name": name, "unit": "1"}, "native_resolution_deg": 1.0})
    r = run_layer(cube, Config(delta_per_decade=2.0))
    return {"effect": r.effect, "p_cons": r.p_cons, "verdict": r.verdict}


class TestJointKnownAnswers(unittest.TestCase):
    def test_levels_and_direction(self):
        la = {"effect": np.array([0.5, 0.5, 0.5, -0.5, 0.5]), "p_cons": np.array([1e-6, 1e-6, 0.5, 1e-6, 0.03]),
              "verdict": np.array([1, 1, 3, 1, 2])}
        lb = {"effect": np.array([-0.1, 0.1, -0.1, -0.1, -0.1]), "p_cons": np.array([1e-6, 1e-6, 1e-6, 1e-6, 0.04]),
              "verdict": np.array([1, 1, 1, 1, 2])}
        out = joint_rule(Rule("T", "A", +1, "B", -1, {"es": "t", "en": "t"}), la, lb)
        # cell 0 both PROBADO in the rule's direction; 1: B significant the OTHER way (not «only one»: 0); 2: A not
        # significant (only B: 1); 3: A significant downwards (0);
        # 4: both p <= 0.05 in the right direction but not PROBADO
        self.assertEqual(out["level"].tolist(), [4, 0, 1, 0, 2])
        self.assertEqual(float(out["p_joint"][1]), 1.0)
        self.assertEqual(out["summary"]["counts"]["CONJUNTO_PROBADO"], 1)
        self.assertAlmostEqual(float(out["p_joint"][0]), 5e-7)            # one-sided: the direction is declared first

    def test_both_proven_but_joint_not_reached(self):
        # 40 cells; only one is PROBADO in both, with p = 0.004: q_joint = 0.002 * 40 = 0.08 -> 4; with 400 cells -> 3
        for m, want in ((40, 4), (400, 3)):
            la = {"effect": np.full(m, 0.5), "p_cons": np.r_[0.004, np.full(m - 1, 0.9)], "verdict": np.r_[1, np.full(m - 1, 3)]}
            lb = {"effect": np.full(m, -0.5), "p_cons": np.r_[0.004, np.full(m - 1, 0.9)], "verdict": np.r_[1, np.full(m - 1, 3)]}
            out = joint_rule(JOINT_RULES[0], la, lb)
            self.assertEqual(int(out["level"][0]), want)
        t = joint_explain(JOINT_RULES[0], 0, out, la, lb)
        self.assertIn("todavía no alcanza", t["es"])

    def test_insufficient_cells_are_not_tested(self):
        la = {"effect": np.array([0.5, 0.5]), "p_cons": np.array([1e-6, 1e-6]), "verdict": np.array([1, 0])}
        lb = {"effect": np.array([-0.5, -0.5]), "p_cons": np.array([1e-6, 1e-6]), "verdict": np.array([1, 1])}
        out = joint_rule(JOINT_RULES[0], la, lb)
        self.assertTrue(np.isnan(out["q_joint"][1]))
        self.assertEqual(out["summary"]["usable_cells"], 1)

    def test_text_has_numbers_and_no_cause(self):
        la = {"effect": np.array([0.41]), "p_cons": np.array([1e-8]), "verdict": np.array([1])}
        lb = {"effect": np.array([-0.012]), "p_cons": np.array([1e-8]), "verdict": np.array([1])}
        out = joint_rule(JOINT_RULES[0], la, lb)
        t = joint_explain(JOINT_RULES[0], 0, out, la, lb, {"T2M": "°C", "NDVI": ""})
        self.assertIn("subió la temperatura (+0.41 °C/década, PROBADO)", t["es"])
        self.assertIn("bajó la vegetación (NDVI) (-0.012 /década, PROBADO)", t["es"])
        self.assertIn("no dice que una cause", t["es"])
        for bad in ("porque", "debido a", "causa de", "because", "due to"):
            self.assertNotIn(bad, t["es"] + t["en"])

    def test_only_rules_with_both_variables_run(self):
        x = {"effect": np.zeros(3), "p_cons": np.ones(3), "verdict": np.full(3, 3)}
        self.assertEqual(sorted(run_joint({"T2M": x, "NDVI": x})), ["J1", "J6"])


class TestJointCalibration(unittest.TestCase):
    """Measured: false joint claims when only ONE variable changes, and power when both do. (Numbers in the docstrings
    of sim/joint_calibration.py; here only tolerances.)"""

    def test_one_real_one_null(self):
        rng = np.random.default_rng(247)
        sig = np.zeros((SIDE, SIDE), bool)
        sig[:20, :20] = True                                          # 25 % of the map
        false_joint, joint_found = 0, 0
        for _ in range(4):
            a = layer(rng, sig, 3.0, name="A")                        # A truly rises in the block
            b = layer(rng, np.zeros_like(sig), 0.0, name="B")         # B is pure noise everywhere
            out = joint_rule(Rule("T", "A", +1, "B", -1, {"es": "", "en": ""}), a, b)
            false_joint += int((out["level"] >= 3).sum())             # every joint claim is false here (levels 3 and 4)
            joint_found += int(((out["level"] >= 3) & sig.ravel()).sum())
        self.assertLessEqual(false_joint / (4 * SIDE * SIDE), 0.01)   # <= 1 % of cells, all maps together

    def test_both_real(self):
        rng = np.random.default_rng(7)
        sig = np.zeros((SIDE, SIDE), bool)
        sig[:20, :20] = True
        a = layer(rng, sig, 3.0, name="A")
        b = layer(rng, sig, -3.0, name="B")
        out = joint_rule(Rule("T", "A", +1, "B", -1, {"es": "", "en": ""}), a, b)
        found = (out["level"] == 4) & sig.ravel()
        wrong = (out["level"] >= 3) & ~sig.ravel()
        self.assertGreaterEqual(found.sum() / sig.sum(), 0.5)
        self.assertLessEqual(wrong.sum() / max(1, (out["level"] >= 3).sum()), 0.10)


if __name__ == "__main__":
    unittest.main()
