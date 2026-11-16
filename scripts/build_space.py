#!/usr/bin/env python3
"""Espacio cercano para la web (apps/web/public/bundles/space.json): lo que de NASA/JPL no se puede pedir desde el
navegador (sus APIs no permiten CORS), traído aquí y publicado como un archivo pequeño.

  · Close Approach Data (CAD): asteroides y cometas que pasan a menos de 0.05 UA en los próximos 60 días.
  · Sentry: objetos con probabilidad de impacto no nula, resumen y los de mayor escala de Palermo.
  · Fireball: bólidos (meteoros que estallan en la atmósfera) con lugar, altura, velocidad y energía.

Se corre cuando se quiera refrescar (es lento de cambiar); la web dice siempre la fecha de este archivo.
Solo biblioteca estándar.

    python3 scripts/build_space.py apps/web/public/bundles/space.json
"""
import json
import sys
import time
import urllib.request

JPL = "https://ssd-api.jpl.nasa.gov"
AU_KM = 149_597_870.7
LD_KM = 384_400.0


def get(url: str):
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "HORIZON247/1.0"}), timeout=90) as r:
                return json.load(r)
        except Exception as e:  # red lenta: reintentar
            if k == 3:
                raise
            print(f"  reintento {k + 1}: {e}", file=sys.stderr)
            time.sleep(3 * (k + 1))


def diameter_m(h: float) -> list:
    """Diámetro estimado de la magnitud absoluta H, para albedos 0.25 y 0.05 (rango honesto, no un número)."""
    return [round(1329e3 / (a ** 0.5) * 10 ** (-h / 5)) for a in (0.25, 0.05)]


def main(out: str) -> None:
    cad = get(f"{JPL}/cad.api?date-min=now&date-max=%2B60&dist-max=0.05&sort=dist&fullname=true")
    f = cad["fields"]
    approaches = []
    for row in cad.get("data", []):
        r = dict(zip(f, row))
        dist_au = float(r["dist"])
        h = float(r["h"]) if r.get("h") else None
        approaches.append({
            "name": (r.get("fullname") or r["des"]).strip(), "des": r["des"], "date": r["cd"],
            "dist_km": round(dist_au * AU_KM), "dist_ld": round(dist_au * AU_KM / LD_KM, 2),
            "v_kms": round(float(r["v_rel"]), 1), "h": h, "diameter_m": diameter_m(h) if h is not None else None,
        })

    sentry = get(f"{JPL}/sentry.api")
    objs = sentry.get("data", [])
    top = sorted(objs, key=lambda o: float(o.get("ps_cum", -99)), reverse=True)[:8]
    sentry_top = [{
        "name": o.get("fullname", o.get("des")).strip(), "des": o.get("des"), "range": o.get("range"),
        "ps_cum": float(o["ps_cum"]), "ts_max": int(o.get("ts_max", 0) or 0), "ip": float(o.get("ip", 0) or 0),
        "diameter_km": float(o["diameter"]) if o.get("diameter") else None,
    } for o in top]

    fb = get(f"{JPL}/fireball.api?limit=300&req-loc=true")
    ff = fb["fields"]
    fireballs = []
    for row in fb.get("data", []):
        r = dict(zip(ff, row))
        try:
            lat = float(r["lat"]) * (1 if r["lat-dir"] == "N" else -1)
            lon = float(r["lon"]) * (1 if r["lon-dir"] == "E" else -1)
        except (TypeError, ValueError):
            continue
        fireballs.append({
            "date": r["date"], "lat": lat, "lon": lon,
            "alt_km": float(r["alt"]) if r.get("alt") else None, "v_kms": float(r["vel"]) if r.get("vel") else None,
            "energy_kt": float(r["impact-e"]) if r.get("impact-e") else None,   # energía de impacto estimada, kilotones
            "radiated_j": float(r["energy"]) * 1e10 if r.get("energy") else None,  # energía radiada (la API da ×10^10 J)
        })

    doc = {
        "built": time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()),
        "sources": {
            "cad": cad["signature"], "sentry": sentry.get("signature"), "fireball": fb["signature"],
            "note": "NASA/JPL Center for Near Earth Object Studies (CNEOS) APIs",
        },
        "approaches": approaches,
        "sentry": {"count": len(objs), "max_ps_cum": max((float(o["ps_cum"]) for o in objs), default=None),
                   "max_torino": max((int(o.get("ts_max", 0) or 0) for o in objs), default=0), "top": sentry_top},
        "fireballs": fireballs,
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(approaches)} acercamientos, {len(objs)} en Sentry, {len(fireballs)} bólidos → {out}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "apps/web/public/bundles/space.json")
