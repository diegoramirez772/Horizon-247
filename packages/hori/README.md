# HORI — monitoring model (non-generative)

Pure, deterministic functions that decide whether a change is real: aggregate → filter → effect size →
three trend tests → consensus → FDR → detectability → verdict. Same input + config + seed → same output.

* **Depends on NumPy only.** No network, no files outside the cube/bundle, no LLM.
* **Does not import ZON or the web** (enforced by `tests/test_independence.py`).
* Spec (method, parameters, measured calibration): `docs/SPEC.md`.
* Reference implementation of the statistics (working, from the calibration study): `../../sim/h247_sim.py`.

Public API: `hori.api` (`run_layer`, `write_bundle`, `load_config`).

Status: **v0.1.0 — grid analysis, expanding windows, named regions and bundle writer implemented.**
Sequential mode (simulated person, `sequential.py`) is still a skeleton.

```python
from hori import api
cfg = api.load_config()                     # config/hori.yaml
result = api.run_layer(cube, cfg, regions)  # regions: [{"id", "name", "bbox": [lonMin, latMin, lonMax, latMax]}]
api.write_bundle(result, "out/earth/my_layer")
```

Self-tests (SPEC section 7: known answers, calibration, monotonic power, FDR on a map, bundle sizes):
`python -m pytest tests -q`
