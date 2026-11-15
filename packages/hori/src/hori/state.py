"""One answer per entity to the six questions: what we observe, who it is, what is happening, what changed, what needs
attention, how it is followed — built ONLY from findings HORI already computed (no new statistics, no invented text).

    st = entity_state(entity, trends=[...], anomalies=[...], swarm=[...], alerts=[...], now="2026-09")
    st["headline"]["es"], st["priority"], st["unknowns"]

Priority is ONE list for every kind of finding, with fixed, explicit rules (capacity 5):
  P0  cambio conjunto (two or more independent signals agree: two variables, or instrument + swarm) · anomalía alta reciente
  P1  evento de tendencia (cruzó / se debilitó / cambió de signo) · anomalía media reciente · enjambre corroborado por instrumento
  P2  tendencia PROBADO · enjambre con evidencia
  P3  por emerger / candidata · anomalía leve reciente · señal ciudadana
  P4  lo demás (informativo: anomalías viejas, reportes aislados)
Inside a tier: by strength (|z|, |effect|/MDE or swarm score). Every item carries its reason, its evidence level (H16)
and its origin (H20). Texts are templates filled with numbers: no advice, no causes, no predictions (H17, H19).
"""
from __future__ import annotations

TIER_NAMES = {0: "P0", 1: "P1", 2: "P2", 3: "P3", 4: "P4"}
VERDICT_ES = {"PROBADO": "probada", "CANDIDATA": "candidata (sin confirmar)", "NO_CONCLUYENTE": "aún no se puede saber",
              "SIN_CAMBIO_MAYOR_QUE_DELTA": "sin cambio mayor que δ", "INSUFICIENTE": "datos insuficientes"}
ANOM_ES = {"punto": "un valor fuera de lo esperable", "racha": "una racha de valores fuera de lo esperable",
           "cambio_nivel": "un cambio de nivel sostenido", "sin_datos": "la fuente dejó de enviar datos",
           "fuera_de_rango": "valores imposibles (fuera del rango físico)", "congelado": "el sensor repite el mismo valor (posible falla)"}
# Plain reading of each flag (design doc «Modos de profundidad… v2» §3.2); the web has the same table in both languages.
FLAG_ES = {"depende_del_metodo": "según cómo se calcule, la señal aparece o no",
           "cambio_de_version": "la fuente cambió de versión a mitad del periodo",
           "cobertura_baja": "faltan datos en parte del periodo o de la zona",
           "resolucion_gruesa": "la zona es más chica que el detalle de los datos",
           "reconstruccion": "parte de los datos son reconstruidos, no medidos",
           "simulado": "datos simulados, no reales",
           "autocorrelacion_alta": "los años se parecen mucho entre sí; eso hace más difícil estar seguros",
           "quiebre_posible": "hay un salto brusco; podría ser del instrumento y no del fenómeno"}
LEVEL_ES = {"reporte_aislado": "un reporte aislado", "senal_ciudadana": "una señal ciudadana",
            "senal_con_evidencia": "una señal ciudadana con evidencia", "corroborada_por_instrumento": "una señal ciudadana que un instrumento confirma"}


def _recent(t_end: str, recent_from: str | None) -> bool:
    return recent_from is None or str(t_end) >= str(recent_from)


def _overlap(a: dict, b: dict) -> bool:
    return str(a["t_start"]) <= str(b["t_end"]) and str(b["t_start"]) <= str(a["t_end"])


def explain(item: dict) -> str:
    """The plain-language line of one finding: what changed · how sure · what we do not know · origin. Templates only."""
    k = item["kind"]
    if k == "tendencia":
        t = item
        s = (f"{t['variable']}: tendencia {VERDICT_ES.get(t['verdict'], t['verdict'])}, {t['effect']:+.2f} {t['unit']}/década "
             f"(rango 95 %: {t['ci'][0]:+.2f} a {t['ci'][1]:+.2f}).")
        if t["verdict"] == "NO_CONCLUYENTE" and t.get("years_more") is not None:
            s += f" Faltan ~{int(t['years_more'])} año{'' if int(t['years_more']) == 1 else 's'} de datos para poder ver un cambio de {t['delta']:g} {t['unit']}/década."
        if t.get("event"):
            s += f" Cambió con el último dato: {t['event'].lower().replace('_', ' ')}."
        return s + " [Calculado por HORI]"
    if k == "anomalia":
        a = item
        z = a.get("peak_z", a.get("mean_z"))
        s = f"{a['variable']}: {ANOM_ES.get(a['type'], a['type'])} entre {a['t_start']} y {a['t_end']}"
        s += f" ({z:+.1f}σ, gravedad estadística {a['severity']})." if z is not None else f" (gravedad {a['severity']})."
        return s + " Es una desviación estadística, no prueba de falla ni de peligro. [Calculado por HORI]"
    if k == "enjambre":
        w = item
        s = (f"Enjambre ({w['theme']}): {LEVEL_ES.get(w['level'], w['level'])} — {w['independent_reporters']} reportante(s) "
             f"independiente(s), {w['evidence_items']} evidencia(s). {w['reasons'][-1][:1].upper() + w['reasons'][-1][1:]}.")
        if w.get("calibration"):
            c = w["calibration"]
            s += (f" En datos reales, señales así coinciden con el satélite {c['agree_real_data']:.0%} de las veces "
                  f"(azar: {c['chance']:.0%}).")
        if w.get("flags"):
            s += f" Avisos: {', '.join(w['flags'])}."
        return s + " Fuente no verificada. [Contexto ciudadano, clasificado por HORI]"
    if k == "conjunto":
        return (f"Cambio conjunto: {item['what']} coinciden en el tiempo ({item['t_start']} a {item['t_end']}). Dos señales independientes "
                f"que coinciden pesan más que una sola; no dicen la causa. [Calculado por HORI]")
    return str(item)


def entity_state(entity: dict, *, trends: list | None = None, anomalies: list | None = None, swarm: list | None = None,
                 alerts: list | None = None, now: str | None = None, recent_from: str | None = None, sources: list | None = None) -> dict:
    """Assemble the six answers. trends: [{variable, unit, verdict, effect, ci, mde, delta, years_more, event?, flags?}];
    anomalies: anomaly events + {"variable"}; swarm: hori.swarm.signals output; alerts: zon alert dicts (optional)."""
    trends, anomalies, swarm, alerts = trends or [], anomalies or [], swarm or [], alerts or []
    items = []
    for t in trends:
        tier = 1 if t.get("event") else 2 if t["verdict"] == "PROBADO" else 3 if t["verdict"] in ("CANDIDATA",) or \
            (t["verdict"] == "NO_CONCLUYENTE" and (t.get("years_more") or 99) <= 5) else 4
        strength = abs(t["effect"]) / t["mde"] if t.get("mde") else 0.0
        items.append({"kind": "tendencia", **t, "tier": tier, "strength": round(strength, 2),
                      "evidence_level": "observacion", "origin": "HORI"})
    for a in anomalies:
        rec = _recent(a["t_end"], recent_from)
        sev = a["severity"]
        tier = (0 if sev == "alta" else 1 if sev == "media" else 3) if rec else 4
        if a["type"] in ("congelado", "fuera_de_rango", "sin_datos") and rec:
            tier = min(tier, 1)                                          # a sick sensor must be looked at before trusting it
        items.append({"kind": "anomalia", **a, "tier": tier, "recent": rec,
                      "strength": round(abs(a.get("peak_z", a.get("mean_z", 0)) or 0), 2), "evidence_level": "observacion", "origin": "HORI"})
    for w in swarm:
        tier = {"corroborada_por_instrumento": 1, "senal_con_evidencia": 2, "senal_ciudadana": 3}.get(w["level"], 4)
        items.append({"kind": "enjambre", **w, "tier": tier, "strength": w["score"], "origin": "enjambre (no verificado)"})
    # multi-signal: recent anomalies of DIFFERENT variables that overlap in time, or an instrument-corroborated swarm signal
    rec_an = [a for a in items if a["kind"] == "anomalia" and a["recent"] and a["type"] not in ("sin_datos", "congelado", "fuera_de_rango")]
    seen = set()
    for i, a in enumerate(rec_an):
        for b in rec_an[i + 1:]:
            if a["variable"] != b["variable"] and _overlap(a, b):
                key = tuple(sorted((a["variable"], b["variable"])))
                if key not in seen:
                    seen.add(key)
                    items.append({"kind": "conjunto", "what": f"{a['variable']} y {b['variable']}", "t_start": min(a["t_start"], b["t_start"]),
                                  "t_end": max(a["t_end"], b["t_end"]), "tier": 0, "strength": a["strength"] + b["strength"],
                                  "evidence_level": "asociacion", "origin": "HORI"})
    for w in [x for x in items if x["kind"] == "enjambre" and x["level"] == "corroborada_por_instrumento"]:
        items.append({"kind": "conjunto", "what": f"el enjambre ({w['theme']}) y el instrumento {w['instrument_variable']}",
                      "t_start": w["t_start"], "t_end": w["t_end"], "tier": 0, "strength": w["score"], "evidence_level": "asociacion",
                      "origin": "HORI + enjambre"})
    items.sort(key=lambda x: (x["tier"], -x["strength"]))
    for it in items:
        it["priority"] = TIER_NAMES[it["tier"]]
        it["text_es"] = explain(it)
    top = items[0] if items else None
    status = ("atencion" if top and top["tier"] <= 1 else "hallazgos" if top and top["tier"] == 2 else
              "vigilando" if top and top["tier"] == 3 else "sin_novedad")
    unknowns = []
    for t in trends:
        if t["verdict"] in ("NO_CONCLUYENTE", "INSUFICIENTE"):
            unknowns.append(f"{t['variable']}: " + (f"aún no se puede saber; faltan ~{int(t['years_more'])} año{'' if int(t['years_more']) == 1 else 's'}" if t.get("years_more")
                                                    else "datos insuficientes"))
        for f in t.get("flags", []):
            unknowns.append(f"{t['variable']}: {FLAG_ES.get(f, 'bandera ' + f)}")
    for w in swarm:
        if w.get("instrument_variable") is None:
            unknowns.append(f"enjambre «{w['theme']}»: ningún instrumento conectado puede confirmarlo ni descartarlo")
    open_alerts = [a for a in alerts if a.get("state") != "cerrada"]
    return {
        "entity": {k: entity.get(k) for k in ("id", "type", "body", "name", "status")},            # 1 · what we observe
        "identity": {"status": entity.get("status"), "source": entity.get("source", {}),            # 2 · who it is
                     "verified": entity.get("status") == "real" and bool(entity.get("source")),
                     "note": "Identidad = procedencia de los datos y estado real/simulada; no hay verificación criptográfica de la entidad."},
        "status": status,                                                                         # 3 · what is happening
        "headline": {"es": top["text_es"] if top else "Sin novedad: no hay tendencias probadas, anomalías recientes ni señales del enjambre.",
                     "priority": top["priority"] if top else None},
        "changes": [i for i in items if (i["kind"] == "tendencia" and i.get("event")) or (i["kind"] == "anomalia" and i["recent"])
                    or i["kind"] == "conjunto"],                                                  # 4 · what changed
        "attention": [i for i in items if i["tier"] <= 1],                                         # 5 · what needs attention
        "follow_up": {"open_alerts": len(open_alerts), "by_state": {s: sum(1 for a in alerts if a.get("state") == s)  # 6 · follow-up
                                                                    for s in ("abierta", "reconocida", "derivada", "cerrada")}},
        "priority": items, "unknowns": unknowns, "sources": sources or [],
        "honesty": {"es": "Todo número sale de HORI; el enjambre es fuente no verificada; una anomalía no es prueba de peligro; sin consejos.",
                    "rules": "P0 conjunto/anomalía alta · P1 evento/anomalía media/enjambre corroborado · P2 PROBADO/enjambre con evidencia · "
                             "P3 por emerger/anomalía leve/señal ciudadana · P4 resto"},
    }
