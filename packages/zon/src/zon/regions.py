"""Named regions (contract SPEC 8.2): an id, a name and a bounding box [lonMin, latMin, lonMax, latMax].

The box is an approximation of the state's extent; cells count when their centre lies inside.
At GISTEMP's 2° grid Durango covers only a handful of cells -> HORI adds `resolucion_gruesa` if < 4.
"""
from __future__ import annotations

REGIONS = [
    {
        "id": "mx-dgo",
        "name": {"es": "Durango", "en": "Durango"},
        # Extent of the State of Durango, Mexico (approx. 22.3°N-26.8°N, 107.2°W-102.5°W).
        "bbox": [-107.2, 22.3, -102.5, 26.8],
        "source": {"name": "Caja aproximada del estado de Durango", "note": "rectángulo, no el límite exacto del estado"},
    },
]


def get(ids: list[str] | None = None) -> list[dict]:
    if not ids:
        return list(REGIONS)
    return [r for r in REGIONS if r["id"] in ids]
