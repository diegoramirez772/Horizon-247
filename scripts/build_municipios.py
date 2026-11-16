#!/usr/bin/env python3
"""Nomenclátor de los municipios de México para la web (apps/web/public/bundles/municipios.json).

Fuente: INEGI, Marco Geoestadístico (información vectorial) y Censo de Población y Vivienda 2020, servicio
https://gaia.inegi.org.mx/wscatgeo/v2/ — Términos de Libre Uso de la Información del INEGI (cita en NOTICE).
Se corre UNA vez (y cuando INEGI publique un marco nuevo); la web nunca descarga los polígonos completos.

Por municipio guarda: clave INEGI (cvegeo), nombre, estado, población 2020, centro (centroide ponderado por área del
polígono, no el promedio de vértices) y recuadro. Además, un archivo por estado (municipios/{ent}.json) con el
CONTORNO simplificado de cada municipio (Douglas-Peucker, ~300 m; coordenadas a 0.001°), para saber en qué municipio
cae un punto tocado en el mapa y dibujar su forma real. Solo biblioteca estándar.

    python3 scripts/build_municipios.py apps/web/public/bundles/municipios.json
"""
import json
import sys
import time
import urllib.request

BASE = "https://gaia.inegi.org.mx/wscatgeo/v2"


def get(url: str, tries: int = 4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "HORIZON247/1.0"}), timeout=120) as r:
                return json.load(r)
        except Exception as e:  # red lenta: reintentar con espera creciente
            if k == tries - 1:
                raise
            print(f"  reintento {k + 1}: {e}", file=sys.stderr)
            time.sleep(3 * (k + 1))


def rings(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    for poly in polys:
        yield poly[0]  # anillo exterior (los huecos no cambian recuadro y apenas el centro)


TOL = 0.003  # grados (~300 m): suficiente para «¿en qué municipio cae este punto?» y para dibujar el borde


def simplify(pts, tol=TOL):
    """Douglas-Peucker iterativo sobre un anillo (lista de [lon, lat])."""
    if len(pts) < 5:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x0, y0), (x1, y1) = pts[a], pts[b]
        dx, dy = x1 - x0, y1 - y0
        n = (dx * dx + dy * dy) ** 0.5 or 1e-12
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / n
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(ring, tol=TOL):
    """A closed ring starts and ends at the same point (a zero-length baseline): split it at the vertex farthest from
    the start and simplify the two halves."""
    if len(ring) < 5:
        return ring
    x0, y0 = ring[0]
    k = max(range(len(ring)), key=lambda i: (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2)
    return simplify(ring[: k + 1], tol) + simplify(ring[k:], tol)[1:]


def outline(geom):
    """Exterior rings, simplified and rounded; tiny islands that vanish are dropped."""
    out = []
    for ring in rings(geom):
        r = [[round(x, 3), round(y, 3)] for x, y in simplify_ring(ring)]
        r = [p for i, p in enumerate(r) if i == 0 or p != r[i - 1]]
        if len(r) >= 4:
            out.append(r)
    return out


def centroid_and_box(geom):
    a_sum = cx = cy = 0.0
    lo0 = la0 = 1e9
    lo1 = la1 = -1e9
    for ring in rings(geom):
        for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
            c = x0 * y1 - x1 * y0
            a_sum += c
            cx += (x0 + x1) * c
            cy += (y0 + y1) * c
        for x, y in ring:
            lo0, la0, lo1, la1 = min(lo0, x), min(la0, y), max(lo1, x), max(la1, y)
    if abs(a_sum) < 1e-12:
        return (la0 + la1) / 2, (lo0 + lo1) / 2, (lo0, la0, lo1, la1)
    return cy / (3 * a_sum), cx / (3 * a_sum), (lo0, la0, lo1, la1)


def main(out: str) -> None:
    import os
    states = {s["cve_ent"]: s["nomgeo"] for s in get(f"{BASE}/mgee/")["datos"]}
    rows, meta = [], None
    shape_dir = os.path.join(os.path.dirname(out), "municipios")
    os.makedirs(shape_dir, exist_ok=True)
    for ent in sorted(states):
        d = get(f"{BASE}/geo/mgem/{ent}")
        meta = d.get("metadatos", meta)
        shapes = {}
        for f in d["features"]:
            shapes[f["properties"]["cvegeo"]] = outline(f["geometry"])
            p = f["properties"]
            lat, lon, (a, b, c, e) = centroid_and_box(f["geometry"])
            rows.append([p["cvegeo"], p["nomgeo"], ent, int(p.get("pob_total") or 0),
                         round(lat, 3), round(lon, 3), round(a, 3), round(b, 3), round(c, 3), round(e, 3)])
        with open(os.path.join(shape_dir, f"{ent}.json"), "w", encoding="utf-8") as fh:
            json.dump({"ent": ent, "tolerance_deg": TOL, "m": shapes}, fh, separators=(",", ":"))
        print(f"{ent} {states[ent]}: {len(d['features'])}", file=sys.stderr)
        time.sleep(0.3)
    rows.sort(key=lambda r: r[0])
    doc = {
        "source": {
            "name": "INEGI · Marco Geoestadístico y Censo de Población y Vivienda 2020",
            "vector": (meta or {}).get("Fuente_informacion_vectorial"),
            "statistics": (meta or {}).get("Fuente_informacion_estadistica"),
            "url": BASE, "terms": "Términos de Libre Uso de la Información del INEGI",
            "built": time.strftime("%Y-%m-%d"),
        },
        "fields": ["cvegeo", "name", "ent", "pop2020", "lat", "lon", "lonMin", "latMin", "lonMax", "latMax"],
        "states": states,
        "m": rows,
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rows)} municipios → {out}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "apps/web/public/bundles/municipios.json")
