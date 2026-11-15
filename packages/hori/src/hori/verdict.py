"""Step 7: verdict codes and flags (PROBADO / CANDIDATA / NO_CONCLUYENTE / SIN_CAMBIO / INSUFICIENTE).

Must not import zon or any web code.
"""
from __future__ import annotations
import numpy as np

INSUFICIENTE, PROBADO, CANDIDATA, NO_CONCLUYENTE, SIN_CAMBIO = 0, 1, 2, 3, 4
VERDICT_CODES = {"0": "INSUFICIENTE", "1": "PROBADO", "2": "CANDIDATA", "3": "NO_CONCLUYENTE",
                 "4": "SIN_CAMBIO_MAYOR_QUE_DELTA"}

F_DEPENDE_METODO = 1
F_CAMBIO_VERSION = 2
F_COBERTURA_BAJA = 4
F_RESOLUCION_GRUESA = 8
F_RECONSTRUCCION = 16
F_SIMULADO = 32
F_AUTOCORR_ALTA = 64
FLAG_BITS = {"1": "depende_del_metodo", "2": "cambio_de_version", "4": "cobertura_baja", "8": "resolucion_gruesa",
             "16": "reconstruccion", "32": "simulado", "64": "autocorrelacion_alta"}


def decide(enough: np.ndarray, q: np.ndarray, nsig: np.ndarray, mde: np.ndarray, delta: np.ndarray,
           q_max: float) -> np.ndarray:
    """Verdict in the order of docs/SPEC.md step 7. nsig = number of the 3 methods significant at raw alpha."""
    v = np.full(enough.shape, INSUFICIENTE, np.uint8)
    e = enough
    probado = e & (q <= q_max) & (nsig == 3)
    candidata = e & ~probado & (nsig >= 1)
    rest = e & ~probado & ~candidata
    v[probado] = PROBADO
    v[candidata] = CANDIDATA
    v[rest & (mde <= delta)] = SIN_CAMBIO
    v[rest & ~(mde <= delta)] = NO_CONCLUYENTE
    return v


def flags_for(verdict: np.ndarray, nsig: np.ndarray, r: np.ndarray, interpolated: np.ndarray,
              base_flags: int = 0) -> np.ndarray:
    f = np.full(verdict.shape, base_flags, np.uint8)
    ok = verdict != INSUFICIENTE
    f |= np.where(ok & (nsig >= 1) & (nsig <= 2), F_DEPENDE_METODO, 0).astype(np.uint8)
    f |= np.where(ok & (r > 0.5), F_AUTOCORR_ALTA, 0).astype(np.uint8)
    f |= np.where(interpolated, F_COBERTURA_BAJA, 0).astype(np.uint8)
    return f


def summary(verdict: np.ndarray, naive_sig: np.ndarray) -> dict:
    return {
        "cells_valid": int((verdict != INSUFICIENTE).sum()),
        "naive_marked": int(naive_sig.sum()),
        "probado": int((verdict == PROBADO).sum()),
        "candidata": int((verdict == CANDIDATA).sum()),
        "no_concluyente": int((verdict == NO_CONCLUYENTE).sum()),
        "sin_cambio": int((verdict == SIN_CAMBIO).sum()),
        "insuficiente": int((verdict == INSUFICIENTE).sum()),
    }
