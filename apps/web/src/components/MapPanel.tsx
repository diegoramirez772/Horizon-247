"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { compose, readingLimits, readSelection, type Ctx } from "@/core/assistant/compose";
import { entryWindow, type IndexEntry } from "@/core/contract/extra";
import { cellLatLon } from "@/core/contract/loader";
import { digitsFor, num } from "@/core/format/format";
import { UI, verdictName, type Lang } from "@/core/i18n/texts";
import type { BBox, MapData } from "@/core/map/MapView";
import type { MapTheme } from "@/core/map/palette";
import { shownLimits } from "@/core/honesty/limits";
import { allowedMetrics, type Metric, type SceneTarget, type TimeMode, type ZoneTarget } from "@/core/state/store";
import { EvidenceDetails } from "./Evidence";
import { LivePanel } from "./LivePanel";
import { ZoneView } from "./ZoneView";
import { LAYERS } from "@/core/map/imagery";
import { LegendBar } from "./Legend";
import { MapCanvas, type HoverInfo, type MapFocus, type Projection } from "./MapCanvas";
import { SeriesChart } from "./SeriesChart";
import { Segmented } from "./ui";
import { FocusTour, type TourState } from "./FocusTour";
import { FaunaPanel, type FaunaPlace } from "./FaunaPanel";
import { PersonPanel } from "./PersonPanel";
import { type Focus, type FocusSet, findFoci, focusSeries } from "@/core/detect/focos";
import { buildPrisms } from "@/core/detect/prisms";
import { buildDrape } from "@/core/detect/drape";
import { focusWords, sceneCaption } from "@/core/detect/words";
import { detectTier } from "@/core/map/tier";
import { loadSeries, type Layer } from "@/core/contract/loader";

export type PanelTab = "map" | "live" | "evidence" | "scene" | "zone" | "fauna" | "person";

const C = {
  es: {
    map: "Monitoreo", live: "En vivo", evidence: "Evidencia", scene: "Escena 3D", zone: "Zona en 3D real", fauna: "Señales de fauna", person: "Persona", see3d: "Ver esta zona en 3D real", genScene: "Escena generada", close: "Cerrar panel", expand: "Ampliar panel", shrink: "Reducir panel",
    full: "Pantalla completa", exitFull: "Salir de pantalla completa (Esc)", view: "Vista", globe: "Globo 3D", flat: "Plano",
    years: "Datos", mode: { completa: "Tendencia", anual: "Año a año", acumulada: "Cómo crece la evidencia" },
    hint: "Pasa el cursor o toca una zona", simulated: "Simulado", viewMenu: "Vista del mapa",
    picture: "Imagen de la NASA bajo los datos", base: "Tierra realista · sol, nubes y lluvia en vivo", liveGroup: "En vivo · cada 10 min", dayGroup: "Del día", scene3d: "Abrir una escena 3D (toca una zona para la suya)",
    noSel: "Toca una zona del mapa o pregunta por una región para ver su evidencia.",
    play: "Reproducir los años", pause: "Pausar",
    metric: "Métrica", metrics: { verdict: "Veredicto", effect: "Efecto", mde: "MDE", years: "Años que faltan" },
    readout: "Mueve el cursor sobre el mapa para leer los valores",
    plainTime: { completa: "Tendencia", anual: "Año por año", acumulada: "Cómo crece" },
    howMuch: "¿Cuánto cambia?", howSure: "¿Qué tan seguro es?", withWhat: "¿Con qué datos?",
    sure: { 1: "Seguro: es un cambio real, no una casualidad", 2: "Todavía no: hay indicios pero no se confirma", 3: "Todavía no se puede saber con estos años", 4: "No hubo un cambio grande", 0: "No hay datos suficientes" } as Record<number, string>,
    seriesHelp: "Cada punto es un año. La línea punteada muestra hacia dónde va.",
    technical: "Ver más detalle",
    notYet: "Aún no se sabe",
  },
  en: {
    map: "Monitoring", live: "Live", evidence: "Evidence", scene: "3D scene", zone: "Real 3D zone", fauna: "Animal signals", person: "Person", see3d: "See this area in real 3D", genScene: "Generated scene", close: "Close panel", expand: "Widen panel", shrink: "Narrow panel",
    full: "Full screen", exitFull: "Exit full screen (Esc)", view: "View", globe: "3D globe", flat: "Flat",
    years: "Data", mode: { completa: "Trend", anual: "Year by year", acumulada: "How evidence grows" },
    hint: "Hover or tap an area", simulated: "Simulated", viewMenu: "Map view",
    picture: "NASA picture under the data", base: "Realistic Earth · live sun, clouds and rain", liveGroup: "Live · every 10 min", dayGroup: "Of the day", scene3d: "Open a 3D scene (tap an area for its own)",
    noSel: "Tap an area on the map or ask about a region to see its evidence.",
    play: "Play the years", pause: "Pause",
    metric: "Metric", metrics: { verdict: "Verdict", effect: "Effect", mde: "MDE", years: "Years needed" },
    readout: "Move the pointer over the map to read the values",
    plainTime: { completa: "Trend", anual: "Year by year", acumulada: "How it grows" },
    howMuch: "How much does it change?", howSure: "How sure is it?", withWhat: "With what data?",
    sure: { 1: "Sure: it is a real change, not chance", 2: "Not yet: there are hints but it is not confirmed", 3: "It cannot be known yet with these years", 4: "There was no large change", 0: "Not enough data" } as Record<number, string>,
    seriesHelp: "Each dot is a year. The dashed line shows where it is heading.",
    technical: "See more detail",
    notYet: "Not known yet",
  },
};

export interface PanelControls {
  metric: (m: Metric) => void;
  /** One level deeper (Simple → Normal → Experto). */
  deeper: () => void;
  window: (id: string) => void;
  time: (m: TimeMode) => void;
  year: (y: number) => void;
  windowEnd: (y: number) => void;
  /** NASA imagery under the data (null = Blue Marble). */
  imagery: (id: string | null) => void;
  /** Timeline speed (×0.5, ×1, ×2). */
  speed: (v: number) => void;
  /** The «evolución» playback reached the last year. */
  evolutionDone: () => void;
  /** Fly the globe to a point (from «En vivo»). */
  look: (lat: number, lon: number) => void;
  /** Open the generated 3D scene of a place (from a zone on the map or the assistant). */
  scene: (t: SceneTarget) => void;
  /** Open the real place in 3D (relief + satellite); `box` = a focus's extent, shown with HORI's verdict draped on it. */
  zone: (z: ZoneTarget) => void;
}

/**
 * The side panel (Diego's brief §3): it splits the screen, never covers the conversation, and can widen.
 * It holds the map (with the time controls and the key) and the evidence of the selected area.
 */
export function MapPanel({ ctx, tab, setTab, expanded, setExpanded, onClose, data, theme, focus, region, describe, onPick,
  blueIsMore, seriesReady, controls, siblings, entry, onFilter, loading, error, onRetry, full, setFull, projection, setProjection }: {
  ctx: Ctx; tab: PanelTab; setTab: (t: PanelTab) => void; expanded: boolean; setExpanded: (e: boolean) => void; onClose: () => void;
  data: MapData | null; theme: MapTheme; focus: MapFocus | null; region: BBox | null; describe: (i: number) => HoverInfo | null;
  onPick: (i: number, at?: { lat: number; lon: number }) => void; blueIsMore: boolean; seriesReady: boolean; controls: PanelControls;
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
  const plain = s.register === "sencillo";
  const [hover, setHover] = useState(-1);
  // «Lo significativo» (traspaso 3D): foci read from HORI's verdict, only for the full window (the verdict on screen).
  const foci = useFoci(ctx.layer);
  const [tour, setTour] = useState<TourState | null>(null);
  const showFoci = tab === "map" && s.timeMode === "completa" && !!foci && !!m;
  // The camera goes to the focus with the most evidence once per layer, unless the person already picked a place.
  // The assistant asked for the tour («recorre lo significativo»): adjust during render, once per request.
  const [tourSeen, setTourSeen] = useState(0);
  if (s.tourReq && s.tourReq.n !== tourSeen) { setTourSeen(s.tourReq.n); setTour({ mode: s.tourReq.mode, rank: 1 }); }
  const [autoFor, setAutoFor] = useState<string | null>(null);
  if (foci && m && autoFor !== m.id) {
    setAutoFor(m.id);
    if (!ctx.state.selection && foci.supported.length) setTour({ mode: "apoyado", rank: 1 });
  }
  const list = tour && foci ? (tour.mode === "apoyado" ? foci.supported : foci.unknown) : [];
  const current = tour ? list.find((f) => f.rank === tour.rank) ?? list[0] ?? null : null;
  const prisms = useMemo(() => {
    if (!showFoci || !tour || !foci || !ctx.layer || !data) return null;
    return buildPrisms({
      layer: ctx.layer, foci, mode: tour.mode, active: current?.rank ?? 1, theme, blueIsMore, scale: data.scale,
      budget: detectTier().tier >= 2 ? 1800 : 800, tags: (f) => focusWords(f, ctx.layer!.manifest, s.lang).tag,
    });
  }, [showFoci, tour, foci, ctx.layer, data, current, theme, blueIsMore, s.lang]);
  const tourFocus: MapFocus | null = showFoci && current && m
    ? { key: `foco|${m.id}|${tour!.mode}|${current.rank}`, kind: "focus", lat: current.lat, lon: current.lon, span: Math.max(current.bbox[2] - current.bbox[0], (current.bbox[3] - current.bbox[1]) * 1.5) }
    : null;
  const focusName = (f: Focus) => focusWords(f, m!, s.lang).title;
  const mapFocus = useLatestFocus(focus, tourFocus);
  // Animal signals of the zone open in 3D (a focus keeps its box), else of the selected place, else Durango.
  const faunaZone = s.zone ?? zoneOf(ctx);
  const faunaPlace: FaunaPlace = useMemo(() => ({ name: faunaZone.name, lat: faunaZone.lat, lon: faunaZone.lon, box: faunaZone.box }),
    [faunaZone.name, faunaZone.lat, faunaZone.lon, faunaZone.box]);
  const findFocus = (id: string | undefined) => (id && foci ? [...foci.supported, ...foci.unknown].find((f) => f.id === id) ?? null : null);
  const zf = findFocus(s.zone?.focus);
  const zoneFocus = zf && m ? focusWords(zf, m, s.lang) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {/* The sections (Monitoreo / En vivo / Evidencia) live in the sidebar: here only what is on screen. */}
        <p className="min-w-0 truncate pl-1 text-sm font-semibold">
          {tab === "map" && m ? <>{m.title[s.lang]} <span className="tabular font-normal text-text-2">· {m.window.start}–{m.window.end}</span></> : c[tab]}
          {tab === "map" && m?.honesty.simulated ? <span className="ml-2 rounded-full bg-sim/70 px-2 py-0.5 text-xs font-medium text-on-sim">{c.simulated}</span> : null}
        </p>
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
          <div className="relative min-h-[300px] flex-1 bg-surface-2">
            {error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center" role="alert">
                <p className="font-semibold">{T.errorTitle}</p>
                <p className="break-all text-sm text-text-2">{error}</p>
                <button type="button" onClick={onRetry} className="mt-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-on-accent">{T.retry}</button>
              </div>
            ) : (
              <MapCanvas data={data} theme={theme} selected={sel?.kind === "cell" ? sel.index : -1}
                filter={s.timeMode === "anual" ? null : s.filter} region={region} onZone={controls.zone} regionShape={s.selection?.kind === "cell" ? s.area?.shape ?? null : null} focus={mapFocus} lang={s.lang} prisms={prisms}
                label={T.mapLabel(m ? m.title[s.lang] : "")} onPick={onPick} describe={describe} onHoverCell={expert ? setHover : undefined} projection={projection}
                imageryId={s.imagery} onImagery={controls.imagery} />
            )}
            {loading && !error ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span role="status" className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-text-2 shadow-md">{T.loading}</span>
              </div>
            ) : null}
            {showFoci && foci && m ? (
              <FocusTour foci={foci} manifest={m} lang={s.lang} register={s.register} tour={tour} setTour={setTour}
                onZone={(f) => controls.zone({ name: focusName(f), lat: f.lat, lon: f.lon, box: f.bbox, focus: f.id })}
                onScene={(f) => controls.scene({ name: focusName(f), lat: f.lat, lon: f.lon, timeline: true, focus: f.id })} />
            ) : null}
            {sel && m && m.profile === "earth" ? (
              <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
                <button type="button" onClick={() => controls.zone(zoneOf(ctx))}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-on-accent shadow-[0_8px_24px_rgba(16,24,40,0.22)] transition-transform hover:scale-[1.03]">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 12.5l4-6 3 4 2-2.5 4 4.5z" /><circle cx="11.5" cy="4" r="1.5" /></svg>
                  {c.see3d}
                </button>
                <button type="button" onClick={() => controls.scene({ ...zoneOf(ctx), timeline: true })}
                  className="glass inline-flex h-9 items-center rounded-full px-3.5 text-xs font-semibold">
                  {c.genScene}
                </button>
              </div>
            ) : null}
            {m ? (
              <ViewMenu label={c.viewMenu} summary={[projection === "flat" ? c.flat : c.globe, s.imagery ? imageryShort(s.imagery) : null, c.mode[s.timeMode], siblings.length > 1 && entry ? T.years(entryWindow(entry)!.n) : null].filter(Boolean).join(" · ")}>
                  <Segmented<Projection> label={c.view} value={projection} onChange={setProjection} compact
                    options={[{ value: "globe", label: c.globe }, { value: "flat", label: c.flat }]} />
                  <label className="block w-full">
                    <span className="mb-1 block text-xs font-medium text-text-2">{c.picture}</span>
                    <select value={s.imagery ?? ""} onChange={(e) => controls.imagery(e.target.value || null)}
                      className="w-full rounded-xl border border-border bg-surface px-2.5 py-2 text-sm">
                      <option value="">{c.base}</option>
                      <optgroup label={c.liveGroup}>
                        {LAYERS.filter((l) => l.body === "earth" && l.live).map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                      </optgroup>
                      <optgroup label={c.dayGroup}>
                        {LAYERS.filter((l) => l.body === "earth" && !l.live && l.role !== "base" && l.role !== "night").map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                      </optgroup>
                    </select>
                  </label>
                  {sel && m.profile === "earth" ? null : (
                    <button type="button" onClick={() => controls.scene({ name: "Durango", lat: 24.02, lon: -104.67, timeline: true })}
                      className="text-sm font-medium underline underline-offset-4">{c.scene3d}</button>
                  )}
                  {siblings.length > 1 ? (
                    <Segmented label={c.years} value={entry?.id ?? ""} onChange={controls.window} compact
                      options={siblings.map((e) => ({ value: e.id, label: T.years(entryWindow(e)!.n), title: `${entryWindow(e)!.start}–${entryWindow(e)!.end}` }))} />
                  ) : null}
                  <Segmented<TimeMode> label={T.time} value={s.timeMode} onChange={controls.time} compact
                    options={(["completa", "anual", "acumulada"] as TimeMode[])
                      // Simple keeps two easy choices; "how evidence grows" appears from Normal up.
                      .filter((x) => x === "completa" || (x === "anual" && m.series) || (x === "acumulada" && m.windows && (!plain || s.timeMode === "acumulada")))
                      .map((x) => ({ value: x, label: plain ? c.plainTime[x] : c.mode[x] }))} />
                  {!plain && s.timeMode === "completa" ? (
                    <Segmented<Metric> label={c.metric} value={s.metric} onChange={controls.metric} compact
                      options={allowedMetrics(s.register).map((x) => ({ value: x, label: c.metrics[x] }))} />
                  ) : null}
              </ViewMenu>
            ) : null}
          </div>
          {expert ? <Readout ctx={ctx} index={hover} hint={c.readout} /> : null}
          <LegendBar ctx={ctx} theme={theme} blueIsMore={blueIsMore} data={data} onFilter={onFilter} />
          {m && s.timeMode === "anual" && m.series ? (
            <Timeline years={m.series.years} value={s.year ?? m.series.years.at(-1)!} note={T.descriptiveNote} lang={s.lang} onChange={controls.year} speed={s.speed} onSpeed={controls.speed}
              autoplay={s.evolution} onDone={controls.evolutionDone} />
          ) : null}
          {m && s.timeMode === "acumulada" && m.windows ? (
            <Timeline years={m.windows.ends} value={s.windowEnd ?? m.windows.ends.at(-1)!} prefix={`${m.windows.start}–`} note={T.accumulatedNote} lang={s.lang} onChange={controls.windowEnd} speed={s.speed} onSpeed={controls.speed} />
          ) : null}
        </>
      ) : tab === "scene" ? (
        <SceneFrame ctx={ctx} foci={foci} />
      ) : tab === "zone" ? (
        <ZoneView zone={s.zone ?? zoneOf(ctx)} lang={s.lang} reading={zoneFocus ? { title: `HORI · ${zoneFocus.title}`, line: zoneFocus.line } : zoneReading(ctx)}
          drapeFor={ctx.layer && data && m?.profile === "earth" ? (b) => buildDrape(ctx.layer!, b, theme, blueIsMore, data.scale) : undefined}
          layerName={m ? `${m.title[s.lang]} · ${m.window.start}–${m.window.end}` : undefined}
          onScene={() => { const z = s.zone ?? zoneOf(ctx); controls.scene({ name: z.name, lat: z.lat, lon: z.lon, timeline: true, focus: z.focus }); }} />
      ) : tab === "fauna" ? (
        <FaunaPanel lang={s.lang} place={faunaPlace} />
      ) : tab === "person" ? (
        <PersonPanel lang={s.lang} />
      ) : tab === "live" ? (
        <LivePanel onZone={controls.zone} lang={s.lang} imagery={s.imagery} onImagery={(id) => { controls.imagery(id); setTab("map"); }}
          onLook={(lat, lon) => { controls.look(lat, lon); setTab("map"); }} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {sel && reading && ctx.layer ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3">{c.evidence}</p>
              <h2 className="mt-1 text-xl font-semibold leading-tight">{reading.name[s.lang].replace(/^(la zona|the area) /, "")}</h2>
              <p className="text-sm text-text-2">{verdictName(reading.finding.verdict, s.lang, s.register)} · {m?.window.start}–{m?.window.end}</p>
              {plain ? <PlainEvidence ctx={ctx} onDeeper={controls.deeper} seriesReady={seriesReady} />
                : <EvidenceDetails ctx={ctx} selection={sel} seriesReady={seriesReady} />}
            </>
          ) : (
            <p className="text-text-2">{c.noSel}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Foci of the layer on screen, computed after the first paint (a 0.5° layer has 207 936 cells). */
function useFoci(layer: Layer | null): FocusSet | null {
  const [out, setOut] = useState<{ layer: Layer; foci: FocusSet } | null>(null);
  useEffect(() => {
    if (!layer || out?.layer === layer) return;
    const id = window.setTimeout(() => setOut({ layer, foci: findFoci(layer) }), 60);
    return () => window.clearTimeout(id);
  }, [layer, out]);
  return out && out.layer === layer ? out.foci : null;
}

/** The newest camera request wins: a command (focus key bumps) or a step of the tour. */
function useLatestFocus(cmd: MapFocus | null, tour: MapFocus | null): MapFocus | null {
  const [st, setSt] = useState<{ cmd?: string; tour?: string; pick: MapFocus | null }>({ pick: null });
  // Adjusting state while rendering (React docs, «storing information from previous renders»): no effect needed.
  if (cmd?.key !== st.cmd || tour?.key !== st.tour) {
    const pick = tour && tour.key !== st.tour ? tour : cmd && cmd.key !== st.cmd ? cmd : st.pick;
    setSt({ cmd: cmd?.key, tour: tour?.key, pick });
    return pick;
  }
  return st.pick;
}

/** All the map's view options behind one small button over the map (instead of rows of toggles above it). */
function imageryShort(id: string): string {
  const l = LAYERS.find((x) => x.id === id);
  return l ? l.title.replace(/^Infrarrojo en vivo · /, "IR · ") : id;
}

function ViewMenu({ label, summary, children }: { label: string; summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    addEventListener("pointerdown", off);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", off); removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={wrap} className="absolute left-3 top-3 z-10">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} aria-label={`${label}: ${summary}`}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface/95 px-3 text-sm font-medium shadow-sm backdrop-blur hover:border-text-3">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2 4h7M12 4h2M2 12h3M8 12h6" /><circle cx="10.5" cy="4" r="1.5" /><circle cx="6.5" cy="12" r="1.5" /></svg>
        <span className="max-w-[220px] truncate">{summary}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={open ? "rotate-180" : ""}><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      {open ? (
        <div className="widget-in mt-2 flex w-max max-w-[min(92vw,420px)] flex-col items-start gap-2.5 rounded-2xl border border-border bg-surface p-3 shadow-[0_14px_40px_rgba(16,24,40,0.16)]">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3">{label}</p>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The generated scene of a place, inside the panel. It is the /escena page in a frame (its own 3D view, readings and
 * timeline); the frame gets the place, and the yearly series of the zone when the layer on screen has one.
 */
function SceneFrame({ ctx, foci }: { ctx: Ctx; foci: FocusSet | null }) {
  const m = ctx.layer?.manifest;
  // Opened from a focus: its caption, and its mean yearly series once the layer's series is loaded.
  const focus = ctx.state.scene?.focus && foci ? [...foci.supported, ...foci.unknown].find((f) => f.id === ctx.state.scene!.focus) ?? null : null;
  const [, setSeriesFor] = useState<Layer | null>(null); // re-render once the series arrives
  useEffect(() => {
    const L = ctx.layer;
    if (!focus || !L || L.series || !L.manifest.series) return;
    let live = true;
    loadSeries(L).then(() => { if (live) setSeriesFor(L); }).catch(() => {});
    return () => { live = false; };
  }, [focus, ctx.layer]);
  // Opened from the sidebar: the zone selected on the map; otherwise Durango.
  const selPt = ctx.state.selection?.kind === "cell" && m && m.profile === "earth" ? cellLatLon(m, ctx.state.selection.index) : null;
  const sc = ctx.state.scene ?? (selPt ? { name: `${selPt.lat.toFixed(1)}°, ${selPt.lon.toFixed(1)}°`, lat: selPt.lat, lon: selPt.lon, timeline: true } : { name: "Durango", lat: 24.02, lon: -104.67, timeline: true });
  if (sc.preset) return <iframe key={sc.preset} title={sc.preset} src={`escena?embed=1&escena=${sc.preset}&lang=${ctx.state.lang}&vel=${ctx.state.speed}`} className="min-h-0 w-full flex-1 border-0 bg-bg" allow="camera; microphone" />;
  const q = new URLSearchParams({ embed: "1", lat: sc.lat.toFixed(3), lon: sc.lon.toFixed(3), name: sc.name, lang: ctx.state.lang });
  if (ctx.state.speed !== 1) q.set("vel", String(ctx.state.speed));
  if (sc.timeline) q.set("t", "anos");
  // The zone's yearly temperature from HORI (anomalies), when the layer on screen is temperature with a series.
  const sel = ctx.state.selection;
  if (focus && m) q.set("foco", sceneCaption(focus, m, ctx.state.lang));
  const fs = focus && ctx.layer && m?.series && m.variable.name === "T2M" ? focusSeries(ctx.layer, focus) : null;
  if (fs && m?.series && fs.some(Number.isFinite)) {
    q.set("serie", fs.map((v) => (Number.isFinite(v) ? v.toFixed(2) : "")).join(",")); q.set("y0", String(m.series.years[0]));
  } else if (m && ctx.layer?.series && m.series && m.variable.name === "T2M" && sel?.kind === "cell") {
    const n = m.window.n, i = sel.index;
    const vals = Array.from(ctx.layer.series.subarray(i * n, i * n + n));
    if (vals.some(Number.isFinite)) { q.set("serie", vals.map((v) => (Number.isFinite(v) ? v.toFixed(2) : "")).join(",")); q.set("y0", String(m.series.years[0])); }
  }
  return <iframe key={q.toString()} title={sc.name} src={`escena?${q}`} className="min-h-0 w-full flex-1 border-0 bg-bg" allow="camera; microphone" />;
}

/** The place to show in 3D: the zone selected on the map (cell centre or region centre), else the last one opened. */
function zoneOf(ctx: Ctx): ZoneTarget {
  const m = ctx.layer?.manifest, sel = ctx.state.selection;
  const area = ctx.state.area;
  if (m && sel?.kind === "cell" && area) return { name: area.name, lat: (area.box[1] + area.box[3]) / 2, lon: (area.box[0] + area.box[2]) / 2, box: area.box };
  if (m && sel?.kind === "cell") { const p = cellLatLon(m, sel.index); return { name: `${p.lat.toFixed(2)}°, ${p.lon.toFixed(2)}°`, ...p }; }
  if (sel?.kind === "region") {
    const r = ctx.regions.find((x) => x.id === sel.id) as (typeof ctx.regions[number] & { bbox?: BBox }) | undefined;
    if (r?.bbox) return { name: r.name[ctx.state.lang], lat: (r.bbox[1] + r.bbox[3]) / 2, lon: (r.bbox[0] + r.bbox[2]) / 2, box: r.bbox };
  }
  return ctx.state.zone ?? { name: "Durango", lat: 24.02, lon: -104.67 };
}

/** HORI's reading of the selected zone, one line, for the corner of the 3D view. */
function zoneReading(ctx: Ctx): { title: string; line: string } | null {
  const r = ctx.state.selection && ctx.layer ? readSelection(ctx) : null;
  const m = ctx.layer?.manifest;
  if (!r || !m) return null;
  const lang = ctx.state.lang, f = r.finding;
  const eff = Number.isFinite(f.effect) ? `${f.effect > 0 ? "+" : ""}${num(f.effect, lang, 2)} ${m.variable.unit_per_decade ?? ""}` : "";
  return { title: `HORI · ${m.title[lang]}`, line: `${verdictName(f.verdict, lang, ctx.state.register)}${eff ? ` · ${eff}` : ""}` };
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
function Timeline({ years, value, note, prefix = "", lang, onChange, autoplay = false, onDone, speed = 1, onSpeed }: {
  years: number[]; value: number; note: string; prefix?: string; lang: Lang; onChange: (y: number) => void;
  /** ×0.5 / ×1 / ×2: one year every 1.1 s at ×1 (it used to be 0.45 s: too fast to read). */
  speed?: number; onSpeed?: (v: number) => void;
  /** «Evolución de la Tierra»: start from the first year and play to the end by itself. */
  autoplay?: boolean; onDone?: () => void;
}) {
  const c = C[lang];
  const [playing, setPlaying] = useState(false);
  const i = Math.max(0, years.indexOf(value));
  const latest = useRef({ i, years, onChange });
  useEffect(() => { latest.current = { i, years, onChange }; }, [i, years, onChange]);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    if (!autoplay) return;
    latest.current.onChange(latest.current.years[0]);
    setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- starts once per «evolución» request
  }, [autoplay]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const { i: k, years: ys, onChange: go } = latest.current;
      if (k >= ys.length - 1) { setPlaying(false); done.current?.(); return; }
      go(ys[k + 1]);
    }, 1100 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed]);
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
      {onSpeed ? (
        <div role="group" aria-label={lang === "es" ? "Velocidad" : "Speed"} className="flex shrink-0 rounded-full bg-surface-2 p-0.5 text-xs">
          {[0.5, 1, 2].map((v) => (
            <button key={v} type="button" aria-pressed={speed === v} onClick={() => onSpeed(v)}
              aria-label={`${lang === "es" ? "Velocidad" : "Speed"} ×${v === 0.5 ? (lang === "es" ? "0,5" : "0.5") : v}`}
              className={`rounded-full px-2 py-1 font-medium ${speed === v ? "bg-surface shadow-sm" : "text-text-2"}`}>×{v === 0.5 ? (lang === "es" ? "0,5" : "0.5") : v}</button>
          ))}
        </div>
      ) : null}
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
function PlainEvidence({ ctx, onDeeper, seriesReady }: { ctx: Ctx; onDeeper: () => void; seriesReady: boolean }) {
  const s = ctx.state;
  const c = C[s.lang];
  const m = ctx.layer!.manifest;
  const r = readSelection(ctx)!;
  const f = r.finding;
  const years = m.series?.years ?? [];
  const sentence = compose("area", ctx, "system").text[s.lang].sencillo;
  const [limit] = shownLimits(readingLimits(ctx, r), "sencillo"); // Simple shows the main limit, never none (doc v2 rule 2)
  const amount = f.verdict === 1 && Number.isFinite(f.effect)
    ? (s.lang === "es" ? `${f.effect > 0 ? "Sube" : "Baja"} unos ${num(Math.abs(f.effect), s.lang, digitsFor("sencillo", f.effect))} ${m.variable.unit} cada 10 años`
      : `${f.effect > 0 ? "Rising" : "Falling"} about ${num(Math.abs(f.effect), s.lang, digitsFor("sencillo", f.effect))} ${m.variable.unit} every 10 years`)
    : c.notYet;
  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="rounded-2xl bg-surface-2 p-4 text-base leading-7">{sentence}</p>
      {limit ? <p className="flex gap-1.5 text-sm text-text-2"><span aria-hidden="true">⚠︎</span>{limit.text[s.lang]}</p> : null}
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
      <button type="button" onClick={onDeeper} className="self-start text-sm font-semibold underline underline-offset-4">{c.technical} →</button>
    </div>
  );
}
