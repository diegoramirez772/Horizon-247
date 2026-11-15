"use client";

// Monitoreo · «Persona»: the person profile of the contract, in the web. One body signal at a regular cadence, watched with
// HORI's anomaly detector (period = one day). The simulated week says SIMULADO everywhere and lists what was injected, so you
// can see the detector find it; your own file is read in this browser and never leaves it.

import { useMemo, useState } from "react";
import { num } from "@/core/format/format";
import type { Lang } from "@/core/i18n/texts";
import { detect, events, type AnomalyEvent } from "@/core/watch/anomaly";
import { type PersonSeries, parsePersonCsv, simulatePerson } from "@/core/watch/person";
import { WatchChart } from "./WatchChart";

const C = {
  es: {
    title: "Persona", sim: "SIMULADO", simNote: "Datos inventados para mostrar el flujo: no son de una persona real ni tecnología médica validada. Lo inyectado a propósito:",
    own: "Usar mi archivo (CSV: tiempo, valor)", ownNote: "Tu archivo se lee aquí, en tu navegador; no se sube a ningún lado.",
    back: "Volver a la semana simulada", few: "El archivo necesita al menos 50 filas con fecha y número.", cadence: "No pude saber cada cuánto se midió.",
    found: "Lo que encontró el detector", nothing: "Sin desviaciones: cada momento se parece a ese mismo momento de los días anteriores.",
    type: { punto: "Valor fuera de lo común", racha: "Racha fuera de lo común", cambio_nivel: "Cambio sostenido", sin_datos: "Sin datos", fuera_de_rango: "Lectura imposible", congelado: "Valor congelado" },
    dir: { alto: "alto", bajo: "bajo" }, sev: { leve: "leve", media: "media", alta: "alta" },
    period: (n: number) => `${n} muestras por día`,
    honesty: "Una anomalía es una desviación estadística frente al pasado de la MISMA persona a la misma hora: no dice qué le pasa ni sustituye a un profesional de la salud.",
    method: "Detector de anomalías de HORI (el mismo que en Python y en ZON), con periodo de un día: valor fuera de lo común |z| ≥ 3,5, cambio sostenido por CUSUM, huecos, lecturas imposibles y valores congelados.",
    hits: (a: number, b: number) => `Encontró ${a} de ${b} eventos inyectados.`,
  },
  en: {
    title: "Person", sim: "SIMULATED", simNote: "Made-up data to show the flow: not from a real person, not validated medical technology. Injected on purpose:",
    own: "Use my file (CSV: time, value)", ownNote: "Your file is read here, in your browser; it is not uploaded anywhere.",
    back: "Back to the simulated week", few: "The file needs at least 50 rows with a date and a number.", cadence: "Could not tell how often it was measured.",
    found: "What the detector found", nothing: "No departures: each moment looks like that same moment on previous days.",
    type: { punto: "Unusual value", racha: "Unusual run", cambio_nivel: "Sustained shift", sin_datos: "No data", fuera_de_rango: "Impossible reading", congelado: "Frozen value" },
    dir: { alto: "high", bajo: "low" }, sev: { leve: "mild", media: "medium", alta: "high" },
    period: (n: number) => `${n} samples per day`,
    honesty: "An anomaly is a statistical departure from the SAME person's past at the same time of day: it does not say what is happening to them nor replace a health professional.",
    method: "HORI's anomaly detector (the same as in Python and ZON), with a one-day period: unusual value |z| ≥ 3.5, sustained shift by CUSUM, gaps, impossible readings and frozen values.",
    hits: (a: number, b: number) => `Found ${a} of ${b} injected events.`,
  },
};

function eventLine(e: AnomalyEvent, lang: Lang): string {
  const c = C[lang];
  const when = e.tStart === e.tEnd ? e.tStart : `${e.tStart} → ${e.tEnd}`;
  const z = e.peakZ ?? e.meanZ;
  return `${c.type[e.type]}${e.direction ? ` (${c.dir[e.direction]})` : ""} · ${when}${z !== undefined && Number.isFinite(z) ? ` · z ${num(z, lang, 1)}` : ""}`;
}

export function PersonPanel({ lang }: { lang: Lang }) {
  const c = C[lang];
  const sim = useMemo(() => simulatePerson(), []);
  const [series, setSeries] = useState<PersonSeries>(sim);
  const [err, setErr] = useState<string | null>(null);
  const res = useMemo(() => detect(series.values, series.period, { valid_range: series.validRange }), [series]);
  const evs = useMemo(() => events(res, series.times), [res, series]);
  const shown = evs.filter((e) => e.type !== "punto" || e.severity !== "leve" || evs.length < 12);
  const found = series.truth?.filter((t) => evs.some((e) => e.start <= t.end && e.end >= t.start)).length ?? 0;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parsePersonCsv(await f.text());
    if ("error" in r) { setErr(r.error === "few" ? c.few : c.cadence); return; }
    setErr(null);
    setSeries(r);
  };

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <section>
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3">{c.title}</h2>
          {series.simulated ? <span className="rounded-full bg-sim px-2 py-0.5 text-[11px] font-semibold text-on-sim">{c.sim}</span> : null}
        </div>
        <p className="mt-1 font-semibold">{series.name[lang]} <span className="font-normal text-text-2">· {series.unit} · {c.period(series.period)}</span></p>
        <WatchChart values={series.values} labels={series.times} events={evs} label={series.name[lang]} height={130} />
        {series.simulated && series.truth ? (
          <div className="mt-2 text-xs leading-5 text-text-2">
            <p>{c.simNote}</p>
            <ul className="ml-4 list-disc">{series.truth.map((t, k) => <li key={k}>{t.what[lang]}</li>)}</ul>
            <p className="mt-1 font-medium text-text">{c.hits(found, series.truth.length)}</p>
          </div>
        ) : null}
      </section>

      <section>
        <h3 className="text-sm font-semibold">{c.found}</h3>
        {shown.length ? (
          <ul className="mt-1 space-y-1 text-sm">
            {shown.map((e, k) => (
              <li key={k} className="flex gap-2">
                <span className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${e.severity === "leve" ? "bg-surface-2 text-text-2" : "bg-accent text-on-accent"}`}>{c.sev[e.severity]}</span>
                <span>{eventLine(e, lang)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-text-2">{c.nothing}</p>}
      </section>

      <section className="space-y-2">
        <label className="inline-flex cursor-pointer items-center rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2">
          {c.own}
          <input type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {!series.simulated ? <button type="button" onClick={() => setSeries(sim)} className="ml-2 text-xs underline underline-offset-2">{c.back}</button> : null}
        <p className="text-xs text-text-3">{c.ownNote}</p>
        {err ? <p role="alert" className="text-sm text-text-2">{err}</p> : null}
      </section>

      <section className="space-y-2 text-xs leading-5 text-text-2">
        <p>{c.honesty}</p>
        <p>{c.method}</p>
      </section>
    </div>
  );
}
