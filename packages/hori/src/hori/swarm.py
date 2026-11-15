"""The SWARM («enjambre»): what people and other non-instrument sources report, scored with explicit rules.

A neighbour says the river dried up; another one says the fish are dying; a third says the sky is dark; a scientist
reports a change in the air. None of that is a measurement, and HORI never calls it proven. What HORI can do honestly:
  1. classify every report as a NON-VERIFIED source (unless the reporter's identity is verified by an institution);
  2. group reports that are close in space and time and talk about the same thing (theme);
  3. raise or lower confidence with rules anyone can read: INDEPENDENT reporters, attached EVIDENCE (counted once per
     file hash), verified expertise, and whether a NASA instrument sees the same thing in the same place and time;
  4. flag what looks like manipulation (one reporter dominating, the same evidence file reused, bursts).
The output is a LEVEL on a ladder, not a probability:
  reporte_aislado < senal_ciudadana < senal_con_evidencia < corroborada_por_instrumento
Role/evidence weights are WORKING VALUES of the team (stated, versioned); the value of «k independent reporters» is MEASURED
on real citizen reports (CALIBRATION_K below): agreement with the satellite grows from 25 % (1 person) to 53 % (10+)
while chance falls from 15 % to 4 %. That is what justifies «3 or more» for a citizen signal.
Themes come from a fixed keyword table (deterministic, no language model): a word not in the table is «otro».
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import defaultdict

SWARM_VERSION = "enjambre-2"
REPORTER_WEIGHT = {"persona": 1.0, "cientifico": 2.0, "institucion": 2.5, "sensor_ciudadano": 1.5}
UNVERIFIED_CEILING = 1.0              # a claimed role without verification counts as an unverified person
EVIDENCE_FACTOR = {"foto": 1.3, "video": 1.3, "medicion": 1.6, "documento": 1.2}
EVIDENCE_CAP = 2.0
LEVELS = ("reporte_aislado", "senal_ciudadana", "senal_con_evidencia", "corroborada_por_instrumento")
THEMES = {   # theme -> (keywords ES+EN, instrument variable that could see it, direction words). Keywords are word PREFIXES.
    "agua": (("rio", "arroyo", "presa", "lago", "pozo", "agua", "seco", "seca", "sequia", "inund", "lluvia", "llueve", "humed",
              "river", "creek", "stream", "pond", "lake", "well", "water", "dry", "drie", "drought", "parched", "rain", "flood",
              "soggy", "wet", "moist", "soil", "saturat", "puddl"), "PRECTOTCORR",
             {"bajo": ("seco", "seca", "sequia", "sin agua", "no llueve", "dry", "drie", "drought", "parched", "crack", "no rain",
                       "dusty", "brown"),
              "alto": ("inund", "crecida", "desbord", "mucha lluvia", "flood", "soggy", "saturat", "standing water", "puddl",
                       "heavy rain", "muddy")}),
    "fauna": (("pez", "peces", "aves", "pajaro", "ganado", "animal", "muert", "murie", "fish", "bird", "cattle", "livestock",
               "wildlife", "deer", "dead", "dying"), None, {}),
    "atmosfera": (("cielo", "humo", "polvo", "neblina", "aire", "atmosf", "oscuro", "olor", "ceniza", "sky", "smoke", "haze",
                   "dust", "ash"), None, {}),
    "temperatura": (("calor", "frio", "helada", "temperatura", "caliente", "heat", "hot", "cold", "freez", "frost", "temperat"), "T2M",
                    {"alto": ("calor", "caliente", "heat", "hot"), "bajo": ("frio", "helada", "cold", "freez", "frost")}),
    "vegetacion": (("arbol", "pasto", "cultivo", "hojas", "planta", "bosque", "tree", "grass", "crop", "lawn", "leaves", "plant",
                    "corn", "wheat", "pasture", "garden"), None, {}),
}
# MEASURED on 180,069 real citizen reports (CoCoRaHS condition monitoring, USA 2016-2026, 8,483 people) against NASA POWER
# rain accumulated over 3 months (robust z, |z| >= 1 in the same sense); chance = same place and calendar month, another year.
# sim/swarm_validation_cocorahs.py. What a signal of k independent reporters is worth in REAL data:
CALIBRATION_K = {   # k-bin: (agree with the satellite, chance level)
    "1": (0.253, 0.146), "2": (0.299, 0.109), "3-4": (0.327, 0.092), "5-9": (0.371, 0.064), "10+": (0.527, 0.043)}
CALIBRATION_SOURCE = "CoCoRaHS (EE. UU., 2016-2026) frente a NASA POWER, lluvia acumulada 3 meses; sim/swarm_validation_cocorahs.py"


def calibration_for(k: int) -> dict:
    kb = "1" if k <= 1 else "2" if k == 2 else "3-4" if k <= 4 else "5-9" if k <= 9 else "10+"
    a, c = CALIBRATION_K[kb]
    return {"k_bin": kb, "agree_real_data": a, "chance": c, "lift": round(a / c, 1), "source": CALIBRATION_SOURCE,
            "scope": "medido para reportes de seco/húmedo comparados con lluvia; otros temas no están calibrados"}


NOTE_ES = ("Fuente NO verificada: reportes de personas u otras fuentes que no son un instrumento. Suben o bajan la confianza "
           "con reglas explícitas, pero nunca son prueba de un daño o un peligro.")


def _norm(t: str) -> str:
    return unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().lower()


def _hit(k: str, words: list[str], padded: str) -> bool:
    """A keyword is a word PREFIX («inund» → inundación), a phrase is matched whole: «frío» must not match «río»."""
    return f" {k} " in padded if " " in k else any(w.startswith(k) for w in words)


def classify(text: str) -> tuple[list[str], dict]:
    """(themes, direction per theme) from fixed keyword lists."""
    t = _norm(text)
    words = re.findall(r"[a-z0-9]+", t)
    padded = " " + " ".join(words) + " "
    themes, direction = [], {}
    for th, (kws, _, dirs) in THEMES.items():
        if any(_hit(k, words, padded) for k in kws):
            themes.append(th)
            for d, ws in dirs.items():
                if any(_hit(w, words, padded) for w in ws):
                    direction[th] = d
    return themes or ["otro"], direction


def report_weight(rep: dict, seen_hashes: set) -> tuple[float, list[str]]:
    """Weight of ONE report: role (only if verified) x evidence (new file hashes only, capped). Returns (weight, reasons)."""
    who = rep.get("reporter", {})
    role = who.get("type", "persona")
    base = REPORTER_WEIGHT.get(role, 1.0) if who.get("verified") else min(REPORTER_WEIGHT.get(role, 1.0), UNVERIFIED_CEILING)
    why = [f"{role}{' verificado' if who.get('verified') else ' (no verificado)'}: {base:g}"]
    f = 1.0
    for ev in rep.get("evidence", []):
        h = ev.get("sha256")
        if not h:
            why.append(f"evidencia {ev.get('type')} sin huella: no cuenta")
            continue
        if h in seen_hashes:
            why.append(f"evidencia {ev.get('type')} repetida (misma huella): no cuenta otra vez")
            continue
        seen_hashes.add(h)
        f *= EVIDENCE_FACTOR.get(ev.get("type"), 1.0)
        why.append(f"evidencia {ev.get('type')} ×{EVIDENCE_FACTOR.get(ev.get('type'), 1.0):g}")
    f = min(f, EVIDENCE_CAP)
    return base * f, why


def _km(a: tuple, b: tuple) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def _days(a: str, b: str) -> float:
    from datetime import datetime
    f = lambda s: datetime.fromisoformat(s[:19])
    return abs((f(a) - f(b)).total_seconds()) / 86400.0


def signals(reports: list[dict], *, radius_km: float = 30.0, window_days: float = 21.0,
            instrument: callable | None = None) -> list[dict]:
    """Reports -> swarm signals (one per theme and space-time cluster), with level, score, reasons and flags.

    `instrument(theme, variable, lat, lon, t_start, t_end)` -> {"seen": bool, "direction": "alto"|"bajo"|None, "detail": str}
    or None when no instrument covers it. Corroboration requires the SAME direction when the reports state one.
    """
    by_theme = defaultdict(list)
    for r in reports:
        th, dirs = classify(r.get("text", "") + " " + r.get("kind", ""))
        if r.get("direction") in ("alto", "bajo") and r.get("theme"):           # a structured answer beats the keywords
            th, dirs = sorted(set(th) | {r["theme"]} - {"otro"}), {**dirs, r["theme"]: r["direction"]}
        for t in th:
            by_theme[t].append((r, dirs.get(t)))
    out = []
    for theme, items in by_theme.items():
        n = len(items)
        parent = list(range(n))

        def root(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for i in range(n):
            for j in range(i + 1, n):
                a, b = items[i][0], items[j][0]
                if _km((a["lat"], a["lon"]), (b["lat"], b["lon"])) <= radius_km and _days(a["time"], b["time"]) <= window_days:
                    parent[root(i)] = root(j)
        groups = defaultdict(list)
        for i in range(n):
            groups[root(i)].append(items[i])
        for g in groups.values():
            out.append(_score(theme, g, instrument))
    out.sort(key=lambda s: (-LEVELS.index(s["level"]), -s["score"]))
    return out


def _score(theme: str, group: list, instrument) -> dict:
    seen, per_reporter, reasons, flags = set(), {}, [], []
    hashes_all = defaultdict(set)
    for rep, _ in sorted(group, key=lambda x: x[0]["time"]):
        w, why = report_weight(rep, seen)
        rid = rep.get("reporter", {}).get("id", rep.get("id"))
        for ev in rep.get("evidence", []):
            if ev.get("sha256"):
                hashes_all[ev["sha256"]].add(rid)
        if w > per_reporter.get(rid, (0, None))[0]:                      # a reporter counts ONCE: their strongest report
            per_reporter[rid] = (w, why)
    score = sum(w for w, _ in per_reporter.values())
    independent = len(per_reporter)
    evid = sum(1 for _ in seen)
    measured = any(ev.get("type") == "medicion" and ev.get("sha256") for rep, _ in group for ev in rep.get("evidence", []))
    if independent and max(w for w, _ in per_reporter.values()) / score > 0.5 and independent >= 2:
        flags.append("un_reportero_domina")
    if any(len(r) > 1 for r in hashes_all.values()):
        flags.append("evidencia_reutilizada_por_varios")
    times = sorted(rep["time"] for rep, _ in group)
    if len(times) >= 5 and _days(times[0], times[-1]) < 1 / 144:       # 5+ reports inside 10 minutes
        flags.append("rafaga")
    dirs = [d for _, d in group if d]
    direction = max(set(dirs), key=dirs.count) if dirs else None
    lat = sum(r["lat"] for r, _ in group) / len(group)
    lon = sum(r["lon"] for r, _ in group) / len(group)
    level = "reporte_aislado"
    if independent >= 3 or score >= 3.0:
        level = "senal_ciudadana"
    if level == "senal_ciudadana" and (evid >= 2 or measured):
        level = "senal_con_evidencia"
    var = THEMES.get(theme, ((), None, {}))[1]
    inst = None
    if instrument is not None and var is not None:
        inst = instrument(theme, var, lat, lon, times[0], times[-1])
        if inst and inst.get("seen") and (direction is None or inst.get("direction") == direction) and independent >= 2:
            level = "corroborada_por_instrumento"
    if "rafaga" in flags and level != "corroborada_por_instrumento":
        level = LEVELS[max(0, LEVELS.index(level) - 1)]                  # a burst cannot climb on its own
    reasons = [f"{independent} reportante(s) independiente(s), índice {score:.2f}", f"{evid} evidencia(s) distinta(s)"
               + (" (incluye medición)" if measured else "")]
    if var is None:
        reasons.append("ningún instrumento conectado puede ver este tema (no se puede corroborar ni contradecir)")
    elif inst is None:
        reasons.append(f"sin dato de instrumento ({var}) para ese lugar y fecha")
    else:
        reasons.append(("el instrumento lo ve: " if inst.get("seen") else "el instrumento NO lo ve (puede ser local o menor "
                        "a su resolución; no lo desmiente): ") + inst.get("detail", ""))
    return {"theme": theme, "level": level, "score": round(score, 3), "independent_reporters": independent,
            "evidence_items": evid, "direction": direction, "lat": round(lat, 4), "lon": round(lon, 4),
            "t_start": times[0], "t_end": times[-1], "reports": [r.get("id") for r, _ in group], "flags": flags,
            "instrument": inst, "instrument_variable": var, "reasons": reasons,
            "per_reporter": {k: {"weight": round(w, 3), "why": why} for k, (w, why) in per_reporter.items()},
            "source_class": "no_verificada", "evidence_level": "asociacion" if level == "corroborada_por_instrumento" else "observacion_ciudadana",
            "simulated": all(r.get("simulated") for r, _ in group), "note_es": NOTE_ES, "version": SWARM_VERSION,
            "calibration": calibration_for(independent) if theme == "agua" else None}
