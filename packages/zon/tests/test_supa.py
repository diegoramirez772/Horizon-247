import json
import re

import numpy as np

from zon.supa import build_sql, lit, uid


def _bundle(root, path, nlat=2, nlon=2):
    d = root / path
    d.mkdir(parents=True)
    m = {
        "id": "test_T2M", "profile": "earth", "variable": {"name": "T2M", "unit": "C", "unit_per_decade": "C/década"},
        "entity": {"kind": "region_cell"}, "grid": {"nlat": nlat, "nlon": nlon, "lat0": 25.0, "dlat": -0.5, "lon0": -105.0, "dlon": 0.625},
        "dataset": {"name": "NASA POWER", "provider": "NASA", "version": "v2", "licence": "CC BY 4.0", "kind": "reanalysis"},
        "window": {"start": 2001, "end": 2024, "n": 24}, "params": {"delta_per_decade": 0.3},
        "summary": {"probado": 3}, "honesty": {"data_real": True, "simulated": False}, "build": {"created_at": "2026-11-14T00:00:00Z"},
        "title": {"es": "Prueba"},
    }
    (d / "manifest.json").write_text(json.dumps(m))
    n = nlat * nlon
    np.array([1, 1, 1, 0][:n], dtype=np.uint8).tofile(d / "verdict.u8")
    np.array([0.5, 0.4, float("nan"), 0.1][:n], dtype="<f4").tofile(d / "effect.f32")
    np.array([0.6, 0.2, 0.1, 0.0][:n], dtype="<f4").tofile(d / "ci_lo.f32")   # first cell inverted on purpose
    np.array([0.4, 0.6, 0.3, 0.2][:n], dtype="<f4").tofile(d / "ci_hi.f32")
    return {"path": path, "kind": "layer", "id": m["id"]}


def test_build_sql_is_light_idempotent_and_valid(tmp_path):
    e = _bundle(tmp_path, "earth/test")
    (tmp_path / "index.json").write_text(json.dumps([e, {"path": "earth/anom", "kind": "anomaly"}]))
    sql, counts = build_sql(tmp_path)
    assert sql.startswith("begin;") and sql.rstrip().endswith("commit;")
    assert counts["analysis_runs"] == 1          # the anomaly entry is not a trend run
    assert counts["findings"] == 1 + 3           # grid summary + the 3 cells with a verdict (INSUFICIENTE skipped)
    assert not re.search(r"\bnan\b", sql, re.I)
    assert sql.count("on conflict") >= sum(counts.values())
    assert build_sql(tmp_path)[0] == sql           # deterministic → pushing twice inserts nothing new
    assert "'0.4', '0.6'" not in sql and "0.4000000059604645, 0.6000000238418579" in sql  # inverted CI reordered


def test_lit_and_uid():
    assert lit(None) == "null" and lit(float("nan")) == "null" and lit("o'k") == "'o''k'"
    assert lit({"a": 1}) == "'{\"a\": 1}'::jsonb"
    assert uid("x", 1) == uid("x", 1) != uid("x", 2)
