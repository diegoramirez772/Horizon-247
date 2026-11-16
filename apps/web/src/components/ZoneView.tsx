"use client";

// «La zona en 3D real»: the selected place as it is — measured relief + Sentinel-2 imagery — with HORI's reading of
// that zone on top. The generated scene (diorama) is one tap away for «how would it look with these numbers».
// Opened from a focus of the detector, the zone covers the focus and HORI's verdict is draped per cell over the relief.

import { useEffect, useRef, useState } from "react";
import type { Drape } from "@/core/detect/drape";
import { num } from "@/core/format/format";
import type { Lang } from "@/core/i18n/texts";
import { registerView } from "@/core/interaction/manipulate";
import type { ZoneTarget } from "@/core/state/store";
import { TerrainView, reliefBase, type TerrainStatus } from "@/core/terrain/TerrainView";
import type { EffectKind } from "@/core/terrain/effects";

export type { ZoneTarget };

const FX_NAME: Record<EffectKind, { es: string; en: string }> = {
  lluvia: { es: "la lluvia", en: "the rain" }, inundacion: { es: "el agua en las zonas bajas", en: "water in the low ground" },
  tormenta: { es: "la tormenta (nubes, lluvia y relámpagos)", en: "the storm (clouds, rain and lightning)" }, incendio: { es: "el fuego y el humo", en: "fire and smoke" },
  volcan: { es: "la ceniza", en: "the ash" }, nieve: { es: "la nieve", en: "the snow" }, calor: { es: "el calor", en: "the heat" },
  sequia: { es: "la vegetación seca", en: "the dry vegetation" }, bruma: { es: "la bruma", en: "the haze" },
  anomalia: { es: "una marca abstracta (anomalía sin tipo físico)", en: "an abstract mark (anomaly without a physical kind)" },
  bolido: { es: "la estela y el estallido del bólido", en: "the fireball's trail and burst" },
};

export function ZoneView({ zone, lang, reading, onScene, drapeFor, layerName }: {
  zone: ZoneTarget; lang: Lang; reading: { title: string; line: string } | null; onScene: () => void;
  /** HORI's verdict for a lon/lat box (null = no layer on screen). */
  drapeFor?: (box: [number, number, number, number]) => Drape | null;
  /** «Temperatura del aire (2 m) · 1981–2025», for the caption of the draped layer. */
  layerName?: string;
}) {
  const es = lang === "es";
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<TerrainView | null>(null);
  const [status, setStatus] = useState<TerrainStatus>({ phase: "loading", text: "" });
  const [ex, setEx] = useState(1.6);
  const [noGL, setNoGL] = useState(false);
  // HORI's colour over the real picture: on when the zone is a focus (that is the point), off for a place (see it as it is).
  const [drapeOn, setDrapeOn] = useState(!!zone.focus);
  const [drape, setDrape] = useState<Drape | null>(null);
  const drapeRef = useRef(drapeFor);
  useEffect(() => { drapeRef.current = drapeFor; }, [drapeFor]);

  useEffect(() => {
    if (!host.current) return;
    let v: TerrainView;
    try { v = new TerrainView(host.current); } catch { setNoGL(true); return; }
    v.onStatus = (st) => {
      setStatus(st);
      if (st.phase !== "ready") return;
      const b = v.zoneBox();
      setDrape(b && drapeRef.current ? drapeRef.current(b) : null);
    };
    view.current = v;
    const unregister = registerView(v, { es: "zona 3D", en: "3D zone" });
    return () => { unregister(); v.destroy(); view.current = null; };
  }, []);
  const boxKey = zone.box?.join(",") ?? "";
  useEffect(() => { void view.current?.load(zone.lat, zone.lon, zone.box); }, [zone.lat, zone.lon, boxKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the key says when the box changed
  useEffect(() => { view.current?.setExaggeration(ex); }, [ex]);
  useEffect(() => { view.current?.setDrape(drapeOn ? drape : null); }, [drape, drapeOn]);
  // «lo que está pasando», generated from the data on the real place; the switch shows the place clean
  const [fxOn, setFxOn] = useState(true);
  const evKey = zone.event ? `${zone.event.kind}|${zone.event.intensity}|${zone.event.radiusKm}` : "";
  useEffect(() => { view.current?.setEvent(zone.event ?? null); }, [evKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the key says when the event changed
  useEffect(() => { view.current?.setShowFx(fxOn); }, [fxOn]);

  const base = reliefBase(status.halfKm ?? 6);
  const sideKm = status.halfKm ? Math.round(status.halfKm * 2) : 12;
  const oneCell = drape && drape.w * drape.h === 1;

  return (
    <div className="relative min-h-0 flex-1 bg-[#cfdbe8]">
      <div ref={host} className="absolute inset-0" />
      {noGL ? <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-text-2">{es ? "Este equipo no tiene gráfica 3D disponible." : "No 3D graphics available on this device."}</p> : null}

      <div className="glass absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] rounded-2xl px-3.5 py-2.5">
        <p className="text-sm font-semibold">{zone.name}</p>
        <p className="tabular text-xs text-text-2">{zone.lat.toFixed(3)}°, {zone.lon.toFixed(3)}° · {sideKm} × {sideKm} km</p>
        {reading ? (
          <p className="mt-1.5 text-xs"><span className="font-semibold">{reading.title}</span> · {reading.line}</p>
        ) : null}
        {zone.event ? (
          <div className="mt-2 border-t border-border pt-2 text-xs">
            <p className="font-semibold"><span className="live-dot" aria-hidden="true" />{zone.event.label}</p>
            <p className="text-text-2">
              <span className="font-medium text-text">{es ? "Real:" : "Real:"}</span> {es ? "relieve y foto del lugar" : "relief and photo of the place"} ·{" "}
              <span className="font-medium text-text">{es ? "Generado:" : "Generated:"}</span> {FX_NAME[zone.event.kind][lang]} {es ? "a partir de" : "from"} {zone.event.source}
            </p>
            <label className="mt-1 inline-flex items-center gap-1.5">
              <input type="checkbox" checked={fxOn} onChange={(e) => setFxOn(e.target.checked)} />
              {es ? "Mostrar lo que está pasando (generado)" : "Show what is happening (generated)"}
            </label>
          </div>
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
          <span className="tabular text-text">×{num(ex * base, lang, 1)}</span>
        </label>
        {drape ? (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={drapeOn} onChange={(e) => setDrapeOn(e.target.checked)} />
            <span>{es ? "Evidencia de HORI" : "HORI's evidence"}</span>
          </label>
        ) : null}
        {status.phase === "ready" ? <span className="text-text-2">{status.text}</span> : null}
        <button type="button" onClick={onScene} className="ml-auto rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent">
          {es ? "Escena generada con sus datos" : "Generated scene from its data"}
        </button>
        {drape && drapeOn ? (
          <p className="w-full text-[11px] leading-4 text-text-2">
            {es
              ? `Encima: veredicto de HORI por celda de ${num(drape.cellDeg, lang, 1)}°${layerName ? ` (${layerName})` : ""}. Liso = cambio apoyado · puntos = con indicios · rayas = aún no se sabe · gris = sin cambio mayor que δ. Las líneas blancas son los bordes de las celdas.`
              : `On top: HORI's verdict per ${num(drape.cellDeg, lang, 1)}° cell${layerName ? ` (${layerName})` : ""}. Solid = supported change · dots = hints · stripes = not known yet · grey = no change larger than δ. White lines are the cell edges.`}
            {oneCell ? (es ? " Toda la zona cae dentro de una sola celda: se pinta entera." : " The whole zone falls inside one cell: it is painted whole.") : ""}
          </p>
        ) : null}
        <p className="w-full text-[11px] leading-4 text-text-3">
          {es ? "Real, no generado: " : "Real, not generated: "}Sentinel-2 cloudless 2020 © EOX (CC BY-NC-SA 4.0, Copernicus) · {es ? "relieve" : "relief"} AWS Terrain Tiles (Mapzen, SRTM/NASA). {es ? "Luz: el sol de hoy a las 10:30 en este lugar." : "Light: today's sun at 10:30 at this place."}{base > 1.05 ? (es ? ` Zona grande: el relieve va exagerado ×${num(ex * base, lang, 1)}.` : ` Large zone: relief exaggerated ×${num(ex * base, lang, 1)}.`) : ""} {es ? "Arrastra para girar, rueda para acercar." : "Drag to orbit, wheel to zoom."}
        </p>
      </div>
    </div>
  );
}
