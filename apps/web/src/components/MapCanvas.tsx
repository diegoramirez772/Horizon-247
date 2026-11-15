"use client";

import { useEffect, useRef, useState } from "react";
import { registerView } from "@/core/interaction/manipulate";
import { GlobeView } from "@/core/map/GlobeView";
import { DEFAULT_LAYERS, GlobeGL, type GlobeLayers, type MarkerInfo } from "@/core/map/GlobeGL";
import { LAYERS, liveSlot } from "@/core/map/imagery";
import { detectTier } from "@/core/map/tier";
import { MapView, type BBox, type MapData } from "@/core/map/MapView";
import type { MapTheme } from "@/core/map/palette";
import { UI, type Lang } from "@/core/i18n/texts";
import type { PrismLayer } from "@/core/detect/prisms";

export type MapFocus =
  | { key: string; kind: "point"; lat: number; lon: number; span: number }
  | { key: string; kind: "box"; bbox: BBox }
  /** A focus of the detector: seen at an angle on the GPU globe so its prisms show their height. */
  | { key: string; kind: "focus"; lat: number; lon: number; span: number }
  | { key: string; kind: "world" };

export interface HoverInfo { title: string; line: string; where: string }

export type Projection = "globe" | "flat";

export function MapCanvas({ data, theme, selected, filter, region, focus, label, lang, onPick, describe, onHoverCell, projection = "globe", minimal = false,
  imageryId = null, onImagery, prisms = null }: {
  data: MapData | null;
  theme: MapTheme;
  selected: number;
  filter: number[] | null;
  region: BBox | null;
  focus: MapFocus | null;
  label: string;
  lang: Lang;
  onPick: (index: number) => void;
  /** Words for the cell under the pointer (null = nothing to say). */
  describe: (index: number) => HoverInfo | null;
  /** Raw cell under the pointer (−1 = none), for the expert readout. */
  onHoverCell?: (index: number) => void;
  /** 3D globe (default) or flat equirectangular map. */
  projection?: Projection;
  /** Preview (start screen): no zoom buttons. */
  minimal?: boolean;
  /** NASA layer under the data (shared state, so the assistant and «En vivo» can change it); null = Blue Marble. */
  imageryId?: string | null;
  onImagery?: (id: string | null) => void;
  /** Evidence prisms of the foci (GPU globe only; other views just fly there). */
  prisms?: PrismLayer | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MapView | GlobeView | GlobeGL | null>(null);
  // Real NASA imagery under the data (GPU globe only): null = Blue Marble base; otherwise a dated layer.
  // Live layers (geostationary infrared) ask for the latest 10-minute image and refresh themselves.
  const [day, setDay] = useState(yesterday);
  const [slot, setSlot] = useState(liveSlot);
  const def = imageryId ? LAYERS.find((l) => l.id === imageryId) ?? null : null;
  const imagery = def ? { layer: def.id, date: def.live ? slot : day } : null;
  const imageryKey = imagery ? `${imagery.layer}@${imagery.date}` : "";
  useEffect(() => {
    if (!def?.live) return;
    const id = window.setInterval(() => setSlot(liveSlot()), 60e3);
    return () => window.clearInterval(id);
  }, [def?.live]);
  const [imageryLabel, setImageryLabel] = useState("");
  // Filters of the living Earth (per viewer, remembered in this browser) and the card of what was tapped.
  const [layers, setLayers] = useState<GlobeLayers>(DEFAULT_LAYERS);
  const [card, setCard] = useState<MarkerInfo | null>(null);
  const [following, setFollowing] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const layersBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!layersOpen) return;
    const away = (e: PointerEvent) => { if (!layersBox.current?.contains(e.target as Node)) setLayersOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setLayersOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [layersOpen]);
  useEffect(() => { setLayers(readLayers()); }, []);
  const toggle = (k: keyof GlobeLayers) => setLayers((l) => {
    const next = { ...l, [k]: !l[k] };
    if (k === "ir" && next.ir) next.clouds = true; // infrared is a way of seeing the clouds
    try { localStorage.setItem(LAYERS_STORE, JSON.stringify(next)); } catch { /* not kept: fine */ }
    return next;
  });
  const [gpuLost, setGpuLost] = useState(false);
  const [isGL, setIsGL] = useState(false);
  // Latest props, so a view re-created for another projection starts with the same state.
  const latest = useRef({ data, theme, selected, filter, region, label, focus, prisms });
  const pick = useRef(onPick);
  const layersRef = useRef(layers);
  const say = useRef(describe);
  const hoverCell = useRef(onHoverCell);
  const [tip, setTip] = useState<{ x: number; y: number; flipX: boolean; flipY: boolean; info: HoverInfo } | null>(null);
  const T = UI[lang];
  const L2 = lang === "es" ? { layers: "Capas", earth: "Qué ver en la Tierra", date: "Fecha de la imagen", sources: "Fuentes ahora:" } : { layers: "Layers", earth: "What to see on Earth", date: "Picture date", sources: "Sources now:" };
  const activeCount = Object.values(layers).filter(Boolean).length;

  useEffect(() => {
    pick.current = onPick; say.current = describe; hoverCell.current = onHoverCell;
    latest.current = { data, theme, selected, filter, region, label, focus, prisms };
  });

  useEffect(() => {
    const L = latest.current;
    // Globe on the GPU when there is a real one (N1/N2); the Canvas globe otherwise or if the GPU goes away.
    let v: MapView | GlobeView | GlobeGL;
    if (projection !== "globe") { const mv = new MapView(host.current!, L.theme, L.label); mv.onImagery = setImageryLabel; v = mv; }
    else if (!gpuLost && detectTier().tier > 0) {
      try {
        const g = new GlobeGL(host.current!, L.theme, L.label);
        g.onImagery = setImageryLabel;
        g.onLost = () => setGpuLost(true);
        g.onMarker = (m) => { setCard(m); setFollowing(false); if (m) setLayersOpen(false); };
        g.setLayers(layersRef.current);
        v = g;
      } catch (e) { console.warn("[h247] GPU globe failed, canvas globe instead:", e); v = new GlobeView(host.current!, L.theme, L.label); }
    } else v = new GlobeView(host.current!, L.theme, L.label);
    setImageryLabel("");
    setIsGL(v instanceof GlobeGL || v instanceof MapView);
    v.onCellClick = (i) => pick.current(i);
    v.onHover = (i, x, y) => {
      hoverCell.current?.(i);
      const info = i >= 0 ? say.current(i) : null;
      const el = host.current;
      // Keep the label inside the map: flip it to the other side of the pointer near the edges.
      setTip(info && el ? { x, y, info, flipX: x > el.clientWidth - 300, flipY: y > el.clientHeight - 120 } : null);
    };
    view.current = v;
    v.setFilter(L.filter);
    v.setRegion(L.region);
    v.select(L.selected);
    if (L.data) v.setData(L.data);
    if (v instanceof GlobeGL) v.setPrisms(L.prisms);
    if (L.focus) fly(v, L.focus);
    // Voice, hand, gamepad and keys move it too (doc «Interacción v2» §2.6).
    const unregister = registerView(v, projection === "globe" ? { es: "globo", en: "globe" } : { es: "mapa", en: "map" });
    return () => { unregister(); v.destroy(); view.current = null; };
  }, [projection, gpuLost]);

  useEffect(() => {
    const v = view.current;
    if (v instanceof MapView) v.setImagery(imagery);
    if (v instanceof GlobeGL) {
      v.setImagery(imagery);
      // A live satellite picture must be seen: the trend colours step back to a faint veil while it is on.
      v.setDataOpacity(def?.live ? 0.12 : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when the layer or its date really changed
  }, [imageryKey, projection, gpuLost]);

  useEffect(() => { layersRef.current = layers; const v = view.current; if (v instanceof GlobeGL) v.setLayers(layers); }, [layers]);
  useEffect(() => { const v = view.current; if (v instanceof GlobeGL) v.follow(following); }, [following]);
  useEffect(() => { view.current?.setTheme(theme); }, [theme]);
  useEffect(() => { view.current?.setLabel(label); }, [label]);
  useEffect(() => { if (data) view.current?.setData(data); }, [data]);
  useEffect(() => { view.current?.select(selected); }, [selected]);
  useEffect(() => { view.current?.setFilter(filter); }, [filter]);
  useEffect(() => { view.current?.setRegion(region); }, [region]);
  useEffect(() => { const v = view.current; if (v instanceof GlobeGL) v.setPrisms(prisms); }, [prisms]);
  useEffect(() => {
    const v = view.current;
    if (!v || !focus) return;
    fly(v, focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fly only when the focus key changes
  }, [focus?.key]);

  return (
    <div className="absolute inset-0 overflow-hidden" onMouseLeave={() => setTip(null)}>
      <div ref={host} className="absolute inset-0" />
      {tip ? (
        <div
          role="tooltip"
          className="glass fade pointer-events-none absolute z-10 max-w-[260px] rounded-xl px-3 py-2 text-sm"
          style={{ left: tip.x + 16, top: tip.y + 16, transform: `translate(${tip.flipX ? "calc(-100% - 32px)" : "0"}, ${tip.flipY ? "calc(-100% - 32px)" : "0"})` }}
        >
          <p className="text-xs text-text-3">{tip.info.where}</p>
          <p className="font-semibold leading-snug">{tip.info.title}</p>
          <p className="leading-snug text-text-2">{tip.info.line}</p>
        </div>
      ) : null}
      {card ? (
        <div className="fade absolute right-[4.25rem] top-4 z-20 border border-border bg-surface w-[min(300px,calc(100%-6rem))] rounded-2xl p-3 text-sm shadow-lg">
          <div className="flex items-start gap-3">
            {card.photo ? <img src={card.photo} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-lg object-cover" /> : null}
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-snug">{card.title}</p>
              {card.lines.map((l, k) => <p key={k} className={k ? "text-xs leading-snug text-text-3" : "leading-snug text-text-2"}>{l}</p>)}
            </div>
            <button type="button" aria-label={lang === "es" ? "Cerrar" : "Close"} onClick={() => { setCard(null); setFollowing(false); const v = view.current; if (v instanceof GlobeGL) v.unpick(); }}
              className="-mr-1 -mt-1 rounded-full px-2 text-lg leading-none text-text-3 hover:text-text">×</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {card.kind === "sat" ? (
              <button type="button" onClick={() => setFollowing((f) => !f)} aria-pressed={following}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${following ? "bg-accent text-on-accent" : "border border-border"}`}>
                {following ? (lang === "es" ? "Siguiendo" : "Following") : lang === "es" ? "Seguir" : "Follow"}
              </button>
            ) : null}
            {card.url ? <a href={card.url} target="_blank" rel="noreferrer" className="rounded-full border border-border px-3 py-1 text-xs font-semibold">{lang === "es" ? "Fuente" : "Source"} ↗</a> : null}
          </div>
        </div>
      ) : null}
      {/* Imagery, view and the 3D scene are chosen in «Vista del mapa» (MapPanel), not here. */}
      {minimal ? null : <div ref={layersBox} className="absolute right-4 top-4 z-30">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-md">
        <MapButton label={T.zoomIn} onClick={() => view.current?.zoomBy(1.4)}>+</MapButton>
        <MapButton label={T.zoomOut} onClick={() => view.current?.zoomBy(0.7)}>−</MapButton>
        <MapButton label={T.resetView} onClick={() => view.current?.fitWorld(true)}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
        </MapButton>
        {isGL ? (
          <button type="button" onClick={() => { setLayersOpen((o) => !o); setCard(null); }} aria-expanded={layersOpen} aria-label={L2.layers} title={L2.layers}
            className={`relative flex h-11 w-11 items-center justify-center hover:bg-surface-2 ${layersOpen ? "bg-surface-2" : ""}`}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true"><path d="M8 1.8l6.2 3.4L8 8.6 1.8 5.2z" /><path d="M1.8 8.2L8 11.6l6.2-3.4" /><path d="M1.8 11.1L8 14.5l6.2-3.4" /></svg>
            {projection === "globe" ? <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-on-accent">{activeCount}</span> : null}
          </button>
        ) : null}
        </div>
        {layersOpen ? (
          <div role="dialog" aria-label={L2.layers}
            className="fade absolute right-[3.25rem] top-0 w-[min(320px,calc(100vw-6rem))] max-h-[min(70vh,520px)] overflow-y-auto rounded-2xl border border-border bg-surface p-3 text-sm shadow-[0_12px_32px_rgba(16,24,40,0.22)]">
            {projection === "globe" ? (
              <>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-3">{L2.earth}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(CHIPS) as (keyof GlobeLayers)[]).map((k) => (
                    <button key={k} type="button" aria-pressed={layers[k]} onClick={() => toggle(k)}
                      className={`flex min-h-10 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${layers[k] ? "border-accent bg-accent text-on-accent" : "border-border bg-surface text-text-2 hover:border-accent hover:text-text"} ${k === "trend" ? "col-span-2" : ""}`}>
                      <span aria-hidden="true" className="text-base leading-none">{CHIPS[k].icon}</span>
                      <span className="leading-tight">{CHIPS[k][lang]}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {def && !def.live ? (
              <label className="mt-3 flex items-center justify-between gap-2 text-xs">
                <span className="text-text-2">{L2.date}</span>
                <input type="date" className="rounded-lg border border-border-control bg-surface px-2 py-1 text-sm" value={day} max={yesterday()}
                  onChange={(e) => e.target.value && setDay(e.target.value)} />
              </label>
            ) : null}
            {imageryLabel ? (
              <p className="mt-3 border-t border-border pt-2 text-[11px] leading-snug text-text-3">
                <span className="font-semibold text-text-2">{L2.sources}</span> {imageryLabel}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>}
    </div>
  );
}

function fly(v: MapView | GlobeView | GlobeGL, f: MapFocus): void {
  if (f.kind === "focus") { if (v instanceof GlobeGL) v.flyToFocus(f.lat, f.lon, f.span); else v.flyTo(f.lat, f.lon, f.span); }
  else if (f.kind === "point") v.flyTo(f.lat, f.lon, f.span);
  else if (f.kind === "box") v.flyToBox(f.bbox);
  else v.fitWorld(true);
}

const LAYERS_STORE = "h247-globe-layers-v1";
const CHIPS: Record<keyof GlobeLayers, { es: string; en: string; icon: string }> = {
  clouds: { es: "Nubes", en: "Clouds", icon: "☁️" },
  ir: { es: "Infrarrojo", en: "Infrared", icon: "🌡️" },
  rain: { es: "Lluvia", en: "Rain", icon: "🌧️" },
  daynight: { es: "Día y noche", en: "Day & night", icon: "🌗" },
  storms: { es: "Anomalías en vivo", en: "Live anomalies", icon: "⚡" },
  events: { es: "Eventos NASA", en: "NASA events", icon: "🔥" },
  animals: { es: "Animales", en: "Animals", icon: "🐾" },
  sats: { es: "Satélites", en: "Satellites", icon: "🛰️" },
  trend: { es: "Tendencia (azul/rojo)", en: "Trend (blue/red)", icon: "📈" },
};

function readLayers(): GlobeLayers {
  try {
    const v = JSON.parse(localStorage.getItem(LAYERS_STORE) ?? "null");
    if (v && typeof v === "object") return { ...DEFAULT_LAYERS, ...Object.fromEntries(Object.entries(v).filter(([k, x]) => k in DEFAULT_LAYERS && typeof x === "boolean")) };
  } catch { /* private window: defaults */ }
  return DEFAULT_LAYERS;
}

function yesterday(): string {
  return new Date(Date.now() - 864e5).toISOString().slice(0, 10);
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="flex h-11 w-11 items-center justify-center text-xl leading-none text-text hover:bg-surface-2 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border">
      {children}
    </button>
  );
}
