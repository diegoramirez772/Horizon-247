"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compose, hoverText, type Card, type Ctx } from "@/core/assistant/compose";
import { Conversation, type Via } from "@/core/assistant/conversation";
import type { Command, Intent } from "@/core/assistant/parse";
import { parse } from "@/core/assistant/parse";
import { followUp } from "@/core/assistant/context";
import { flushPending, run, type Deps } from "@/core/assistant/run";
import { siblings } from "@/core/contract/extra";
import { cellIndexAt, cellLatLon, type Layer } from "@/core/contract/loader";
import { UI, type Lang } from "@/core/i18n/texts";
import { Hub, type Here } from "@/core/interaction/hub";
import type { MapData } from "@/core/map/MapView";
import { effectiveMetric, stepRegister, Store, type AppState, type Metric, type SceneTarget, type TimeMode, type ZoneTarget } from "@/core/state/store";
import { Chat } from "./Chat";
import { HubProvider } from "./interaccion/context";
import { InteractionLayer } from "./interaccion/InteractionLayer";
import { useAppState, useTheme, useUrlSync } from "./hooks";
import type { MapFocus, Projection } from "./MapCanvas";
import { MapPanel, type PanelTab } from "./MapPanel";
import { consumeRedirect } from "@/core/live/auth";
import { LoginDialog } from "./LoginDialog";
import { Sidebar } from "./Sidebar";
import { useHome, useIndex, useLayer, useMapData, useSeries } from "./useBundles";
import { OfflineBanner } from "./OfflineBanner";

const C = {
  es: { back: "Regresar", backLong: "Regresar al inicio", map: "Monitoreo", theme: "Cambiar tema", skip: "Ir a la caja de preguntas", empty: "Aún no hay capas de datos." },
  en: { back: "Back", backLong: "Back to the start", map: "Monitoring", theme: "Switch theme", skip: "Go to the question box", empty: "No data layers yet." },
};

/** Questions that are about the map open the side panel; the rest stay in the conversation. */
const STAYS_IN_CHAT: Intent["t"][] = ["howto", "speed", "gestures", "topic", "report", "help", "advice", "cause", "unknown", "undo", "clear", "lang", "register", "theme", "greet", "profile", "provenance", "certainty"];

/**
 * One main window (Diego's brief): the conversation stays centred and always visible; the map and the evidence
 * open in a side panel that splits the screen — it never covers the conversation — and can be widened.
 */
export function HorizonApp() {
  const [store] = useState(() => new Store());
  const [conv] = useState(() => new Conversation());
  const raw = useAppState(store);
  // Each level offers its own metrics (Simple: verdict; Normal: + effect; Experto: + MDE, years); others fall back to the verdict.
  const s = useMemo(() => {
    const metric = effectiveMetric(raw.register, raw.metric);
    return metric === raw.metric ? raw : { ...raw, metric };
  }, [raw]);
  const homeDoc = useHome();
  useUrlSync(store);
  const theme = useTheme();
  const { index, regions } = useIndex();
  const [attempt, setAttempt] = useState(0);
  const [panel, setPanel] = useState<PanelTab | null>(null);
  // Sign-in dialog: from the sidebar, or from any action that needs a person (askLogin → «h247:login»).
  // The address as it arrived (the URL sync rewrites it right after): «?panel=…» and «?login=1» are read from here.
  const [boot] = useState(() => (typeof window === "undefined" ? "" : window.location.search));
  const [login, setLogin] = useState(false);
  const closeLogin = useCallback(() => setLogin(false), []);
  useEffect(() => {
    const open = () => setLogin(true);
    if (new URLSearchParams(boot).get("login") === "1") setLogin(true);
    void consumeRedirect(); // the confirmation email's link signs you in by itself
    addEventListener("h247:login", open);
    return () => removeEventListener("h247:login", open);
  }, []);
  // The installed app's «En vivo» shortcut opens straight on that tab (manifest.webmanifest).
  useEffect(() => {
    { const p = new URLSearchParams(boot).get("panel"); if (p === "live" || p === "map" || p === "evidence" || p === "scene" || p === "zone" || p === "fauna" || p === "person") setPanel(p); }
  }, []);
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
  const T = UI[s.lang];
  const c = C[s.lang];

  const entries = useMemo(() => (index.status === "ready" ? index.value : []), [index]);
  const earth = useMemo(() => entries.filter((e) => e.profile === "earth"), [entries]);
  const entry = earth.find((e) => e.id === s.layerId) ?? null;

  useEffect(() => {
    if (!s.hydrated || index.status !== "ready" || entry || earth.length === 0) return;
    // Start on the planet's temperature year by year (2°, light, with its series: charts and «evolución» work at once).
    const yearly = earth.find((e) => /annual2deg/.test(e.id));
    const first = yearly ?? earth.find((e) => /T2M/.test(e.id) && /global|zarr/i.test(e.id)) ?? earth[0];
    const sib = siblings(entries, first);
    store.set({ layerId: yearly ? yearly.id : (sib.at(-1) ?? first).id, profile: "earth" });
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

  // The last question, so follow-ups («¿y en Chihuahua?», «¿y la lluvia?») keep what was being talked about.
  const lastCmd = useRef<Command | null>(null);
  const onCommand = useCallback((raw: Command, via: Via, label: string) => {
    setHome(false);
    const cmd = followUp(lastCmd.current, raw, label);
    if (cmd.intent.t !== "undo" && cmd.intent.t !== "unknown") lastCmd.current = cmd;
    run(cmd, via, label, deps);
    if (cmd.intent.t === "scene") setPanel(cmd.intent.real ? "zone" : "scene");
    else if (cmd.intent.t === "open") setPanel(cmd.intent.panel);
    else if (!STAYS_IN_CHAT.includes(cmd.intent.t)) setPanel((p) => p ?? "map");
  }, [deps]);

  // ---- interaction layer (doc «Interacción v2»): voice, numbers, gamepad, hand and ZON all end here ----
  const onCommandRef = useRef(onCommand);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);
  const [hub] = useState(() => new Hub({
    lang: () => ctxRef.current.state.lang,
    ask: (text, via, label) => onCommandRef.current(parse(text, ctxRef.current.regions), via, label),
    answer: (card) => { setHome(false); conv.answer(card); },
    here: () => hereOf(ctxRef.current),
    openMap: () => setPanel((p) => p ?? "map"),
    describeHere: () => {
      const c = ctxRef.current, sel = c.state.selection;
      if (sel?.kind !== "cell") return hereOf(c)?.name ?? null;
      const h = hoverText(c, sel.index);
      return h ? `${h.where}. ${h.title}. ${h.line}` : null;
    },
  }));
  useEffect(() => hub.install(), [hub]);
  // «enciende gestos» from the assistant (run.ts cannot reach the hub).
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<boolean>).detail) void hub.startGestures(); else hub.stopGestures(); };
    addEventListener("h247:gestures", on);
    return () => removeEventListener("h247:gestures", on);
  }, [hub]);

  const focusOn = useCallback((card: Card) => {
    if (card.evidence) store.set({ selection: card.evidence.selection, camera: store.get().camera + 1 });
  }, [store]);
  const onShow = useCallback((card: Card) => { focusOn(card); setPanel("map"); }, [focusOn]);
  const onEvidence = useCallback((card: Card) => { focusOn(card); setPanel("evidence"); }, [focusOn]);
  // What the assistant's generated components can do: fly the globe to a point, or change the NASA imagery.
  const actions = useMemo(() => ({
    look: (lat: number, lon: number) => {
      const l = ctxRef.current.layer;
      const i = l ? cellIndexAt(l.manifest, lat, lon) : -1;
      store.set({ selection: i >= 0 ? { kind: "cell", index: i } : null, camera: store.get().camera + 1 });
      setPanel("map");
    },
    imagery: (id: string) => { store.set({ imagery: id }); setPanel("map"); },
  }), [store]);

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
    deeper: () => { store.set({ register: stepRegister(store.get().register, 1) }); },
    imagery: (id: string | null) => { store.set({ imagery: id }); },
    look: (lat: number, lon: number) => actions.look(lat, lon),
    evolutionDone: () => { store.set({ evolution: false }); },
    speed: (v: number) => { store.set({ speed: v }); },
    scene: (t: SceneTarget) => { store.set({ scene: t }); setPanel("scene"); },
    zone: (z: ZoneTarget) => { store.set({ zone: z }); setPanel("zone"); },
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
  }), [store, conv, deps, actions]);

  // The sidebar's «Escena 3D» follows what is selected now (not an older scene).
  const openPanel = (p: PanelTab | null) => { if (p === "scene") store.set({ scene: null }); if (p === "zone") store.set({ zone: null }); setPanel(p); };
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
    <HubProvider value={hub}>
    <div className="flex h-dvh overflow-x-hidden bg-bg">
      <OfflineBanner lang={s.lang} />
      <Sidebar lang={s.lang} setLang={(l) => store.set({ lang: l })} panel={panel} setPanel={openPanel} home={home}
        onHome={goHome} onLogin={() => setLogin(true)} dark={theme.pref !== "light"} toggleTheme={() => theme.setPref(theme.pref === "light" ? "dark" : "light")} />
      <div className="flex min-w-0 flex-1 flex-col">
      <a href="#ask" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-2">{c.skip}</a>


      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 max-md:pt-12">
          {index.status === "ready" && earth.length === 0 && !homeDoc ? (
            <p className="p-10 text-center text-text-2">{c.empty} {T.emptyHint}</p>
          ) : (
            <Chat conv={conv} ctx={ctx} home={home} onRegister={(r) => store.set({ register: r })} onHome={setHome} onCommand={onCommand} onShow={onShow} onEvidence={onEvidence} homeDoc={homeDoc} actions={actions} />
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
      <InteractionLayer lang={s.lang} />
      <LoginDialog lang={s.lang} open={login} onClose={closeLogin} />
    </div>
    </HubProvider>
  );
}

/** «esto / aquí»: the selected region or cell, with the variable of the layer on screen (for monitors and reports). */
function hereOf(ctx: Ctx): Here | null {
  const sel = ctx.state.selection;
  const m = ctx.layer?.manifest;
  if (!sel || !m) return null;
  const variable = { name: m.variable.name, unit: m.variable.unit };
  if (sel.kind === "region") {
    const r = ctx.regions.find((x) => x.id === sel.id) as (Ctx["regions"][number] & { bbox?: [number, number, number, number] }) | undefined;
    if (!r) return null;
    const b = r.bbox;
    if (!b) return null;
    const lat = (b[1] + b[3]) / 2, lon = (b[0] + b[2]) / 2;
    return { name: r.name[ctx.state.lang].replace(/\s*\(.*\)\s*$/, ""), lat, lon, entityId: r.id, variable };
  }
  const { lat, lon } = cellLatLon(m, sel.index);
  const ns = lat >= 0 ? "N" : "S", ew = lon >= 0 ? "E" : (ctx.state.lang === "es" ? "O" : "W");
  return { name: `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`, lat, lon, entityId: `celda-${lat.toFixed(2)}_${lon.toFixed(2)}`, variable };
}
