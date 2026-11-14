# CUBE — the interface ZON → HORI (v0.1)

A **cube** is what ZON hands to HORI: observations on a grid, with quality and provenance. HORI never touches the network or raw files.

Stored as a NumPy `.npz` (git-ignored) with these arrays:

| Array | Shape / dtype | Meaning |
|---|---|---|
| `values` | `[T, Y, X]` float32 | Observations (NaN = missing), in `meta.variable.unit` |
| `valid` | `[T, Y, X]` bool | Quality mask (True = usable) |
| `time` | `[T]` str (ISO-8601) | Timestamp of each step (monthly, or seasonal for Mars) |
| `lat`, `lon` | `[Y]`, `[X]` float64 | Cell-center coordinates (degrees) |
| `cell_area` | `[Y, X]` float32 (optional) | For area-weighted region means |
| `land_mask` | `[Y, X]` bool (optional) | Cells to analyze |
| `meta` | JSON string | See below |

`meta` (JSON): `{ "id", "profile": "earth|mars|person", "variable": {"name","unit"},
"dataset": {"name","provider","version","doi","url","sha256","licence","kind": "observation|analysis|reanalysis|reconstruction|simulated"},
"native_resolution_deg", "aggregation": {...}, "window": {"start","end","step"}, "notes": [...] }`.

HORI adds nothing to the cube; it reads it and writes a **bundle** (see `SPEC.md`).
Every cube must carry real provenance or be labeled `"kind": "simulated"`.
