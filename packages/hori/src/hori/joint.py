"""Several variables at once: «here temperature went up AND vegetation went down», with explicit rules.

Input: per-cell results of HORI for two or more variables ON THE SAME GRID AND WINDOW (effect, p_cons, verdict).
A rule names a pair and a direction for each one (J1: temperature up, NDVI down). For each cell:

    p_joint = max(p_a, p_b) / 2  if both effects have the rule's sign, else 1
    q_joint = Benjamini-Hochberg over every cell where both variables are usable (one family per rule)

Taking the max is the intersection-union test: «both changed» is rejected unless EACH change is significant, so the
joint claim is never easier than its weakest part (Berger 1982). The direction of every rule is written BEFORE looking
at the data, so the one-sided p (half the two-sided one) is the right one. Levels, in this order:

    4 CONJUNTO_PROBADO    q_joint <= q AND both variables are PROBADO in their own layer (the joint claim holds over
                          the whole map)
    3 AMBAS_PROBADO       both PROBADO in their own layers, in the rule's direction, but the joint claim over the map
                          does not reach q yet (measured: with 25 years of real data this is the usual case)
    2 CONJUNTO_CANDIDATO  both effects in the rule's direction with p <= alpha, not level 3 or 4
    1 SOLO_UNA            one variable PROBADO in the rule's direction; the other is not significant (says which)
    0 NADA

Each rule also reports how often both would be PROBADO together BY CHANCE if the two maps were unrelated (product of
the two fractions). A ratio far above 1 says «they coincide more than chance»; it does not say why, and spatial correlation
makes the ratio noisy. HORI never states a cause (H12, H16): the text says what moved, where and how much.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .fdr import bh_adjust
from .verdict import INSUFICIENTE, PROBADO

LEVELS = {0: "NADA", 1: "SOLO_UNA", 2: "CONJUNTO_CANDIDATO", 3: "AMBAS_PROBADO", 4: "CONJUNTO_PROBADO"}


@dataclass(frozen=True)
class Rule:
    id: str
    a: str                  # variable name (as in the layers dict)
    sign_a: int             # +1 up, -1 down
    b: str
    sign_b: int
    name: dict              # {"es": ..., "en": ...}


# Written down by the team. Each one is a co-occurrence worth watching, NOT a causal claim.
RULES = (
    Rule("J1", "T2M", +1, "NDVI", -1, {"es": "Más calor y menos vegetación", "en": "Warmer and less green"}),
    Rule("J2", "T2M", +1, "SOIL_MOISTURE", -1, {"es": "Más calor y suelo más seco", "en": "Warmer and drier soil"}),
    Rule("J3", "T2M", +1, "SNOW_COVER", -1, {"es": "Más calor y menos nieve", "en": "Warmer and less snow"}),
    Rule("J4", "PRECTOTCORR", -1, "NDVI", -1, {"es": "Menos lluvia y menos vegetación", "en": "Less rain and less green"}),
    Rule("J5", "PRECTOTCORR", -1, "SOIL_MOISTURE", -1, {"es": "Menos lluvia y suelo más seco", "en": "Less rain and drier soil"}),
    Rule("J6", "T2M", +1, "NDVI", +1, {"es": "Más calor y más vegetación", "en": "Warmer and greener"}),
    Rule("J7", "AOD", +1, "T2M", -1, {"es": "Más aerosoles y menos calor", "en": "More aerosols and cooler"}),
    Rule("J8", "AOD", +1, "NDVI", -1, {"es": "Más aerosoles y menos vegetación", "en": "More aerosols and less green"}),
)

WORDS = {  # how each variable is said, up / down
    "T2M": ({"es": "subió la temperatura", "en": "temperature rose"}, {"es": "bajó la temperatura", "en": "temperature fell"}),
    "NDVI": ({"es": "subió la vegetación (NDVI)", "en": "vegetation (NDVI) rose"}, {"es": "bajó la vegetación (NDVI)", "en": "vegetation (NDVI) fell"}),
    "SOIL_MOISTURE": ({"es": "subió la humedad del suelo", "en": "soil moisture rose"}, {"es": "bajó la humedad del suelo", "en": "soil moisture fell"}),
    "SNOW_COVER": ({"es": "subió la cobertura de nieve", "en": "snow cover rose"}, {"es": "bajó la cobertura de nieve", "en": "snow cover fell"}),
    "PRECTOTCORR": ({"es": "subió la lluvia", "en": "rainfall rose"}, {"es": "bajó la lluvia", "en": "rainfall fell"}),
    "AOD": ({"es": "subieron los aerosoles", "en": "aerosols rose"}, {"es": "bajaron los aerosoles", "en": "aerosols fell"}),
}


def _words(var: str, sign: float, lang: str) -> str:
    up, down = WORDS.get(var, ({"es": f"subió {var}", "en": f"{var} rose"}, {"es": f"bajó {var}", "en": f"{var} fell"}))
    return (up if sign > 0 else down)[lang]


def apply_rule(rule: Rule, la: dict, lb: dict, *, q: float = 0.10, alpha: float = 0.05) -> dict:
    """la / lb: {"effect", "p_cons", "verdict"} arrays over the same cells. -> per-cell level, q_joint and a summary."""
    ea, eb = np.asarray(la["effect"], float), np.asarray(lb["effect"], float)
    pa, pb = np.asarray(la["p_cons"], float), np.asarray(lb["p_cons"], float)
    va, vb = np.asarray(la["verdict"]), np.asarray(lb["verdict"])
    if not (ea.shape == eb.shape == pa.shape == pb.shape):
        raise ValueError("the two layers must be on the same cells (regrid first)")
    usable = (va != INSUFICIENTE) & (vb != INSUFICIENTE) & np.isfinite(pa) & np.isfinite(pb) & np.isfinite(ea) & np.isfinite(eb)
    dir_a, dir_b = np.sign(ea) == rule.sign_a, np.sign(eb) == rule.sign_b
    p_joint = np.where(usable, np.where(dir_a & dir_b, np.maximum(pa, pb) / 2.0, 1.0), np.nan)
    q_joint = bh_adjust(p_joint)
    prob_a, prob_b = usable & dir_a & (va == PROBADO), usable & dir_b & (vb == PROBADO)
    level = np.zeros(ea.shape, np.uint8)
    level[(prob_a & (pb > alpha)) | (prob_b & (pa > alpha))] = 1
    level[usable & dir_a & dir_b & (pa <= alpha) & (pb <= alpha)] = 2
    level[usable & prob_a & prob_b] = 3
    level[usable & prob_a & prob_b & (q_joint <= q)] = 4
    n = int(usable.sum())
    fa, fb = (prob_a.sum() / n, prob_b.sum() / n) if n else (0.0, 0.0)
    observed = float((level >= 3).sum() / n) if n else 0.0
    expected = float(fa * fb)
    summary = {"rule": rule.id, "name": rule.name, "a": rule.a, "sign_a": rule.sign_a, "b": rule.b, "sign_b": rule.sign_b,
               "usable_cells": n, "counts": {LEVELS[k]: int((level == k).sum()) for k in LEVELS},
               "fraction_probado_a": round(float(fa), 4), "fraction_probado_b": round(float(fb), 4),
               "observed_both_probado": round(observed, 4), "expected_if_unrelated": round(expected, 4),
               "min_q_joint": round(float(np.nanmin(q_joint[level >= 3])), 4) if (level >= 3).any() else None,
               "ratio": round(observed / expected, 2) if expected > 0 else None,
               "note": {"es": "Coincidir en el mismo lugar no prueba que una cosa cause la otra; la correlación espacial hace "
                              "ruidosa la comparación con el azar.",
                        "en": "Coinciding in place does not prove that one causes the other; spatial correlation makes "
                              "the comparison with chance noisy."}}
    return {"level": level, "q_joint": q_joint.astype(np.float32), "p_joint": p_joint.astype(np.float32), "summary": summary}


def run_joint(layers: dict[str, dict], rules=RULES, *, q: float = 0.10, alpha: float = 0.05) -> dict:
    """Every rule whose two variables are present. -> {rule_id: apply_rule(...)}"""
    return {r.id: apply_rule(r, layers[r.a], layers[r.b], q=q, alpha=alpha) for r in rules if r.a in layers and r.b in layers}


def explain_cell(rule: Rule, i: int, out: dict, la: dict, lb: dict, units: dict | None = None) -> dict:
    """Template text for one cell, with HORI's numbers and nothing else. -> {"es": ..., "en": ...}"""
    units = units or {}
    lvl = int(out["level"][i])
    ea, eb = float(la["effect"][i]), float(lb["effect"][i])
    va, vb = int(la["verdict"][i]), int(lb["verdict"][i])
    from .verdict import CODES
    def part(var, e, v, lang):
        u = units.get(var, "")
        per = "/década" if lang == "es" else "/decade"
        return f"{_words(var, e, lang)} ({e:+.3g} {u}{per}, {CODES[v]})".replace("  ", " ")
    q = float(out["q_joint"][i])
    if lvl == 4:
        es = (f"Aquí {part(rule.a, ea, va, 'es')} y {part(rule.b, eb, vb, 'es')}. Las dos cosas ocurren en el mismo lugar y "
              f"periodo (q conjunto = {q:.3f}). HORI no dice que una cause la otra.")
        en = (f"Here {part(rule.a, ea, va, 'en')} and {part(rule.b, eb, vb, 'en')}. Both happen at the same place and period "
              f"(joint q = {q:.3f}). HORI does not say that one causes the other.")
    elif lvl == 3:
        es = (f"Aquí {part(rule.a, ea, va, 'es')} y {part(rule.b, eb, vb, 'es')}: cada cambio está probado en su propio mapa, "
              f"pero como afirmación conjunta sobre todo el mapa todavía no alcanza (q conjunto = {q:.2f}). HORI no dice que "
              f"una cause la otra.")
        en = (f"Here {part(rule.a, ea, va, 'en')} and {part(rule.b, eb, vb, 'en')}: each change is proven in its own map, "
              f"but as a joint claim over the whole map it is not there yet (joint q = {q:.2f}). HORI does not say that one "
              f"causes the other.")
    elif lvl == 2:
        es = f"Posible cambio conjunto: {part(rule.a, ea, va, 'es')} y {part(rule.b, eb, vb, 'es')}; todavía no alcanza para afirmarlo."
        en = f"Possible joint change: {part(rule.a, ea, va, 'en')} and {part(rule.b, eb, vb, 'en')}; not enough to state it yet."
    elif lvl == 1:
        es = f"Solo una de las dos: {part(rule.a, ea, va, 'es')}; {part(rule.b, eb, vb, 'es')}."
        en = f"Only one of the two: {part(rule.a, ea, va, 'en')}; {part(rule.b, eb, vb, 'en')}."
    else:
        es, en = "Sin cambio conjunto que afirmar aquí.", "No joint change to state here."
    return {"es": es, "en": en, "rule": rule.id, "level": LEVELS[lvl]}
