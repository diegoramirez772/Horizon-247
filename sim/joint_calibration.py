"""Joint change (hori.joint): how often CONJUNTO_PROBADO is wrong, and how much it finds, by simulation.

    PYTHONPATH=packages/hori/src python3 sim/joint_calibration.py      # ~3 min, < 300 MB

Map 60 x 60, n = 25 years, AR(1) noise phi = 0.3 (and 0.5), spatially independent cells. Scenarios:
  null-null : neither variable changes                               -> every joint claim is false
  real-null : A rises 3 sigma/decade in 25 % of the map, B is noise   -> every joint claim is false (the dangerous case)
  real-real : both change in the same 25 % block (A up, B down)       -> claims outside the block are false
  shifted   : A in one block, B in a block that overlaps half of it   -> only the overlap is true
Reported: false claims per 1000 cells, false discovery proportion among joint claims, power on the true joint cells.
"""
import json
import time
from pathlib import Path

import numpy as np

from hori.api import Config, Cube, joint_rule, run_layer
from hori.joint import Rule

N, SIDE, REPS = 25, 60, 20
RULE = Rule("T", "A", +1, "B", -1, {"es": "", "en": ""})


def layer(rng, mask, slope, phi):
    cells = SIDE * SIDE
    e = rng.standard_normal((N, cells))
    x = np.empty_like(e)
    x[0] = e[0]
    for t in range(1, N):
        x[t] = phi * x[t - 1] + np.sqrt(1 - phi ** 2) * e[t]
    x += np.outer(np.arange(N) / 10.0, np.where(mask.ravel(), slope, 0.0))
    v = x.reshape(N, SIDE, SIDE).astype("float32")
    r = run_layer(Cube(v, np.isfinite(v), np.array([f"{2001 + i}-01-01" for i in range(N)]), np.linspace(60, 1, SIDE),
                       np.linspace(-100, -41, SIDE), {"variable": {"name": "X", "unit": "1"}, "native_resolution_deg": 1.0}),
                  Config(delta_per_decade=2.0))
    return {"effect": r.effect, "p_cons": r.p_cons, "verdict": r.verdict}


def block(y0, x0, h=30, w=30):
    m = np.zeros((SIDE, SIDE), bool)
    m[y0:y0 + h, x0:x0 + w] = True
    return m


def main():
    t0 = time.time()
    rng = np.random.default_rng(247)
    none = np.zeros((SIDE, SIDE), bool)
    scen = {"null-null": (none, 0.0, none, 0.0), "real-null": (block(0, 0), 3.0, none, 0.0),
            "real-real": (block(0, 0), 3.0, block(0, 0), -3.0), "shifted": (block(0, 0), 3.0, block(0, 15), -3.0)}
    out = {}
    for phi in (0.3, 0.5):
        for name, (ma, sa, mb, sb) in scen.items():
            truth = (ma & mb).ravel()
            acc = {lv: {"false": 0, "claims": 0, "found": 0, "fdp": []} for lv in (4, 3)}
            for _ in range(REPS):
                res = joint_rule(RULE, layer(rng, ma, sa, phi), layer(rng, mb, sb, phi))
                for lv, a in acc.items():
                    c = res["level"] >= lv                     # 4 = CONJUNTO_PROBADO; 3 = AMBAS_PROBADO or better
                    a["false"] += int((c & ~truth).sum())
                    a["claims"] += int(c.sum())
                    a["found"] += int((c & truth).sum())
                    a["fdp"].append((c & ~truth).sum() / max(1, c.sum()))
            out[f"{name} phi={phi}"] = {
                {4: "CONJUNTO_PROBADO", 3: "AMBAS_PROBADO_o_mas"}[lv]: {
                    "false_per_1000_cells": round(1000 * a["false"] / (REPS * SIDE * SIDE), 2),
                    "false_discovery_proportion_mean": round(float(np.mean(a["fdp"])), 4),
                    "false_discovery_proportion_worst": round(float(np.max(a["fdp"])), 4),
                    "power_on_true_joint_cells": round(a["found"] / (REPS * truth.sum()), 4) if truth.any() else None,
                    "claims_per_map": round(a["claims"] / REPS, 1)} for lv, a in acc.items()}
            print(name, phi, out[f"{name} phi={phi}"], flush=True)
    out["_setup"] = {"n_years": N, "map": f"{SIDE}x{SIDE}", "reps": REPS, "effect": "3 sigma/decade", "p_joint": "one-sided max", "q": 0.10,
                     "seconds": round(time.time() - t0, 1)}
    p = Path(__file__).with_name("results_joint_calibration.json")
    p.write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
