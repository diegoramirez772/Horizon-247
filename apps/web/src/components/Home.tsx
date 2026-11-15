"use client";

import { useMemo, useState } from "react";
import type { HomeDoc, HomeEntity, HomeMonitor } from "@/contract/types";
import { certaintyText } from "@/core/honesty/calibration";
import { loadSeen, markSeen, saveSeen, unseen } from "@/core/home/cursor";
import {
  attentionText, eventText, monitorName, presentMonitor, sourcesFor, staleSources, STATUS, unknowns,
} from "@/core/home/present";
import type { Lang, Register } from "@/core/i18n/texts";
import { prettyUnit } from "@/core/format/format";
import { Spark, VerdictGlyph } from "./ui";
import { SeriesChart } from "./SeriesChart";

const T = {
  es: {
    title: "Mis monitores", sub: "Lo que sigues, qué cambió y qué pide atención. Sin abrir el globo.",
    changed: "Qué cambió desde tu última visita", attention: "Qué atender", quality: "Calidad de los datos", unknown: "Lo que aún no se sabe",
    nothingNew: "Nada nuevo desde tu última visita.", nothingAttention: "Nada pide atención.", qualityOk: "Las fuentes están al día.",
    seen: "Lo vi", seenAll: "Marcar todo como visto", sure: "¿Qué tan seguro es?", hideSure: "Ocultar", ask: "Preguntar por esto",
    priority: "Prioridad", fresh: "Nuevo", note: "Promedios regionales de celdas de ~50 km. Una anomalía es una desviación estadística. Sin consejos.",
  },
  en: {
    title: "My monitors", sub: "What you follow, what changed and what needs attention. No globe needed.",
    changed: "What changed since your last visit", attention: "Needs attention", quality: "Data quality", unknown: "What is not known yet",
    nothingNew: "Nothing new since your last visit.", nothingAttention: "Nothing needs attention.", qualityOk: "Sources are up to date.",
    seen: "Seen", seenAll: "Mark all as seen", sure: "How sure is it?", hideSure: "Hide", ask: "Ask about this",
    priority: "Priority", fresh: "New", note: "Regional means of ~50 km cells. An anomaly is a statistical deviation. No advice.",
  },
};

/**
 * «Mis monitores» (design doc «Modos de profundidad… v2» §5): the start screen answers what I follow, what changed and
 * what needs attention, from home.json (SPEC §15). The level changes how much is said, never what is said.
 */
export function MonitorsHome({ doc, lang, register, onAsk }: {
  doc: HomeDoc; lang: Lang; register: Register; onAsk: (text: string) => void;
}) {
  const t = T[lang];
  // Rendered only on the client, after home.json arrived: reading localStorage here is safe (and guarded).
  const [seen, setSeen] = useState<string[]>(loadSeen);
  const see = (ids: string[]) => setSeen((s) => { const n = markSeen(s, ids); saveSeen(n); return n; });
  const [sure, setSure] = useState(false);

  const fresh = useMemo(() => unseen(doc.events, seen), [doc.events, seen]);
  const changes = fresh.filter((e) => e.tray === "evidencia");
  const quality = [...fresh.filter((e) => e.tray === "calidad").map((e) => ({ id: e.id, text: eventText(e, doc, lang) })),
    ...staleSources(doc, new Date(), lang).map((x, i) => ({ id: `stale-${i}`, text: x }))];
  const attention = doc.entities.flatMap((ent) => ent.state.attention.map((it, i) => ({ id: `${ent.entity.id}-${i}`, text: attentionText(it, ent, lang) })));
  const notYet = unknowns(doc, lang);

  return (
    <section aria-labelledby="home-title" className="relative mx-auto w-full max-w-[760px] px-4 pb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="home-title" className="text-lg font-semibold">{t.title}</h2>
          <p className="text-sm text-text-2">{t.sub}</p>
        </div>
        <button type="button" onClick={() => setSure((x) => !x)} aria-expanded={sure}
          className="rounded-full border border-border px-3 py-1.5 text-sm text-text-2 hover:border-accent hover:text-accent">
          {sure ? t.hideSure : t.sure}
        </button>
      </div>
      {sure ? <p role="note" className="mb-3 rounded-2xl bg-surface-2 p-3 text-sm leading-6">{certaintyText(register, lang, doc.calibration)}</p> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Tray title={t.changed} count={changes.length} empty={t.nothingNew}
          action={changes.length > 1 ? { label: t.seenAll, run: () => see(changes.map((e) => e.id)) } : null}>
          {changes.map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-semibold uppercase text-on-accent">{t.fresh}</span>
              <span className="min-w-0 flex-1">{eventText(e, doc, lang)}</span>
              <button type="button" onClick={() => see([e.id])} className="shrink-0 text-xs font-medium text-text-2 underline underline-offset-2 hover:text-text">{t.seen}</button>
            </li>
          ))}
        </Tray>
        <Tray title={t.attention} count={attention.length} empty={t.nothingAttention}>
          {attention.map((a) => <li key={a.id}>{a.text}</li>)}
        </Tray>
        <Tray title={t.quality} count={quality.length} empty={t.qualityOk}>
          {quality.map((q) => <li key={q.id}>{q.text}</li>)}
        </Tray>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {doc.entities.flatMap((ent) => ent.monitors.map((mon) => (
          <li key={mon.id}><MonitorCard ent={ent} mon={mon} lang={lang} register={register} onAsk={onAsk} /></li>
        )))}
      </ul>

      {notYet.length ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border p-3">
          <h3 className="text-sm font-semibold">{t.unknown}</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-text-2">
            {(register === "sencillo" ? notYet.slice(0, 3) : notYet).map((x) => <li key={x}>{x}</li>)}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-text-3">{t.note}</p>
    </section>
  );
}

function Tray({ title, count, empty, action = null, children }: {
  title: string; count: number; empty: string; action?: { label: string; run: () => void } | null; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {title}<span className="tabular rounded-full bg-surface-2 px-2 text-xs font-medium text-text-2">{count}</span>
      </h3>
      {count ? <ul className="mt-2 flex flex-col gap-2 text-sm">{children}</ul> : <p className="mt-2 text-sm text-text-3">{empty}</p>}
      {action ? <button type="button" onClick={action.run} className="mt-2 text-xs font-medium text-text-2 underline underline-offset-2 hover:text-text">{action.label}</button> : null}
    </div>
  );
}

function MonitorCard({ ent, mon, lang, register, onAsk }: {
  ent: HomeEntity; mon: HomeMonitor; lang: Lang; register: Register; onAsk: (text: string) => void;
}) {
  const v = presentMonitor(mon, register, lang, sourcesFor(mon));
  const t = T[lang];
  const item = ent.state.priority.find((p) => p.kind === "tendencia" && p.variable === mon.variable.label.es);
  const values = mon.series.values.map((x) => (x === null ? NaN : x));
  const name = monitorName(ent, mon, lang);
  const tl = mon.timeline;
  return (
    <article className="rounded-2xl border border-border bg-surface p-4" aria-label={name}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{name}</h3>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-2">{STATUS[ent.state.status][lang]}</span>
        {register !== "sencillo" && item ? <span className="tabular rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-2">{t.priority} {item.priority}</span> : null}
        {!mon.data.data_real ? <span className="rounded-full bg-sim/70 px-2 py-0.5 text-xs font-medium text-on-sim">{lang === "es" ? "SIMULADO" : "SIMULATED"}</span> : null}
      </header>
      <div className="mt-2 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold"><VerdictGlyph v={v.verdict} />{v.phrase}</p>
          {v.figure ? <p className="tabular mt-0.5 text-lg font-semibold leading-tight">{v.figure}</p> : null}
          <p className="mt-1 text-[15px] leading-6 text-pretty">{v.sentence}</p>
          {v.since ? <p className="mt-1 text-sm text-text-2">{v.since}</p> : null}
        </div>
        {register === "sencillo" ? <Spark values={values} highlight={v.verdict === 1} /> : null}
      </div>
      {register !== "sencillo" && mon.series.years.length ? (
        <div className="mt-3">
          <SeriesChart values={values} years={mon.series.years} effect={mon.finding.effect ?? NaN}
            unit={prettyUnit(mon.variable.unit, lang)} lang={lang} showTrend={v.verdict === 1} />
          {tl ? <EvidenceStrip ends={tl.ends} verdicts={tl.verdict} lang={lang} /> : null}
        </div>
      ) : null}
      <ul aria-label={lang === "es" ? "Límites" : "Limits"} className="mt-3 flex flex-col gap-1 text-sm text-text-2">
        {v.limits.map((l) => (
          <li key={l.key} className="flex gap-1.5">
            <span aria-hidden="true">⚠︎</span><span>{l.text[lang]}{register === "tecnico" && l.bit !== null ? <span className="tabular text-text-3"> · bit {l.bit}</span> : null}</span>
          </li>
        ))}
      </ul>
      {v.capability ? <p className="mt-1 text-sm text-text-2">{v.capability}</p> : null}
      {v.expert ? (
        <table className="tabular mt-3 w-full text-sm">
          <tbody>
            {v.expert.map(([k, x]) => (
              <tr key={k} className="border-b border-border last:border-0">
                <th scope="row" className="py-1 pr-3 text-left font-normal text-text-2">{k}</th><td className="break-all py-1 text-right">{x}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-3">{v.dataLine}</p>
        <button type="button" onClick={() => onAsk(lang === "es" ? `¿Qué tan seguro es ${name.toLocaleLowerCase("es")}?` : `How sure is ${name}?`)}
          className="rounded-full border border-border px-3 py-1 text-sm hover:border-accent hover:text-accent">{t.sure}</button>
      </footer>
    </article>
  );
}

/** «Desde cuándo se sabe»: the verdict of each growing window, one square per year (nested windows, not independent). */
function EvidenceStrip({ ends, verdicts, lang }: { ends: number[]; verdicts: number[]; lang: Lang }) {
  const label = lang === "es" ? "Evolución de la evidencia: veredicto con los datos hasta cada año" : "Evolution of the evidence: verdict with data up to each year";
  return (
    <figure className="m-0 mt-2">
      <div role="img" aria-label={`${label}. ${ends.map((y, i) => `${y}: ${verdicts[i]}`).join(", ")}`} className="flex gap-[2px]">
        {ends.map((y, i) => <span key={y} title={`${y}`} className="flex-1"><VerdictGlyph v={verdicts[i]} /></span>)}
      </div>
      <figcaption className="mt-1 flex justify-between text-xs text-text-3"><span>{ends[0]}</span><span className="px-2 text-center">{label}</span><span>{ends.at(-1)}</span></figcaption>
    </figure>
  );
}
