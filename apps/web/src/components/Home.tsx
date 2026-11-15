"use client";

import { useMemo, useState } from "react";
import type { HomeDoc, HomeEntity, HomeMonitor } from "@/contract/types";
import { certaintyText } from "@/core/honesty/calibration";
import { loadSeen, markSeen, saveSeen, unseen } from "@/core/home/cursor";
import {
  attentionText, eventText, monitorName, presentMonitor, sourcesFor, staleSources, unknowns,
} from "@/core/home/present";
import type { Lang, Register } from "@/core/i18n/texts";
import { Spark, VerdictGlyph } from "./ui";

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

  const monitors = doc.entities.flatMap((ent) => ent.monitors.map((mon) => ({ ent, mon })));
  const freshBy = new Set(changes.map((e) => e.monitor));
  const [tray, setTray] = useState<null | "changed" | "attention" | "quality" | "unknown">(null);
  const chips = [
    { key: "changed" as const, label: t.changed, n: changes.length, empty: t.nothingNew, hot: changes.length > 0 },
    { key: "attention" as const, label: t.attention, n: attention.length, empty: t.nothingAttention, hot: attention.length > 0 },
    { key: "quality" as const, label: t.quality, n: quality.length, empty: t.qualityOk, hot: false },
    { key: "unknown" as const, label: t.unknown, n: notYet.length, empty: "", hot: false },
  ];
  const open = chips.find((c) => c.key === tray) ?? null;
  const list = tray === "changed" ? changes.map((e) => ({ id: e.id, text: eventText(e, doc, lang), seen: true }))
    : tray === "attention" ? attention.map((a) => ({ ...a, seen: false }))
    : tray === "quality" ? quality.map((q) => ({ ...q, seen: false }))
    : tray === "unknown" ? notYet.map((x) => ({ id: x, text: x, seen: false })) : [];

  return (
    <section aria-labelledby="home-title" className="relative mx-auto w-full max-w-[1120px] px-4 pb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 id="home-title" className="text-sm font-semibold">{t.title}</h2>
        <button type="button" onClick={() => setSure((x) => !x)} aria-expanded={sure}
          className="text-sm font-medium text-text-2 underline-offset-4 hover:text-text hover:underline">
          {sure ? t.hideSure : t.sure}
        </button>
      </div>
      {sure ? <p role="note" className="mb-3 rounded-2xl bg-surface-2 p-3 text-sm leading-6">{certaintyText(register, lang, doc.calibration)}</p> : null}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {monitors.map(({ ent, mon }) => (
          <li key={mon.id}>
            <MonitorTile ent={ent} mon={mon} lang={lang} register={register} fresh={freshBy.has(mon.id)}
              onOpen={(name) => { see(changes.filter((e) => e.monitor === mon.id).map((e) => e.id)); onAsk(lang === "es" ? `¿Cómo cambia ${name.toLocaleLowerCase("es")}?` : `How is ${name} changing?`); }} />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2 px-1" role="group" aria-label={t.sub}>
        {chips.filter((c) => c.key !== "unknown" || c.n > 0).map((c) => (
          <button key={c.key} type="button" onClick={() => setTray(tray === c.key ? null : c.key)} aria-expanded={tray === c.key}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${tray === c.key ? "border-accent bg-accent text-on-accent" : "border-border bg-surface/90 text-text-2 hover:border-text-3 hover:text-text"}`}>
            {c.hot && tray !== c.key ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
            {c.label}<span className="tabular text-xs opacity-70">{c.n}</span>
          </button>
        ))}
      </div>
      {open ? (
        <div className="widget-in mt-2 rounded-2xl border border-border bg-surface p-3">
          {list.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {list.map((x) => (
                <li key={x.id} className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">{x.text}</span>
                  {x.seen ? <button type="button" onClick={() => see([x.id])} className="shrink-0 text-xs font-medium text-text-2 underline underline-offset-2 hover:text-text">{t.seen}</button> : null}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-text-3">{open.empty}</p>}
          {tray === "changed" && changes.length > 1 ? (
            <button type="button" onClick={() => see(changes.map((e) => e.id))} className="mt-2 text-xs font-medium text-text-2 underline underline-offset-2 hover:text-text">{t.seenAll}</button>
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 px-1 text-xs text-text-3">{t.note}</p>
    </section>
  );
}

/** One monitor as a card (same family as «Descubre»): the series on top, the verdict and the number below. */
function MonitorTile({ ent, mon, lang, register, fresh, onOpen }: {
  ent: HomeEntity; mon: HomeMonitor; lang: Lang; register: Register; fresh: boolean; onOpen: (name: string) => void;
}) {
  const v = presentMonitor(mon, register, lang, sourcesFor(mon));
  const t = T[lang];
  const values = mon.series.values.map((x) => (x === null ? NaN : x));
  const name = monitorName(ent, mon, lang);
  return (
    <button type="button" onClick={() => onOpen(name)} aria-label={`${name}. ${v.phrase}`}
      className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface/90 text-left backdrop-blur transition-all hover:-translate-y-0.5 hover:border-text-3 hover:shadow-[0_12px_30px_rgba(0,0,0,0.08)]">
      <span className="relative flex h-[84px] items-center border-b border-border bg-surface-2/70 px-4">
        <Spark values={values} highlight={v.verdict === 1} />
        <span className="absolute left-3 top-2.5 flex gap-1.5">
          {fresh ? <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold uppercase leading-4 text-on-accent">{t.fresh}</span> : null}
          {!mon.data.data_real ? <span className="rounded-full bg-sim/70 px-1.5 text-[10px] font-semibold uppercase leading-4 text-on-sim">{lang === "es" ? "Simulado" : "Simulated"}</span> : null}
        </span>
      </span>
      <span className="flex flex-1 flex-col p-4">
        <span className="text-[15px] font-semibold">{name}</span>
        <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-text-2"><VerdictGlyph v={v.verdict} />{v.phrase}</span>
        {v.figure ? <span className="tabular mt-1 text-lg font-semibold leading-tight">{v.figure}</span> : null}
        <span className="mt-1 line-clamp-3 flex-1 text-sm leading-snug text-text-2">{v.since ?? v.sentence}</span>
        <span className="mt-3 text-sm font-semibold text-text group-hover:underline group-hover:underline-offset-4">{t.ask} →</span>
      </span>
    </button>
  );
}
