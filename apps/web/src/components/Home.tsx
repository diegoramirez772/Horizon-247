"use client";

import { useState } from "react";
import type { HomeDoc } from "@/contract/types";
import { loadSeen, markSeen, saveSeen, unseen } from "@/core/home/cursor";
import { monitorName, presentMonitor, sourcesFor } from "@/core/home/present";
import type { Lang, Register } from "@/core/i18n/texts";
import { DeckCard, Spark, VerdictGlyph } from "./ui";

const T = {
  es: {
    title: "Mis monitores", tag: "Tu monitor", sub: "Lo que sigues, qué cambió y qué pide atención. Sin abrir el globo.",
    changed: "Qué cambió desde tu última visita", attention: "Qué atender", quality: "Calidad de los datos", unknown: "Lo que aún no se sabe",
    nothingNew: "Nada nuevo desde tu última visita.", nothingAttention: "Nada pide atención.", qualityOk: "Las fuentes están al día.",
    seen: "Lo vi", seenAll: "Marcar todo como visto", sure: "¿Qué tan seguro es?", hideSure: "Ocultar", ask: "Preguntar por esto",
    priority: "Prioridad", fresh: "Nuevo", note: "Promedios regionales de celdas de ~50 km. Una anomalía es una desviación estadística. Sin consejos.",
  },
  en: {
    title: "My monitors", tag: "Your monitor", sub: "What you follow, what changed and what needs attention. No globe needed.",
    changed: "What changed since your last visit", attention: "Needs attention", quality: "Data quality", unknown: "What is not known yet",
    nothingNew: "Nothing new since your last visit.", nothingAttention: "Nothing needs attention.", qualityOk: "Sources are up to date.",
    seen: "Seen", seenAll: "Mark all as seen", sure: "How sure is it?", hideSure: "Hide", ask: "Ask about this",
    priority: "Priority", fresh: "New", note: "Regional means of ~50 km cells. An anomaly is a statistical deviation. No advice.",
  },
};

/** Which home events were already seen (kept in this browser only). Rendered after home.json arrived, on the client. */
export function useSeen(): { seen: string[]; see: (ids: string[]) => void } {
  const [seen, setSeen] = useState<string[]>(loadSeen);
  const see = (ids: string[]) => setSeen((s) => { const n = markSeen(s, ids); saveSeen(n); return n; });
  return { seen, see };
}

/**
 * «Mis monitores» (doc «Modos de profundidad… v2» §5) as the first cards of the start deck: one card per monitor,
 * marked «Nuevo» when it changed since the last visit. Returns <li> items for the deck's list.
 */
export function monitorCards({ doc, lang, register, onAsk, seen, see }: {
  doc: HomeDoc; lang: Lang; register: Register; onAsk: (text: string) => void; seen: string[]; see: (ids: string[]) => void;
}): React.ReactNode[] {
  const t = T[lang];
  const changes = unseen(doc.events, seen).filter((e) => e.tray === "evidencia");
  const freshBy = new Set(changes.map((e) => e.monitor));
  return doc.entities.flatMap((ent) => ent.monitors.map((mon) => {
        const v = presentMonitor(mon, register, lang, sourcesFor(mon));
        const name = monitorName(ent, mon, lang);
        const values = mon.series.values.map((x) => (x === null ? NaN : x));
        return (
          <li key={mon.id} className="snap-start">
            <DeckCard tag={t.tag} tagTone="accent" title={name} label={`${name}. ${v.phrase}. ${t.ask}`}
              badge={<>
                {freshBy.has(mon.id) ? <span className="rounded-full bg-text px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.08em] text-bg">{t.fresh}</span> : null}
                {!mon.data.data_real ? <span className="rounded-full bg-sim/70 px-1.5 py-px text-[9.5px] font-semibold uppercase text-on-sim">{lang === "es" ? "Simulado" : "Simulated"}</span> : null}
              </>}
              art={<span className="mt-4 flex w-full justify-center [&>svg]:mx-auto [&>svg]:h-[36px] [&>svg]:w-[176px]"><Spark values={values} highlight={v.verdict === 1} /></span>}
              onClick={() => { see(changes.filter((e) => e.monitor === mon.id).map((e) => e.id)); onAsk(lang === "es" ? `¿Cómo cambia ${name.toLocaleLowerCase("es")}?` : `How is ${name} changing?`); }}>
              <span className="flex items-center gap-1.5"><VerdictGlyph v={v.verdict} /><span className="truncate">{v.figure ?? v.phrase}</span></span>
            </DeckCard>
          </li>
        );
      }));
}
