"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { compose, hoverText, type Card, type Ctx } from "@/core/assistant/compose";
import { Conversation, type Via } from "@/core/assistant/conversation";
import type { Command, Intent } from "@/core/assistant/parse";
import { flushPending, run, type Deps } from "@/core/assistant/run";
import { siblings } from "@/core/contract/extra";
import { cellIndexAt, cellLatLon, type Layer } from "@/core/contract/loader";
import { UI, type Lang } from "@/core/i18n/texts";
import type { MapData } from "@/core/map/MapView";
import { Store, type AppState, type Metric, type TimeMode } from "@/core/state/store";
import { Chat, MapIcon } from "./Chat";
import { useAppState, useTheme, useUrlSync } from "./hooks";
import type { MapFocus, Projection } from "./MapCanvas";
import { MapPanel, type PanelTab } from "./MapPanel";
import { Logo, Segmented } from "./ui";
import { useIndex, useLayer, useMapData, useSeries } from "./useBundles";

const C = {
  es: { back: "Regresar", backLong: "Regresar al inicio", map: "Mapa", newChat: "Nueva conversación", theme: "Cambiar tema", skip: "Ir a la caja de preguntas", empty: "Aún no hay capas de datos." },
  en: { back: "Back", backLong: "Back to the start", map: "Map", newChat: "New conversation", theme: "Switch theme", skip: "Go to the question box", empty: "No data layers yet." },
};

/** Questions that are about the map open the side panel; the rest stay in the conversation. */
const STAYS_IN_CHAT: Intent["t"][] = ["help", "advice", "cause", "unknown", "undo", "clear", "lang", "register", "theme", "greet", "profile", "provenance"];

/**
 * One main window (Diego's brief): the conversation stays centred and always visible; the map and the evidence
 * open in a side panel that splits the screen — it never covers the conversation — and can be widened.
 */
export function HorizonApp() {
  const [store] = useState(() => new Store());
  const [conv] = useState(() => new Conversation());
  const raw = useAppState(store);
  // Metrics other than the verdict are an Experto tool: in Sencillo the map always shows the verdict.
  const s = useMemo(() => (raw.register === "tecnico" || raw.metric === "verdict" ? raw : { ...raw, metric: "verdict" as const }), [raw]);
  useUrlSync(store);
  const theme = useTheme();
  const { index, regions } = useIndex();
  const [attempt, setAttempt] = useState(0);
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [wide, setWide] = useState(false);
  const [home, setHome] = useState(true);
  const [full, setFull] = useState(false);
  const [projection, setProjection] = useState<Projection>("globe");
  // Esc leaves full screen.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  const talked = useSyncExternalStore(conv.subscribe, () => conv.get().messages.length > 0, () => false);
  const T = UI[s.lang];
  const c = C[s.lang];

  const entries = useMemo(() => (index.status === "ready" ? index.value : []), [index]);
  const earth = useMemo(() => entries.filter((e) => e.profile === "earth"), [entries]);
  const entry = earth.find((e) => e.id === s.layerId) ?? null;

  useEffect(() => {
    if (!s.hydrated || index.status !== "ready" || entry || earth.length === 0) return;
    const sib = siblings(entries, earth[0]);
    store.set({ layerId: (sib.at(-1) ?? earth[0]).id, profile: "earth" });
  }, [s.hydrated, index.status, entry, earth, entries, store]);

  const layerLoad = useLayer(entry, attempt);
  const layer = layerLoad.status === "ready" ? layerLoad.value : null;
  const seriesReady = useSeries(layer, s.timeMode === "anual" || s.selection?.kind === "cell");
  const { data, blueIsMore } = useMapData(layer, s, seriesReady);

  const ctx: Ctx = useMemo(() => ({ layer, regions, entries, state: s }), [layer, regions, entries, s]);
  const ctxRef = useRef(ctx);
  const dataRef = useRef<MapData | null>(data);
  useEffect(() => { ctxRef.current = ctx; dataRef.current = data; }, [ctx, data]);
  const deps: Deps = useMemo(() => ({ store, conv, ctx: () => ctxRef.current, setTheme: (t) => theme.setPref(t) }), [store, conv, theme]);

  // Keep the selected AREA across layers (24 ↔ 45 years), then deliver an answer that waited for the layer.
  const prevLayer = useRef<Layer | null>(null);
  useEffect(() => {
    if (!layer) return;
    const prev = prevLayer.current;
    prevLayer.current = layer;
    const sel = store.get().selection;
    if (prev && prev !== layer && sel?.kind === "cell") {
      const { lat, lon } = cellLatLon(prev.manifest, sel.index);
      const i = cellIndexAt(layer.manifest, lat, lon);
      store.set({ selection: i >= 0 ? { kind: "cell", index: i } : null });
    }
    ctxRef.current = { layer, regions, entries, state: store.get() };
    flushPending(deps);
  }, [layer, store, deps, regions, entries]);

  const onCommand = useCallback((cmd: Command, via: Via, label: string) => {
    setHome(false);
    run(cmd, via, label, deps);
    if (!STAYS_IN_CHAT.includes(cmd.intent.t)) setPanel((p) => p ?? "map");
  }, [deps]);

  const focusOn = useCallback((card: Card) => {
    if (card.evidence) store.set({ selection: card.evidence.selection, camera: store.get().camera + 1 });
  }, [store]);
  const onShow = useCallback((card: Card) => { focusOn(card); setPanel("map"); }, [focusOn]);
  const onEvidence = useCallback((card: Card) => { focusOn(card); setPanel("evidence"); }, [focusOn]);

  const pick = useCallback((i: number) => {
    store.set({ selection: { kind: "cell", index: i } });
    conv.answer(compose("area", { ...ctxRef.current, state: store.get() }, "map"));
  }, [store, conv]);

  const setFilter = useCallback((f: number[] | null) => {
    store.set({ filter: f });
    conv.answer(compose("filter", { ...ctxRef.current, state: store.get() }, "controls"));
  }, [store, conv]);

  const controls = useMemo(() => ({
    metric: (mt: Metric) => { store.set({ metric: mt, filter: mt === "verdict" ? store.get().filter : null }); },
    expert: () => { store.set({ register: "tecnico" }); },
    window: (id: string) => {
      store.set({ layerId: id, timeMode: "completa", year: null, windowEnd: null });
      conv.wait({ kind: store.get().selection ? "area" : "summary", source: "controls", correctable: false, waitLayer: id });
      flushPending(deps);
    },
    time: (mode: TimeMode) => {
      const m = ctxRef.current.layer?.manifest;
      const patch: Partial<AppState> = { timeMode: mode };
      if (mode === "anual") patch.year = m?.series?.years.at(-1) ?? null;
      if (mode === "acumulada") patch.windowEnd = m?.windows?.ends.at(-1) ?? null;
      store.set(patch);
      const kind = mode === "anual" ? "year" : mode === "acumulada" ? "accumulated" : store.get().selection ? "area" : "summary";
      conv.answer(compose(kind, { ...ctxRef.current, state: store.get() }, "controls"));
    },
    year: (y: number) => { store.set({ year: y }); conv.answer(compose("year", { ...ctxRef.current, state: store.get() }, "controls")); },
    windowEnd: (y: number) => { store.set({ windowEnd: y }); conv.answer(compose("accumulated", { ...ctxRef.current, state: store.get() }, "controls")); },
  }), [store, conv, deps]);

  const newChat = () => {
    conv.clear();
    store.set({ selection: null, filter: null, timeMode: "completa", camera: store.get().camera + 1 });
    setPanel(null);
    setFull(false);
    setHome(true);
  };
  const goHome = () => { setHome(true); setPanel(null); setFull(false); };

  // Camera: commands bump `camera`; the map flies to whatever the answer is about. Map taps do not move it.
  const focus: MapFocus | null = useMemo(() => {
    if (!layer || !s.camera) return null;
    const sel = s.selection;
    const key = `${s.camera}`;
    if (sel?.kind === "region") {
      const b = regions.find((r) => r.id === sel.id)?.bbox;
      return b ? { key, kind: "box", bbox: b } : null;
    }
    if (sel?.kind === "cell") {
      const { lat, lon } = cellLatLon(layer.manifest, sel.index);
      return { key, kind: "point", lat, lon, span: 70 };
    }
    return { key, kind: "world" };
  }, [s.camera, s.selection, layer, regions]);

  const sel = s.selection;
  const regionBox = sel?.kind === "region" ? regions.find((r) => r.id === sel.id)?.bbox ?? null : null;
  const describe = useCallback((i: number) => {
    const d = dataRef.current;
    return hoverText(ctxRef.current, i, d ? { mode: d.mode ?? "verdict", verdict: d.verdict[i], effect: d.effect[i] } : undefined);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <a href="#ask" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-2">{c.skip}</a>

      <header className="relative z-10 flex h-16 shrink-0 items-center gap-3 px-4">
        {!home && talked ? (
          <button type="button" onClick={goHome} aria-label={c.backLong} title={c.backLong}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 8H3M7 4L3 8l4 4" /></svg>
            <span className="hidden sm:inline">{c.back}</span>
          </button>
        ) : null}
        <button type="button" onClick={goHome} className="rounded-xl px-1 py-1 hover:bg-surface-2" aria-label="HORIZON 247" title={c.backLong}>
          <Logo />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setPanel(panel ? null : "map")} aria-pressed={!!panel}
            className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors ${panel ? "border-accent bg-accent text-on-accent" : "border-border text-text hover:bg-surface-2"}`}>
            <MapIcon />{c.map}
          </button>
          <Segmented label={T.registerLabel} value={s.register} onChange={(r) => store.set({ register: r })} compact
            options={[{ value: "sencillo", label: T.register.sencillo }, { value: "tecnico", label: T.register.tecnico }]} />
          <Segmented<Lang> label={T.lang} value={s.lang} compact onChange={(l) => store.set({ lang: l })}
            options={[{ value: "es", label: "ES", title: "Español" }, { value: "en", label: "EN", title: "English" }]} />
          <HeaderIcon label={c.theme} onClick={() => theme.setPref(theme.pref === "light" ? "dark" : "light")}>
            {theme.pref === "light" ? <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" /> : <><circle cx="8" cy="8" r="3" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" /></>}
          </HeaderIcon>
          <HeaderIcon label={c.newChat} onClick={newChat}><path d="M8 3v10M3 8h10" /></HeaderIcon>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          {index.status === "ready" && earth.length === 0 ? (
            <p className="p-10 text-center text-text-2">{c.empty} {T.emptyHint}</p>
          ) : (
            <Chat conv={conv} ctx={ctx} home={home} onHome={setHome} onCommand={onCommand} onShow={onShow} onEvidence={onEvidence} />
          )}
        </main>
        {panel ? (
          <aside aria-label={c.map}
            className={full
              ? "fixed inset-0 z-50 flex flex-col bg-surface"
              : `fixed inset-0 z-40 flex flex-col border-border bg-surface lg:static lg:z-auto lg:m-3 lg:ml-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:shadow-[0_10px_40px_rgba(16,24,40,0.08)] ${wide ? "lg:w-[64%]" : "lg:w-[48%]"} transition-[width] duration-200`}>
            <MapPanel ctx={ctx} tab={panel} setTab={setPanel} expanded={wide} setExpanded={setWide} onClose={() => { setFull(false); setPanel(null); }}
              full={full} setFull={setFull} projection={projection} setProjection={setProjection}
              data={data} theme={theme.mapTheme} focus={focus} region={regionBox} describe={describe} onPick={pick}
              blueIsMore={blueIsMore} seriesReady={seriesReady} controls={controls} siblings={siblings(entries, entry)} entry={entry}
              onFilter={setFilter} loading={!data && layerLoad.status !== "error"} error={layerLoad.status === "error" ? layerLoad.message : null}
              onRetry={() => setAttempt((a) => a + 1)} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function HeaderIcon({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="flex h-9 w-9 items-center justify-center rounded-full text-text-2 hover:bg-surface-2 hover:text-text">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
    </button>
  );
}
