"""Function 3: anomalies on any stream (point, run, level shift, silence), causal, with a measured false-alarm rate."""
import unittest

import numpy as np

from hori.api import anomaly_events, detect_anomalies

P = 24


def stream(rng, T=1500, phi=0.3):
    e = rng.standard_normal(T)
    n = np.zeros(T)
    for t in range(1, T):
        n[t] = phi * n[t - 1] + np.sqrt(1 - phi * phi) * e[t]
    return 5 * np.sin(2 * np.pi * np.arange(T) / P) + n


class TestAnomaly(unittest.TestCase):
    def setUp(self):
        self.rng = np.random.default_rng(3)

    def test_clean_seasonal_stream_has_almost_no_alarms(self):
        fa = n = 0
        for _ in range(20):
            r = detect_anomalies(stream(self.rng), P)
            fa += int(r.point.sum() + (r.shift != 0).sum())
            n += int(r.judged.sum())
        self.assertLess(1000 * fa / n, 5.0)                                   # measured ~2/1000 (model card 3.13)

    def test_spike_shift_and_silence_are_found_where_they_are(self):
        x = stream(self.rng)
        x[1000] += 9                                                          # +9 sigma spike
        x[1200:1236] += 3.0                                                   # +3 sigma for 36 samples
        x[1400:1405] = np.nan                                                 # 5 missing samples
        r = detect_anomalies(x, P)
        ev = anomaly_events(r, None, "u")
        kinds = {(e["type"], e["start"] // 50) for e in ev}
        self.assertIn(("punto", 1000 // 50), kinds)
        shifts = [e for e in ev if e["type"] == "cambio_nivel" and 1150 <= e["start"] <= 1260]
        self.assertTrue(shifts and abs(shifts[0]["start"] - 1200) <= 4, ev)   # onset estimated close to the real one
        self.assertTrue(any(e["type"] == "sin_datos" and e["start"] == 1400 and e["n_flagged"] == 5 for e in ev))
        self.assertTrue(all(e["severity"] in ("leve", "media", "alta") for e in ev))

    def test_judgement_is_causal_the_future_cannot_change_the_past(self):
        x = stream(self.rng)
        x[1300] += 8
        a, b = detect_anomalies(x[:1250], P), detect_anomalies(x, P)
        self.assertTrue(np.array_equal(np.nan_to_num(a.z), np.nan_to_num(b.z[:1250])))
        self.assertTrue(np.array_equal(a.point, b.point[:1250]))

    def test_quantized_sensor_does_not_flood_when_resolution_is_given(self):
        t = np.arange(1500)
        x = np.round(97.4 - 0.4 * (t % P < 6) + np.convolve(self.rng.standard_normal(1500), [0.5, 0.5], "same") * 0.6)
        r = detect_anomalies(x, P, min_sigma=1.0)
        self.assertLess(1000 * int(r.point.sum()) / int(r.judged.sum()), 5.0)
        x[1200:1206] -= 6                                                     # a real dip is still seen
        self.assertTrue(detect_anomalies(x, P, min_sigma=1.0).point[1200:1206].any())

    def test_not_enough_history_means_not_judged(self):
        r = detect_anomalies(stream(self.rng, 200), P)
        self.assertTrue(r.judged.sum() == 0 or r.warmup >= 5 * P)
        self.assertFalse(r.point[: r.warmup].any())


if __name__ == "__main__":
    unittest.main()
