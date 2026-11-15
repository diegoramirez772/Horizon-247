"""H6 on the REAL planet: BH (p-values) vs e-BH with the calibrator vs e-BH with mixture e-values.

    PYTHONPATH=packages/hori/src python3 sim/evalue_planet.py
"""
import numpy as np

from hori.api import Config, cell_stats
from hori.evalue import ebh, p_to_e
from hori.fdr import bh_adjust

z = np.load("data/planet/t2m_annual_1981-2025.npz")
A, years = z["annual"], z["years"].tolist()
n, ny, nx = A.shape
flat = A.reshape(n, -1)
cfg = Config(delta_per_decade=0.3)
for a, b in ((2001, 2024), (1981, 2025)):
    k0, k1 = years.index(a), years.index(b) + 1
    t = [f"{y}-01-01" for y in years[k0:k1]]
    keys = ("p_cons", "e_cons", "nsig", "usable")
    parts = {k: [] for k in keys}
    for s in range(0, flat.shape[1], 8192):
        st = cell_stats(flat[k0:k1, s:s + 8192, None], t, cfg)
        for k in keys:
            parts[k].append(st[k])
    o = {k: np.concatenate(v) for k, v in parts.items()}
    bh = (bh_adjust(o["p_cons"]) <= 0.1) & o["usable"]
    probado = bh & (o["nsig"] == 3)
    e_cal, e_mix = ebh(p_to_e(o["p_cons"]), 0.1), ebh(o["e_cons"], 0.1)
    print(f"{a}-{b}: BH {bh.sum()} | PROBADO {probado.sum()} | e-BH calibrator {e_cal.sum()} ({e_cal.sum() / max(bh.sum(), 1):.0%} of BH)"
          f" | e-BH mixture {e_mix.sum()} ({e_mix.sum() / max(bh.sum(), 1):.0%} of BH) | mixture inside PROBADO "
          f"{(e_mix & probado).sum() / max(e_mix.sum(), 1):.1%}", flush=True)
