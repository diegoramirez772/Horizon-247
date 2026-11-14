# sim/ — calibration studies (evidence for the method)

NumPy-only, fixed seed (247). They produced the numbers behind HORI's rule (consensus of three tests + FDR).

| File | What it does |
|---|---|
| `h247_sim.py` | Reference statistics (MK, Sen, VC, PW, TFPW-Y, OLS-AR1), E1 calibration, E2 field/FDR, E3 verdicts, E4 timing |
| `diag_power.py` | Power vs effect size; shows PW loses power with strong trends; adds PWd and TFPW-WS |
| `rule_search.py` | Consensus rule and FDR on the map |
| `mde_consensus.py` | Real minimum detectable effect of the consensus rule |
| `e1c.py` | **Superseded**: PW∧TFPW-Y rule (flawed: PW power collapses with strong trends) |

Run from this folder: `python3 diag_power.py`. Results are simulations (AR(1) Gaussian noise), not real data.
