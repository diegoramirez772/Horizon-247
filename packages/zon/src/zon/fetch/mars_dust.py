"""Mars (vertical 2): column dust optical depth, Montabone et al. (LMD), kriged daily maps, Martian years 24-36 (1999-2022).

    d = load_mars_dust("data/mars")        # NetCDF classic, read with zon.netcdf3 (no extra library)

Source: https://www-mars.lmd.jussieu.fr/mars/dust_climatology/ (v2.x). Licence of the data: CC BY-SA 3.0 (attribution and
share-alike; cite Montabone et al. 2015 Icarus 251, and 2020 JGR Planets for MY34+). Honesty built into the metadata:
  * the maps are RECONSTRUCTED from TES, THEMIS and MCS retrievals (kriging fills the gaps): kind = "reconstruction";
  * MY24 is partly a scenario (average of MY25-26 for Ls 0-105): it is flagged, and the annual cube can leave it out;
  * the time axis is MARTIAN years (669 sols): «per decade» means per 10 Martian years (~18.8 Earth years).
Annual value = mean of cdod610 (normalised to 610 Pa) over the 669 sols of the year, per cell.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

import numpy as np

from ..netcdf3 import read

CITATION = ("Montabone, L., et al. (2015) Eight-year climatology of dust optical depth on Mars, Icarus 251, 65-95; "
            "Montabone, L., et al. (2020) Martian Year 34 column dust climatology from MCS observations, JGR Planets. "
            "Data CC BY-SA 3.0, LMD / Mars Climate Database.")


def load_mars_dust(root: str | Path, years: range | list | None = None, var: str = "cdod610") -> dict:
    root = Path(root)
    files = {int(re.search(r"MY(\d+)", p.name).group(1)): p for p in root.glob("dustscenario_MY*_v*.nc")}
    want = sorted(files) if years is None else [y for y in years if y in files]
    if not want:
        raise FileNotFoundError(f"no dustscenario_MY*.nc under {root}")
    annual, daily, lat, lon, vers, sols, shas = [], [], None, None, {}, {}, {}
    for my in want:
        raw = files[my].read_bytes()
        shas[my] = hashlib.sha256(raw).hexdigest()
        ds = read(raw)
        v = ds.get(var).astype(float)                                   # [Time, lat, lon]
        la, lo = ds.get("latitude"), ds.get("longitude")
        if lat is None:
            lat, lon = la.astype(float), lo.astype(float)
        elif not (np.allclose(lat, la) and np.allclose(lon, lo)):
            raise ValueError(f"MY{my}: grid differs from the first file")
        v[(v < 0) | (v > 20)] = np.nan                                  # fill values / impossible opacities
        annual.append(np.nanmean(v, axis=0))
        w = np.cos(np.deg2rad(lat))[None, :, None]
        ok = np.isfinite(v)
        daily.append((np.where(ok, v, 0) * w * 1.0).sum(axis=(1, 2)) / (ok * w).sum(axis=(1, 2)))
        vers[my], sols[my] = str(ds.attrs.get("version", "")), int(v.shape[0])
    order = np.argsort(-lat)                                            # north -> south, as the Cube contract wants
    annual = np.stack(annual)[:, order, :]
    at = ds.variables[var].attrs
    meta = {"id": f"mars_{var}_annual_MY{want[0]}-MY{want[-1]}", "profile": "mars", "body": "mars",
            "variable": {"name": var, "unit": str(at.get("units", "1")), "long_name": str(at.get("long_name", var)),
                         "definition": "Column dust optical depth (IR absorption), normalised to 610 Pa", "cell_methods": "time: mean"},
            "dataset": {"name": "Mars Climate Database dust climatology (Montabone et al.), kriged daily maps", "kind": "reconstruction",
                        "version": ",".join(f"MY{k}:{v}" for k, v in vers.items()), "url": "https://www-mars.lmd.jussieu.fr/mars/dust_climatology/",
                        "licence": "CC BY-SA 3.0", "citation": CITATION,
                        "sha256": hashlib.sha256("".join(shas[k] for k in want).encode()).hexdigest(), "files_sha256": shas, "time_standard": "Martian years (669 sols)"},
            "native_resolution_deg": 6.0, "native_resolution_lon_deg": 3.0,
            "notes": ["El eje de tiempo son AÑOS MARCIANOS: «por década» = por 10 años marcianos (≈ 18.8 años terrestres).",
                      "Mapas reconstruidos (kriging) a partir de TES, THEMIS y MCS: el dato no es una medición directa de cada celda.",
                      f"Solo {len(want)} años marcianos: menos de los 15 con que se midió la tabla del MDE (se usa el factor de n = 15, optimista)."]
                     + (["MY24 es parcialmente un escenario (promedio de MY25-26 en Ls 0-105)."] if 24 in want else [])}
    return {"annual": annual, "years": want, "lat": lat[order], "lon": lon, "daily_global": np.concatenate(daily),
            "daily_labels": [f"MY{my}-sol{k + 1:03d}" for my in want for k in range(sols[my])], "meta": meta}
