"""H12 / D3 «confirmed by N sources»: one claim, several independent-ish datasets, a rule with a stated guarantee.

Input: one result per source for the SAME place and window (regional series through the same HORI rule).
Rules (fixed, explainable):
  * a source CONFIRMS when its own verdict is PROBADO; the claim's sign is the sign the confirming sources share;
  * CONTRADICCION if two sources are PROBADO with opposite signs (never averaged away);
  * magnitudes are compatible when |b1 - b2| / sqrt(se1^2 + se2^2) < 1.96 (each source's own uncertainty);
  * combined evidence = MEAN of the sources' e-values, which is valid under ANY dependence. Reanalyses and
    station analyses share observations (MERRA-2 assimilates them), so they are NOT independent; the product of
    e-values (valid only for independent sources) is reported as `e_if_independent` and never used to decide.
The label never claims more than the weakest valid combination supports.
"""
from __future__ import annotations

import itertools
import math

Z_CRIT = 1.959964
ALPHA = 0.05


def _se(ci: list) -> float:
    return (float(ci[1]) - float(ci[0])) / (2 * Z_CRIT)


def combine_sources(results: list[dict]) -> dict:
    """results: [{"source", "verdict", "effect", "ci": [lo, hi], "e"}] -> the multi-source claim."""
    if not results:
        raise ValueError("no sources")
    proven = [r for r in results if r["verdict"] == "PROBADO"]
    signs = {math.copysign(1, r["effect"]) for r in proven}
    pairs = []
    for a, b in itertools.combinations(results, 2):
        z = (a["effect"] - b["effect"]) / math.sqrt(_se(a["ci"]) ** 2 + _se(b["ci"]) ** 2)
        pairs.append({"a": a["source"], "b": b["source"], "z_diff": round(z, 2), "compatible": abs(z) < Z_CRIT})
    es = [float(r["e"]) for r in results if r.get("e") is not None and math.isfinite(float(r["e"]))]
    e_mean = sum(es) / len(es) if es else None
    e_prod = math.prod(es) if es else None
    if len(signs) > 1:
        label, n = "CONTRADICCION", 0
    elif len(proven) >= 2 and e_mean is not None and e_mean >= 1 / ALPHA:
        label, n = "CONFIRMADO", len(proven)
    elif len(proven) == 1:
        label, n = "UNA_FUENTE", 1
    else:
        label, n = "SIN_CONFIRMAR", 0
    sign = next(iter(signs)) if len(signs) == 1 else None
    all_compatible = all(p["compatible"] for p in pairs)
    es_text = {"CONFIRMADO": f"Confirmado por {n} fuentes de datos independientes en su método",
               "UNA_FUENTE": "Solo una fuente lo confirma; las demás no alcanzan",
               "CONTRADICCION": "Las fuentes se contradicen en el signo: no se afirma nada",
               "SIN_CONFIRMAR": "Ninguna fuente alcanza PROBADO"}[label]
    if label == "CONFIRMADO" and not all_compatible:
        es_text += "; coinciden en la dirección pero NO en la magnitud"
    return {"label": label, "confirmed_by": n, "sign": sign, "sources": [r["source"] for r in results],
            "magnitudes_compatible": all_compatible, "pairs": pairs,
            "e_mean": e_mean, "e_if_independent": e_prod,
            "text": {"es": es_text, "origin": "HORI"},
            "rule": "PROBADO in >= 2 sources, same sign, mean e-value >= 20 (valid under any dependence)"}
