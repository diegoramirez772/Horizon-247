"use client";

import { useEffect, useRef, useState } from "react";
import { compose, readSelection, type Ctx } from "@/core/assistant/compose";
import { entryWindow, type IndexEntry } from "@/core/contract/extra";
import { cellLatLon } from "@/core/contract/loader";
import { digitsFor, num } from "@/core/format/format";
import { UI, verdictName, type Lang } from "@/core/i18n/texts";
import type { BBox, MapData } from "@/core/map/MapView";
import type { MapTheme } from "@/core/map/palette";
import type { Metric, TimeMode } from "@/core/state/store";
import { EvidenceDetails } from "./Evidence";
import { LegendBar } from "./Legend";
import { MapCanvas, type HoverInfo, type MapFocus, type Projection } from "./MapCanvas";
import { SeriesChart } from "./SeriesChart";
import { Segmented } from "./ui";

export type PanelTab = "map" | "evidence";

const C = {
  es: {
    map: "Mapa", evidence: "Evidencia", close: "Cerrar panel", expand: "Ampliar panel", shrink: "Reducir panel",
    full: "Pantalla completa", exitFull: "Salir de pantalla completa (Esc)", view: "Vista", globe: "Globo 3D", flat: "Plano",
    years: "Datos", mode: { completa: "Tendencia", anual: "Año a año", acumulada: "Cómo crece la evidencia" },
    hint: "Pasa el cursor o toca una zona", simulated: "Simulado",
    noSel: "Toca una zona del mapa o pregunta por una región para ver su evidencia.",
    play: "Reproducir los años", pause: "Pausar",
    metric: "Métrica", metrics: { verdict: "Veredicto", effect: "Efecto", mde: "MDE", years: "Años que faltan" },
    readout: "Mueve el cursor sobre el mapa para leer los valores",
    plainTime: { completa: "Tendencia", anual: "Año por año", acumulada: "Cómo crece" },
    howMuch: "¿Cuánto cambia?", howSure: "¿Qué tan seguro es?", withWhat: "¿Con qué datos?",
    sure: { 1: "Seguro: es un cambio real, no una casualidad", 2: "Todavía no: hay indicios pero no se confirma", 3: "Todavía no se puede saber con estos años", 4: "No hubo un cambio grande", 0: "No hay datos suficientes" } as Record<number, string>,
    seriesHelp: "Cada punto es un año. La línea punteada muestra hacia dónde va.",
    technical: "Ver detalles técnicos",
    notYet: "Aún no se sabe",
  },
  en: {
    map: "Map", evidence: "Evidence", close: "Close panel", expand: "Widen panel", shrink: "Narrow panel",
    full: "Full screen", exitFull: "Exit full screen (Esc)", view: "View", globe: "3D globe", flat: "Flat",
    years: "Data", mode: { completa: "Trend", anual: "Year by year", acumulada: "How evidence grows" },
    hint: "Hover or tap an area", simulated: "Simulated",
    noSel: "Tap an area on the map or ask about a region to see its evidence.",
    play: "Play the years", pause: "Pause",
    metric: "Metric", metrics: { verdict: "Verdict", effect: "Effect", mde: "MDE", years: "Years needed" },
    readout: "Move the pointer over the map to read the values",
    plainTime: { completa: "Trend", anual: "Year by year", acumulada: "How it grows" },
    howMuch: "How much does it change?", howSure: "How sure is it?", withWhat: "With what data?",
    sure: { 1: "Sure: it is a real change, not chance", 2: "Not yet: there are hints but it is not confirmed", 3: "It cannot be known yet with these years", 4: "There was no large change", 0: "Not enough data" } as Record<number, string>,
    seriesHelp: "Each dot is a year. The dashed line shows where it is heading.",
    technical: "See technical details",
    notYet: "Not known yet",
  },
};

export interface PanelControls {
  metric: (m: Metric) => void;
  expert: () => void;
  window: (id: string) => void;
  time: (m: TimeMode) => void;
  year: (y: number) => void;
  windowEnd: (y: number) => void;
}

/**
 * The side panel (Diego's brief §3): it splits the screen, never covers the conversation, and can widen.
 * It holds the map (with the time controls and the key) and the evidence of the selected area.
 */
export function MapPanel({ ctx, tab, setTab, expanded, setExpanded, onClose, data, theme, focus, region, describe, onPick,
  blueIsMore, seriesReady, controls, siblings, entry, onFilter, loading, error, onRetry, full, setFull, projection, setProjection }: {
  ctx: Ctx; tab: PanelTab; setTab: (t: PanelTab) => void; expanded: boolean; setExpanded: (e: boolean) => void; onClose: () => void;
  data: MapData | null; theme: MapTheme; focus: MapFocus | null; region: BBox | null; describe: (i: number) => HoverInfo | null;
  onPick: (i: number) => void; blueIsMore: boolean; seriesReady: boolean; controls: PanelControls;
  siblings: IndexEntry[]; entry: IndexEntry | null; onFilter: (f: number[] | null) => void;
  loading: boolean; error: string | null; onRetry: () => void;
  full: boolean; setFull: (f: boolean) => void; projection: Projection; setProjection: (p: Projection) => void;
}) {
  const s = ctx.state;
  const c = C[s.lang];
  const T = UI[s.lang];
  const m = ctx.layer?.manifest;
  const sel = s.selection;
  const reading = sel ? readSelection(ctx) : null;
  const expert = s.register === "tecnico";
  const [hover, setHover] = useState(-1);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div role="tablist" aria-label={c.map} className="flex gap-1 rounded-full bg-surface-2 p-1">
          {(["map", "evidence"] as PanelTab[]).map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} type="button" onClick={() => setTab(x)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === x ? "bg-surface text-text shadow-sm" : "text-text-2 hover:text-text"}`}>
              {c[x]}
            </button>
          ))}
        </div>
        {m ? (
          <p className="ml-1 hidden min-w-0 truncate text-sm text-text-2 md:block">
            {m.title[s.lang]} · <span className="tabular">{m.window.start}–{m.window.end}</span>
            {m.honesty.simulated ? <span className="ml-2 rounded-full bg-sim/70 px-2 py-0.5 text-xs font-medium text-on-sim">{c.simulated}</span> : null}
          </p>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {!full ? (
            <IconButton label={expanded ? c.shrink : c.expand} onClick={() => setExpanded(!expanded)}>
              {expanded
                ? <path d="M10 3v3h3M6 13v-3H3M10 6l4-4M6 10l-4 4" />
                : <path d="M10 2h4v4M6 14H2v-4M14 2l-5 5M2 14l5-5" />}
            </IconButton>
          ) : null}
          <IconButton label={full ? c.exitFull : c.full} onClick={() => setFull(!full)} pressed={full}>
            {full
              ? <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
              : <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />}
          </IconButton>
          <IconButton label={c.close} onClick={onClose}><path d="M4 4l8 8M12 4l-8 8" /></IconButton>
        </div>
      </div>

      {tab === "map" ? (
        <>
          {m ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
              {expert ? (
                <Segmented<Projection> label={c.view} value={projection} onChange={setProjection} compact
                  options={[{ value: "globe", label: c.globe }, { value: "flat", label: c.flat }]} />
              ) : null}
              {siblings.length > 1 ? (
                <Segmented label={c.years} value={entry?.id ?? ""} onChange={controls.window} compact
                  options={siblings.map((e) => ({ value: e.id, label: T.years(entryWindow(e)!.n), title: `${entryWindow(e)!.start}–${entryWindow(e)!.end}` }))} />
              ) : null}
              <Segmented<TimeMode> label={T.time} value={s.timeMode} onChange={controls.time} compact
                options={(["completa", "anual", "acumulada"] as TimeMode[])
                  // Sencillo keeps two easy choices; "how evidence grows" is an Experto tool.
                  .filter((x) => x === "completa" || (x === "anual" && m.series) || (x === "acumulada" && m.windows && (expert || s.timeMode === "acumulada")))
                  .map((x) => ({ value: x, label: expert ? c.mode[x] : c.plainTime[x] }))} />
              {expert && s.timeMode === "completa" ? (
                <Segmented<Metric> label={c.metric} value={s.metric} onChange={controls.metric} compact
                  options={(["verdict", "effect", "mde", "years"] as Metric[]).map((x) => ({ value: x, label: c.metrics[x] }))} />
              ) : null}
            </div>
          ) : null}
          <div className="relative min-h-[300px] flex-1 bg-surface-2">
            {error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center" role="alert">
                <p className="font-semibold">{T.errorTitle}</p>
                <p className="break-all text-sm text-text-2">{error}</p>
                <button type="button" onClick={onRetry} className="mt-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-on-accent">{T.retry}</button>
              </div>
            ) : (
              <MapCanvas data={data} theme={theme} selected={sel?.kind === "cell" ? sel.index : -1}
                filter={s.timeMode === "anual" ? null : s.filter} region={region} focus={focus} lang={s.lang}
                label={T.mapLabel(m ? m.title[s.lang] : "")} onPick={onPick} describe={describe} onHoverCell={expert ? setHover : undefined} projection={expert ? projection : "globe"} />
            )}
            {loading && !error ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span role="status" className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-text-2 shadow-md">{T.loading}</span>
              </div>
            ) : null}
            {data && s.timeMode === "completa" ? (
              <p className="pointer-events-none absolute left-3 top-3 rounded-full border border-border bg-surface/90 px-3 py-1 text-xs text-text-2 shadow-sm">{c.hint}</p>
            ) : null}
          </div>
          {expert ? <Readout ctx={ctx} index={hover} hint={c.readout} /> : null}
          <LegendBar ctx={ctx} theme={theme} blueIsMore={blueIsMore} data={data} onFilter={onFilter} />
          {m && s.timeMode === "anual" && m.series ? (
            <Timeline years={m.series.years} value={s.year ?? m.series.years.at(-1)!} note={T.descriptiveNote} lang={s.lang} onChange={controls.year} />
          ) : null}
          {m && s.timeMode === "acumulada" && m.windows ? (
            <Timeline years={m.windows.ends} value={s.windowEnd ?? m.windows.ends.at(-1)!} prefix={`${m.windows.start}–`} note={T.accumulatedNote} lang={s.lang} onChange={controls.windowEnd} />
          ) : null}
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {sel && reading && ctx.layer ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3">{c.evidence}</p>
              <h2 className="mt-1 text-xl font-semibold leading-tight">{reading.name[s.lang].replace(/^(la zona|the area) /, "")}</h2>
              <p className="text-sm text-text-2">{verdictName(reading.finding.verdict, s.lang, s.register)} · {m?.window.start}–{m?.window.end}</p>
              {expert ? <EvidenceDetails ctx={ctx} selection={sel} seriesReady={seriesReady} />
                : <PlainEvidence ctx={ctx} onExpert={controls.expert} seriesReady={seriesReady} />}
            </>
          ) : (
            <p className="text-text-2">{c.noSel}</p>
          )}
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: React.ReactNode; pressed?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={pressed}
      className="flex h-9 w-9 items-center justify-center rounded-full text-text-2 hover:bg-surface-2 hover:text-text">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
    </button>
  );
}

/** Time bar under the map, with a play button that steps through the years once (it stops at the end). */
function Timeline({ years, value, note, prefix = "", lang, onChange }: {
  years: number[]; value: number; note: string; prefix?: string; lang: Lang; onChange: (y: number) => void;
}) {
  const c = C[lang];
  const [playing, setPlaying] = useState(false);
  const i = Math.max(0, years.indexOf(value));
  const latest = useRef({ i, years, onChange });
  useEffect(() => { latest.current = { i, years, onChange }; }, [i, years, onChange]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const { i: k, years: ys, onChange: go } = latest.current;
      if (k >= ys.length - 1) { setPlaying(false); return; }
      go(ys[k + 1]);
    }, 450);
    return () => window.clearInterval(id);
  }, [playing]);
  const toggle = () => {
    if (!playing && i >= years.length - 1) onChange(years[0]);
    setPlaying(!playing);
  };
  return (
    <div className="flex items-center gap-3 border-t border-border bg-surface px-3 py-2.5">
      <button type="button" onClick={toggle} aria-label={playing ? c.pause : c.play} title={playing ? c.pause : c.play} aria-pressed={playing}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
        {playing
          ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2.5" y="2" width="3" height="10" rx="1" fill="currentColor" /><rect x="8.5" y="2" width="3" height="10" rx="1" fill="currentColor" /></svg>
          : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 2l8 5-8 5z" fill="currentColor" /></svg>}
      </button>
      <strong className="tabular shrink-0 text-xl font-semibold">{prefix ? <span className="text-sm font-normal text-text-3">{prefix}</span> : null}{value}</strong>
      <div className="flex min-w-0 flex-1 flex-col">
        <input type="range" min={0} max={years.length - 1} step={1} value={i} aria-valuetext={`${prefix}${value}`} aria-label={note}
          onChange={(e) => { setPlaying(false); onChange(years[Number(e.target.value)]); }} className="h-6 w-full" />
        <div className="flex justify-between text-xs text-text-3">
          <span className="tabular">{years[0]}</span><span className="truncate px-2">{note}</span><span className="tabular">{years.at(-1)}</span>
        </div>
      </div>
    </div>
  );
}

/** Expert readout: everything about the cell under the pointer, in one monospace line. */
function Readout({ ctx, index, hint }: { ctx: Ctx; index: number; hint: string }) {
  const s = ctx.state;
  const m = ctx.layer?.manifest;
  const r = index >= 0 && m ? readSelection(ctx, { kind: "cell", index }) : null;
  const CODE = ["INSUFICIENTE", "PROBADO", "CANDIDATA", "NO_CONCLUYENTE", "SIN_CAMBIO"];
  let text = hint;
  if (r && m) {
    const f = r.finding;
    const { lat, lon } = cellLatLon(m, index);
    const n = (x: number, d = 2) => (Number.isFinite(x) ? num(x, s.lang, d) : "—");
    text = [
      `${n(lat, 2)}°, ${n(lon, 2)}°`, `#${index}`, CODE[f.verdict],
      `β ${n(f.effect)} [${n(f.ci[0])}, ${n(f.ci[1])}] ${m.variable.unit_per_decade}`,
      `p ${n(f.p, 3)}`, `q ${n(f.q, 3)}`, `MDE ${n(f.mde)}`, `σ ${n(f.sigma)}`, `r̂₁ ${n(f.r1)}`,
      `${f.nSig}/3`, f.yearsMore === null ? "" : f.yearsMore === 255 ? "+60 a" : `+${Math.round(f.yearsMore)} a`,
    ].filter(Boolean).join("  ·  ");
  }
  return (
    <div className="tabular truncate border-t border-border bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-text-2" aria-live="off">{text}</div>
  );
}

/** Plain evidence: what it means, the series, and three facts in everyday words. No tables, no jargon. */
function PlainEvidence({ ctx, onExpert, seriesReady }: { ctx: Ctx; onExpert: () => void; seriesReady: boolean }) {
  const s = ctx.state;
  const c = C[s.lang];
  const m = ctx.layer!.manifest;
  const r = readSelection(ctx)!;
  const f = r.finding;
  const years = m.series?.years ?? [];
  const sentence = compose("area", ctx, "system").text[s.lang].sencillo;
  const amount = f.verdict === 1 && Number.isFinite(f.effect)
    ? (s.lang === "es" ? `${f.effect > 0 ? "Sube" : "Baja"} unos ${num(Math.abs(f.effect), s.lang, digitsFor("sencillo", f.effect))} ${m.variable.unit} cada 10 años`
      : `${f.effect > 0 ? "Rising" : "Falling"} about ${num(Math.abs(f.effect), s.lang, digitsFor("sencillo", f.effect))} ${m.variable.unit} every 10 years`)
    : c.notYet;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="rounded-2xl bg-surface-2 p-4 text-base leading-7">{sentence}</p>
      {f.series.length === years.length && years.length ? (
        <figure className="m-0">
          <SeriesChart values={f.series} years={years} effect={f.effect} unit={m.variable.unit} lang={s.lang} showTrend={f.verdict === 1} />
          <figcaption className="mt-1 text-sm text-text-3">{c.seriesHelp}</figcaption>
        </figure>
      ) : s.selection?.kind === "cell" && !seriesReady ? <p className="text-sm text-text-3">{UI[s.lang].loading}</p> : null}
      <dl className="grid gap-2">
        {[[c.howMuch, amount], [c.howSure, c.sure[f.verdict]], [c.withWhat, `${m.dataset.name} · ${m.window.start}–${m.window.end}`]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-text-3">{k}</dt>
            <dd className="mt-0.5 text-[15px] font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onExpert} className="self-start text-sm font-semibold underline underline-offset-4">{c.technical} →</button>
    </div>
  );
}
