"use client";

// «La zona en 3D real»: the selected place as it is — measured relief + Sentinel-2 imagery — with HORI's reading of
// that zone on top. The generated scene (diorama) is one tap away for «how would it look with these numbers».

import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/core/i18n/texts";
import { registerView } from "@/core/interaction/manipulate";
import { TerrainView, type TerrainStatus } from "@/core/terrain/TerrainView";

export interface ZoneTarget { name: string; lat: number; lon: number }

export function ZoneView({ zone, lang, reading, onScene }: {
  zone: ZoneTarget; lang: Lang; reading: { title: string; line: string } | null; onScene: () => void;
}) {
  const es = lang === "es";
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<TerrainView | null>(null);
  const [status, setStatus] = useState<TerrainStatus>({ phase: "loading", text: "" });
  const [ex, setEx] = useState(1.6);
  const [noGL, setNoGL] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    let v: TerrainView;
    try { v = new TerrainView(host.current); } catch { setNoGL(true); return; }
    v.onStatus = setStatus;
    view.current = v;
    const unregister = registerView(v, { es: "zona 3D", en: "3D zone" });
    return () => { unregister(); v.destroy(); view.current = null; };
  }, []);
  useEffect(() => { void view.current?.load(zone.lat, zone.lon); }, [zone.lat, zone.lon]);
  useEffect(() => { view.current?.setExaggeration(ex); }, [ex]);

  return (
    <div className="relative min-h-0 flex-1 bg-[#cfdbe8]">
      <div ref={host} className="absolute inset-0" />
      {noGL ? <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-text-2">{es ? "Este equipo no tiene gráfica 3D disponible." : "No 3D graphics available on this device."}</p> : null}

      <div className="glass absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] rounded-2xl px-3.5 py-2.5">
        <p className="text-sm font-semibold">{zone.name}</p>
        <p className="tabular text-xs text-text-2">{zone.lat.toFixed(3)}°, {zone.lon.toFixed(3)}° · 12 × 12 km</p>
        {reading ? (
          <p className="mt-1.5 text-xs"><span className="font-semibold">{reading.title}</span> · {reading.line}</p>
        ) : null}
      </div>

      {status.phase !== "ready" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span role="status" className="glass rounded-full px-4 py-2 text-sm text-text-2">
            {status.phase === "error" ? status.text : (es ? "Bajando el relieve y la imagen satelital…" : "Loading relief and satellite imagery…")}
          </span>
        </div>
      ) : null}

      <div className="glass absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-3.5 py-2.5 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-text-2">{es ? "Relieve" : "Relief"}</span>
          <input type="range" min={1} max={4} step={0.1} value={ex} onChange={(e) => setEx(Number(e.target.value))} aria-label={es ? "Exageración del relieve" : "Relief exaggeration"} className="w-24" />
          <span className="tabular text-text">×{ex.toFixed(1)}</span>
        </label>
        {status.phase === "ready" ? <span className="text-text-2">{status.text}</span> : null}
        <button type="button" onClick={onScene} className="ml-auto rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent">
          {es ? "Escena generada con sus datos" : "Generated scene from its data"}
        </button>
        <p className="w-full text-[11px] leading-4 text-text-3">
          {es ? "Real, no generado: " : "Real, not generated: "}Sentinel-2 cloudless 2020 © EOX (CC BY-NC-SA 4.0, Copernicus) · {es ? "relieve" : "relief"} AWS Terrain Tiles (Mapzen, SRTM/NASA). {es ? "Arrastra para girar, rueda para acercar." : "Drag to orbit, wheel to zoom."}
        </p>
      </div>
    </div>
  );
}
