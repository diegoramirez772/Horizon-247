"""Step 7: verdict codes and flag bits (contract/SPEC.md section 3)."""
from __future__ import annotations

import numpy as np

INSUFICIENTE, PROBADO, CANDIDATA, NO_CONCLUYENTE, SIN_CAMBIO = 0, 1, 2, 3, 4
CODES = {0: "INSUFICIENTE", 1: "PROBADO", 2: "CANDIDATA", 3: "NO_CONCLUYENTE", 4: "SIN_CAMBIO_MAYOR_QUE_DELTA"}

F_DEPENDE_METODO, F_CAMBIO_VERSION, F_COBERTURA_BAJA, F_RESOLUCION_GRUESA = 1, 2, 4, 8
F_RECONSTRUCCION, F_SIMULADO, F_AUTOCORR_ALTA, F_QUIEBRE_POSIBLE = 16, 32, 64, 128
FLAG_BITS = {1: "depende_del_metodo", 2: "cambio_de_version", 4: "cobertura_baja", 8: "resolucion_gruesa",
             16: "reconstruccion", 32: "simulado", 64: "autocorrelacion_alta", 128: "quiebre_posible"}


def decide(usable, q, nsig, mde, delta, fdr_q: float, n_methods: int = 3, ebh_sig=None) -> np.ndarray:
    """Vectorized verdicts, in the order of the spec.

    PROBADO: survives FDR (and e-BH when `ebh_sig` is given) AND all voting methods (3 by default) are significant at the raw alpha.
    CANDIDATA: at least one method significant but not PROBADO (some but not all also raises the method-dependent flag).
    SIN_CAMBIO: no method significant and the MDE is not larger than delta (a change >= delta would have been seen).
    NO_CONCLUYENTE: no method significant and the MDE is larger than delta ("not yet knowable").
    """
    v = np.full(usable.shape, INSUFICIENTE, dtype=np.uint8)
    probado = usable & (q <= fdr_q) & (nsig == n_methods)
    if ebh_sig is not None:                      # HORI 1.2: PROBADO must also be an e-BH discovery (else it stays CANDIDATA)
        probado &= np.asarray(ebh_sig, dtype=bool)
    candidata = usable & ~probado & (nsig >= 1)
    sin_cambio = usable & (nsig == 0) & (mde <= delta)
    no_concl = usable & (nsig == 0) & ~sin_cambio
    v[no_concl] = NO_CONCLUYENTE
    v[sin_cambio] = SIN_CAMBIO
    v[candidata] = CANDIDATA
    v[probado] = PROBADO
    return v
