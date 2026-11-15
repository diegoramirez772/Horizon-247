"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { registerView } from "@/core/interaction/manipulate";
import { GlobeView } from "@/core/map/GlobeView";
import { GlobeGL } from "@/core/map/GlobeGL";
import { LAYERS } from "@/core/map/imagery";
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

export function MapCanvas({ data, theme, selected, filter, region, focus, label, lang, onPick, describe, onHoverCell, projection = "globe", minimal = false }: {
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
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MapView | GlobeView | GlobeGL | null>(null);
  // Real NASA imagery under the data (GPU globe only): null = Blue Marble base; otherwise a dated layer.
  const [imagery, setImagery] = useState<{ layer: string; date: string } | null>(null);
  const [imageryLabel, setImageryLabel] = useState("");
  const [gpuLost, setGpuLost] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
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
    if (projection !== "globe") v = new MapView(host.current!, L.theme, L.label);
    else if (!gpuLost && detectTier().tier > 0) {
      try {
        const g = new GlobeGL(host.current!, L.theme, L.label);
        g.onImagery = setImageryLabel;
        g.onLost = () => setGpuLost(true);
        v = g;
      } catch { v = new GlobeView(host.current!, L.theme, L.label); }
    } else v = new GlobeView(host.current!, L.theme, L.label);
    setImageryLabel("");
    setIsGL(v instanceof GlobeGL);
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
    if (v instanceof GlobeGL) v.setImagery(imagery);
  }, [imagery, projection, gpuLost]);

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
      {isGL && !minimal ? (
        <div className="absolute right-4 top-[156px] z-10 flex flex-col items-end gap-2">
          <Link href="/escena" title="Escena 3D generada a partir de los datos"
            className="flex h-11 items-center rounded-xl border border-border bg-surface px-3 text-sm shadow-md hover:bg-surface-2">
            Escena 3D
          </Link>
          <button type="button" onClick={() => setImgOpen((o) => !o)} aria-expanded={imgOpen} title="Imagen satelital real bajo los datos"
            className="flex h-11 items-center rounded-xl border border-border bg-surface px-3 text-sm shadow-md hover:bg-surface-2">
            Imagen
          </button>
          {imgOpen ? (
            <div className="glass w-[248px] space-y-2 rounded-xl p-3 text-sm">
              <label className="block">
                <span className="text-xs text-text-3">Capa</span>
                <select className="mt-1 w-full rounded-lg border border-border-control bg-surface px-2 py-1"
                  value={imagery?.layer ?? ""}
                  onChange={(e) => setImagery(e.target.value ? { layer: e.target.value, date: imagery?.date ?? yesterday() } : null)}>
                  <option value="">Blue Marble (ilustrativa)</option>
                  {LAYERS.filter((l) => l.body === "earth" && l.role !== "base" && l.role !== "night").map((l) => (
                    <option key={l.id} value={l.id}>{l.title}</option>
                  ))}
                </select>
              </label>
              {imagery ? (
                <label className="block">
                  <span className="text-xs text-text-3">Fecha</span>
                  <input type="date" className="mt-1 w-full rounded-lg border border-border-control bg-surface px-2 py-1" value={imagery.date} max={yesterday()}
                    onChange={(e) => e.target.value && setImagery({ layer: imagery.layer, date: e.target.value })} />
                </label>
              ) : null}
              <p className="text-xs text-text-3">Acerca el globo para ver más detalle. Las franjas rayadas son zonas sin observación ese día.</p>
            </div>
          ) : null}
        </div>
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
