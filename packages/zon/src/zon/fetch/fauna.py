"""Animal signals: how often a group of animals is REPORTED in an area, month by month (iNaturalist, open API, no account).

Why a rate and not a count: the number of observations grows every year because more people use the app. A raw count would
«rise» everywhere. The series HORI watches is the reporting rate

    rate_m = observations of the group in month m / observations of ALL living things in the same box and month × 1000

so the observers' effort cancels out (the usual «relative reporting rate» of citizen-science ecology). Months with fewer than
`min_effort` observations in total are missing (NaN): there is not enough looking to say anything.

Honesty: a change in the rate is a change in what people REPORT. It can come from the animals (more, fewer, earlier, displaced)
or from how people look (a campaign, a bioblitz). HORI says where and how much it changed, never why (H16).

Cost: two HTTP requests per area and group for the whole history (one histogram each), and one pair per poll. Polling once a
day is enough: observations are uploaded and identified over days.
"""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request

API = "https://api.inaturalist.org/v1/observations/histogram"

# iNaturalist «iconic» taxa (stable ids) + butterflies/moths: the groups a person can name.
GROUPS: dict[str, dict] = {
    "aves": {"taxon_id": 3, "es": "Aves", "en": "Birds"},
    "mamiferos": {"taxon_id": 40151, "es": "Mamíferos", "en": "Mammals"},
    "anfibios": {"taxon_id": 20978, "es": "Anfibios", "en": "Amphibians"},
    "reptiles": {"taxon_id": 26036, "es": "Reptiles", "en": "Reptiles"},
    "insectos": {"taxon_id": 47158, "es": "Insectos", "en": "Insects"},
    "mariposas": {"taxon_id": 47157, "es": "Mariposas y polillas", "en": "Butterflies and moths"},
}


def histogram_url(box: tuple[float, float, float, float], d1: str, d2: str, taxon_id: int | None = None) -> str:
    """box = (lon_min, lat_min, lon_max, lat_max); d1/d2 = YYYY-MM-DD. Verifiable observations only (date + place + photo)."""
    q = {"date_field": "observed", "interval": "month", "verifiable": "true", "d1": d1, "d2": d2,
         "swlng": f"{box[0]:.4f}", "swlat": f"{box[1]:.4f}", "nelng": f"{box[2]:.4f}", "nelat": f"{box[3]:.4f}"}
    if taxon_id is not None:
        q["taxon_id"] = str(taxon_id)
    return f"{API}?{urllib.parse.urlencode(q)}"


def parse_histogram(doc: dict) -> dict[str, int]:
    """{"results": {"month": {"2020-01-01": 12, ...}}} -> {"2020-01": 12, ...}."""
    months = (doc.get("results") or {}).get("month") or {}
    return {k[:7]: int(v) for k, v in months.items()}


def reporting_rate(group: dict[str, int], everything: dict[str, int], min_effort: int = 30) -> tuple[list[str], list[float]]:
    """Monthly rate per 1000 observations, every month from the first to the last with data (missing = NaN)."""
    keys = sorted(set(group) | set(everything))
    if not keys:
        return [], []
    (y0, m0), (y1, m1) = map(int, keys[0].split("-")), map(int, keys[-1].split("-"))
    times, values = [], []
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        k = f"{y:04d}-{m:02d}"
        n_all = everything.get(k, 0)
        times.append(k)
        values.append(1000.0 * group.get(k, 0) / n_all if n_all >= min_effort else math.nan)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return times, values


def _get(url: str, timeout: float = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "horizon247-zon/0.1 (NASA Space Apps)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 (fixed https host)
        return json.loads(r.read().decode("utf-8"))


def fetch_rate(box, group: str, d1: str, d2: str, *, get=_get, min_effort: int = 30) -> dict:
    """The monthly reporting rate of `group` in `box` between d1 and d2, with its provenance."""
    if group not in GROUPS:
        raise ValueError(f"grupo desconocido: {group} (hay: {', '.join(GROUPS)})")
    tid = GROUPS[group]["taxon_id"]
    u_g, u_a = histogram_url(box, d1, d2, tid), histogram_url(box, d1, d2, None)
    g, a = parse_histogram(get(u_g)), parse_histogram(get(u_a))
    times, values = reporting_rate(g, a, min_effort)
    return {"times": times, "values": values, "counts": [g.get(t, 0) for t in times], "effort": [a.get(t, 0) for t in times],
            "provenance": {"source": "iNaturalist (observaciones verificables)", "licence": "metadatos CC0/CC BY según cada observación",
                           "urls": [u_g, u_a], "group": group, "taxon_id": tid, "box": list(box), "min_effort": min_effort,
                           "unit": "reportes por 1000 observaciones"}}
