"""Anomaly detector calibration: false alarms on clean streams and detection power / delay on injected ones.

    PYTHONPATH=packages/hori/src python3 sim/anomaly_calibration.py [reps]
Streams: seasonal cycle (amplitude 5 sigma) + AR(1) noise (phi 0, 0.3, 0.6) or Student-t(5) noise (heavy tails).
Everything is measured on the pipeline exactly as hori.anomaly.detect runs it. Results -> docs/MODEL_CARD.md 3.13.
"""
import sys

import numpy as np

from hori.anomaly import detect

reps = int(sys.argv[1]) if len(sys.argv) > 1 else 150
rng = np.random.default_rng(247)


def stream(T, P, phi, heavy=False, hetero=0.0):
    e = rng.standard_t(5, T) / np.sqrt(5 / 3) if heavy else rng.standard_normal(T)
    n = np.zeros(T)
    n[0] = e[0]
    for t in range(1, T):
        n[t] = phi * n[t - 1] + np.sqrt(1 - phi * phi) * e[t]
    return 5 * np.sin(2 * np.pi * np.arange(T) / P) + (1 + hetero * np.sin(2 * np.pi * np.arange(T) / P + 1.0)) * n


for P, T in ((24, 1600), (12, 600)):
    print(f"\n=== period {P}, length {T} (judged from sample {max(5 if P >= 24 else 10, 1) * P + P})")
    print("clean streams: false alarms per 1000 judged samples")
    for name, phi, heavy, het in (("gauss phi=0", 0, False, 0), ("gauss phi=.3", .3, False, 0), ("gauss phi=.6", .6, False, 0),
                                  ("t5 phi=.3", .3, True, 0), ("noise varies by phase", .3, False, 0.7)):
        pt = sh = n = 0
        for _ in range(reps):
            r = detect(stream(T, P, phi, heavy, het), P)
            n += int(r.judged.sum())
            pt += int(r.point.sum())
            sh += int((r.shift != 0).sum())
        print(f"  {name:13s} point {1000 * pt / n:6.2f}   level-shift {1000 * sh / n:6.2f}")
    print("injected spikes (phi=.3): detection rate at the spike sample")
    for mag in (3, 4, 5, 6, 8):
        hit = 0
        for _ in range(reps):
            x = stream(T, P, .3)
            t0 = int(rng.integers(T // 2, T - 5))
            x[t0] += mag
            hit += bool(detect(x, P).point[t0])
        print(f"  +{mag} sigma: {hit / reps:5.2f}")
    print("injected level shifts (phi=.3), lasting 1.5 cycles: detected before it ends / median delay in samples")
    for mag in (1, 2, 3):
        det, delay = 0, []
        for _ in range(reps):
            x = stream(T, P, .3)
            t0, dur = int(rng.integers(T // 2, T - 3 * P)), int(1.5 * P)
            x[t0:t0 + dur] += mag
            r = detect(x, P)
            w = np.nonzero((r.shift[t0:t0 + dur] == 1) | r.point[t0:t0 + dur])[0]
            if w.size:
                det += 1
                delay.append(int(w[0]))
        print(f"  +{mag} sigma: {det / reps:5.2f}  delay {np.median(delay) if delay else float('nan'):.0f}")
