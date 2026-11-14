# HORI — monitoring model (non-generative)

Pure, deterministic functions that decide whether a change is real: aggregate → filter → effect size →
three trend tests → consensus → FDR → detectability → verdict. Same input + config + seed → same output.

* **Depends on NumPy only.** No network, no files outside the cube/bundle, no LLM.
* **Does not import ZON or the web** (enforced by `tests/test_independence.py`).
* Spec (method, parameters, measured calibration): `docs/SPEC.md`.
* Reference implementation of the statistics (working, from the calibration study): `../../sim/h247_sim.py`.

Public API: `hori.api` (`run_layer`, `write_bundle`). Status: **skeleton — interfaces only.**
