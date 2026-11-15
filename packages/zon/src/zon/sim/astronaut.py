"""A SIMULATED astronaut (rule H5: never presented as real, never as medical technology).

Deterministic by seed. Three signals every 10 minutes with a circadian rhythm and autocorrelated noise, plus injected
events with a ground truth, so the detectors can be scored (sim/universal_demo.py). It exists to show that the SAME core
that watches a region of the Earth also watches a different kind of entity; it validates nothing about people.
"""
from __future__ import annotations

import numpy as np

CADENCE_MIN = 10
PER_DAY = 24 * 60 // CADENCE_MIN            # 144 samples = one cycle


def _ar1(rng, n, phi, sd):
    e = rng.standard_normal(n) * sd * np.sqrt(1 - phi * phi)
    x = np.zeros(n)
    for t in range(1, n):
        x[t] = phi * x[t - 1] + e[t]
    return x


def simulate_astronaut(days: int = 30, seed: int = 247) -> dict:
    rng = np.random.default_rng(seed)
    T = days * PER_DAY
    t = np.arange(T)
    hour = (t % PER_DAY) / PER_DAY * 24.0
    sleep = (hour < 6.5).astype(float)                                       # sleeps 00:00-06:30
    hr = 62 + 14 * np.sin(2 * np.pi * (hour - 9) / 24) - 7 * sleep + _ar1(rng, T, 0.7, 2.2)
    temp = 33.6 + 0.35 * np.sin(2 * np.pi * (hour - 16) / 24) + _ar1(rng, T, 0.8, 0.12)       # skin temperature, C
    spo2 = np.clip(np.round(97.4 - 0.4 * sleep + _ar1(rng, T, 0.5, 0.5)), 90, 100)               # integer % like a real sensor
    truth = []

    def at(day, h):
        return int(day * PER_DAY + h * 6)

    i = at(12, 14.0)                                                         # 3 h of elevated heart rate (+22 bpm)
    hr[i:i + 18] += 22
    truth.append({"signal": "hr_bpm", "type": "racha", "start": i, "end": i + 17, "what": "frecuencia cardiaca +22 bpm durante 3 h"})
    i = at(17, 9.0)
    hr[i] += 55                                                              # one isolated spike
    truth.append({"signal": "hr_bpm", "type": "punto", "start": i, "end": i, "what": "pico aislado +55 bpm"})
    i = at(21, 6.0)                                                          # +0.9 C on skin temperature for 40 h
    temp[i:i + 240] += 0.9
    truth.append({"signal": "skin_temp_c", "type": "cambio_nivel", "start": i, "end": i + 239, "what": "temperatura de piel +0.9 °C durante 40 h"})
    i = at(8, 11.0)                                                          # SpO2 sensor silent for 100 min
    spo2[i:i + 10] = np.nan
    truth.append({"signal": "spo2_pct", "type": "sin_datos", "start": i, "end": i + 9, "what": "sensor sin datos 100 min"})
    i = at(25, 3.0)                                                          # real dip: SpO2 -5 points for 1 h
    spo2[i:i + 6] -= 5
    truth.append({"signal": "spo2_pct", "type": "racha", "start": i, "end": i + 5, "what": "SpO2 −5 puntos durante 1 h"})
    base = np.datetime64("2026-03-01T00:00")
    times = [str(base + np.timedelta64(CADENCE_MIN * int(k), "m"))[:16] for k in t]
    return {"times": times, "period": PER_DAY, "cadence_min": CADENCE_MIN,
            "signals": {"hr_bpm": {"unit": "bpm", "values": hr, "resolution": 0.0},
                        "skin_temp_c": {"unit": "°C", "values": temp, "resolution": 0.0},
                        "spo2_pct": {"unit": "%", "values": spo2, "resolution": 1.0}},
            "truth": truth, "honesty": {"simulated": True, "es": "Datos SIMULADOS: no son una persona ni tecnología médica validada.",
                                        "en": "SIMULATED data: not a person, not validated medical technology."}}
