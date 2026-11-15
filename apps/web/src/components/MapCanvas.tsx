"use client";

import { useEffect, useRef, useState } from "react";
import { registerView } from "@/core/interaction/manipulate";
import { GlobeView } from "@/core/map/GlobeView";
import { GlobeGL } from "@/core/map/GlobeGL";
import { LAYERS, liveSlot } from "@/core/map/imagery";
import { detectTier } from "@/core/map/tier";
import { MapView, type BBox, type MapData } from "@/core/map/MapView";
import type { MapTheme } from "@/core/map/palette";
import { UI, type Lang } from "@/core/i18n/texts";

export type MapFocus =
  | { key: string; kind: "point"; lat: number; lon: number; span: number }
  | { key: string; kind: "box"; bbox: BBox }
  | { key: string; kind: "world" };

export interface HoverInfo { title: string; line: string; where: string }

export type Projection = "globe" | "flat";

export function MapCanvas({ data, theme, selected, filter, region, focus, label, lang, onPick, describe, onHoverCell, projection = "globe", minimal = false,
  imageryId = null, onImagery }: {
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
  const [gpuLost, setGpuLost] = useState(false);
  const [isGL, setIsGL] = useState(false);
  // Latest props, so a view re-created for another projection starts with the same state.
  const latest = useRef({ data, theme, selected, filter, region, label, focus });
  const pick = useRef(onPick);
  const say = useRef(describe);
  const hoverCell = useRef(onHoverCell);
  const [tip, setTip] = useState<{ x: number; y: number; flipX: boolean; flipY: boolean; info: HoverInfo } | null>(null);
  const T = UI[lang];

  useEffect(() => {
    pick.current = onPick; say.current = describe; hoverCell.current = onHoverCell;
    latest.current = { data, theme, selected, filter, region, label, focus };
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
    const f = L.focus;
    if (f?.kind === "point") v.flyTo(f.lat, f.lon, f.span);
    else if (f?.kind === "box") v.flyToBox(f.bbox);
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

  useEffect(() => { view.current?.setTheme(theme); }, [theme]);
  useEffect(() => { view.current?.setLabel(label); }, [label]);
  useEffect(() => { if (data) view.current?.setData(data); }, [data]);
  useEffect(() => { view.current?.select(selected); }, [selected]);
  useEffect(() => { view.current?.setFilter(filter); }, [filter]);
  useEffect(() => { view.current?.setRegion(region); }, [region]);
  useEffect(() => {
    const v = view.current;
    if (!v || !focus) return;
    if (focus.kind === "point") v.flyTo(focus.lat, focus.lon, focus.span);
    else if (focus.kind === "box") v.flyToBox(focus.bbox);
    else v.fitWorld(true);
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
      {imageryLabel ? (
        <p className="glass pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-2rem)] -translate-x-1/2 truncate rounded-lg px-2.5 py-1 text-xs text-text-2">
          {imageryLabel}
        </p>
      ) : null}
      {/* Imagery, view and the 3D scene are chosen in «Vista del mapa» (MapPanel), not here. */}
      {isGL && def && !def.live && !minimal ? (
        <label className="glass absolute right-4 top-[156px] z-10 rounded-xl px-3 py-2 text-xs">
          <span className="block text-text-3">Fecha de la imagen</span>
          <input type="date" className="mt-1 rounded-lg border border-border-control bg-surface px-2 py-1 text-sm" value={day} max={yesterday()}
            onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
      ) : null}
      {minimal ? null : <div className="absolute right-4 top-4 z-10 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-md">
        <MapButton label={T.zoomIn} onClick={() => view.current?.zoomBy(1.4)}>+</MapButton>
        <MapButton label={T.zoomOut} onClick={() => view.current?.zoomBy(0.7)}>−</MapButton>
        <MapButton label={T.resetView} onClick={() => view.current?.fitWorld(true)}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
        </MapButton>
      </div>}
    </div>
  );
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
