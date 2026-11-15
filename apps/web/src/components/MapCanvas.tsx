"use client";

import { useEffect, useRef, useState } from "react";
import { GlobeView } from "@/core/map/GlobeView";
import { MapView, type BBox, type MapData } from "@/core/map/MapView";
import type { MapTheme } from "@/core/map/palette";
import { UI, type Lang } from "@/core/i18n/texts";

export type MapFocus =
  | { key: string; kind: "point"; lat: number; lon: number; span: number }
  | { key: string; kind: "box"; bbox: BBox }
  | { key: string; kind: "world" };

export interface HoverInfo { title: string; line: string; where: string }

export type Projection = "globe" | "flat";

export function MapCanvas({ data, theme, selected, filter, region, focus, label, lang, onPick, describe, onHoverCell, projection = "globe" }: {
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
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MapView | GlobeView | null>(null);
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
    const v = projection === "globe" ? new GlobeView(host.current!, L.theme, L.label) : new MapView(host.current!, L.theme, L.label);
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
    return () => { v.destroy(); view.current = null; };
  }, [projection]);

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
      <div className="absolute right-4 top-4 z-10 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-md">
        <MapButton label={T.zoomIn} onClick={() => view.current?.zoomBy(1.4)}>+</MapButton>
        <MapButton label={T.zoomOut} onClick={() => view.current?.zoomBy(0.7)}>−</MapButton>
        <MapButton label={T.resetView} onClick={() => view.current?.fitWorld(true)}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
        </MapButton>
      </div>
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="flex h-11 w-11 items-center justify-center text-xl leading-none text-text hover:bg-surface-2 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border">
      {children}
    </button>
  );
}
