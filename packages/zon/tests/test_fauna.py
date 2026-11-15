"""Animal signals: effort-normalised reporting rate (iNaturalist) -> monitor -> HORI's detectors -> alert. Offline (fake API)."""
import math
import shutil
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np

from zon.fetch.fauna import GROUPS, histogram_url, parse_histogram, reporting_rate
from zon.monitors import MonitorStore
from zon.notify import fauna_monitor, fauna_source

BOX = (-105.0, 23.5, -104.0, 24.5)


def months(y0, y1):
    return [f"{y}-{m:02d}" for y in range(y0, y1 + 1) for m in range(1, 13)]


def fake_api(drop_from="2024-03"):
    """Effort grows 10× over the years (more app users); birds are a steady ~25 % of reports with a yearly cycle,
    until they halve from `drop_from` on. A raw count would rise; the rate must show the drop."""
    ms = months(2014, 2025)
    rng = np.random.default_rng(7)
    allc = {m: int(200 * (1 + 9 * k / len(ms))) for k, m in enumerate(ms)}
    birds = {}
    for k, m in enumerate(ms):
        share = 0.25 + 0.05 * math.sin(2 * math.pi * (k % 12) / 12) + rng.normal(0, 0.01)
        if m >= drop_from:
            share *= 0.5
        birds[m] = int(allc[m] * share)

    def get(url):
        q = parse_qs(urlparse(url).query)
        src = birds if "taxon_id" in q else allc
        return {"results": {"month": {f"{m}-01": n for m, n in src.items()}}}
    return get


class TestFauna(unittest.TestCase):
    def test_url_and_parse(self):
        u = histogram_url(BOX, "2014-01-01", "2025-12-31", GROUPS["aves"]["taxon_id"])
        q = parse_qs(urlparse(u).query)
        self.assertEqual(q["taxon_id"], ["3"])
        self.assertEqual(q["interval"], ["month"])
        self.assertEqual(q["swlat"], ["23.5000"])
        self.assertEqual(parse_histogram({"results": {"month": {"2020-01-01": 4}}}), {"2020-01": 4})

    def test_rate_cancels_effort_and_marks_thin_months_missing(self):
        t, v = reporting_rate({"2020-01": 5, "2020-03": 50}, {"2020-01": 10, "2020-02": 40, "2020-03": 200})
        self.assertEqual(t, ["2020-01", "2020-02", "2020-03"])
        self.assertTrue(math.isnan(v[0]))          # 10 observations in total: too little looking
        self.assertEqual(v[1], 0.0)
        self.assertEqual(v[2], 250.0)

    def test_a_drop_in_birds_becomes_an_alert_even_with_more_observers(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            store = MonitorStore(tmp, clock=lambda: "2026-11-15T00:00:00Z")
            store.add_monitor(fauna_monitor("mon-aves-dgo", BOX, "aves"))
            src = fauna_source("mon-aves-dgo", BOX, "aves", start="2014-01-01", get=fake_api())
            mid, times, values = src(store)
            store.ingest(mid, times, values)
            al = store.alerts("mon-aves-dgo")
            shifts = [a for a in al if a["evidence"]["type"] == "cambio_nivel" and a["evidence"]["direction"] == "bajo"]
            self.assertTrue(shifts, [a["evidence"] for a in al])
            self.assertTrue(any("2024-01" <= a["evidence"]["t_start"] <= "2024-09" for a in shifts), [a["evidence"]["t_start"] for a in shifts])
            # a second poll brings nothing new: no duplicated alerts
            mid, times, values = src(store)
            self.assertEqual(times, [])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
