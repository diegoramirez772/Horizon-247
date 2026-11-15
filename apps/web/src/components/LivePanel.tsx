"use client";

// Monitoreo · «En vivo» (Plan de unión U5): what NASA shows RIGHT NOW, free and without an account —
// geostationary infrared every 10 minutes (GIBS), the natural events open today (EONET) and the latest
// conditions at your places (POWER). Places are a per-viewer convenience kept in this browser only.

import { useEffect, useState } from "react";
import { findPlace, HOME_PLACE, type Where } from "@/core/genui/places";
import type { Lang } from "@/core/i18n/texts";
import { LAYERS, liveSlot } from "@/core/map/imagery";
import { type LiveDetection, type WeatherFrame, distanceKm, subscribeWeather } from "@/core/map/weather";
import { EventsWidget, NowWidget } from "./genui/Widgets";

const PLACES_STORE = "h247-places-v1";

function readPlaces(): Where[] {
  try {
    const v = JSON.parse(localStorage.getItem(PLACES_STORE) ?? "null");
    if (Array.isArray(v) && v.every((p) => typeof p?.name === "string" && Number.isFinite(p?.lat) && Number.isFinite(p?.lon))) return v;
  } catch { /* private window or blocked storage: start with the default */ }
  return [HOME_PLACE];
}

function savePlaces(p: Where[]): void {
  try { localStorage.setItem(PLACES_STORE, JSON.stringify(p)); } catch { /* not kept: fine */ }
}

/** «Torreón», «24.5, -104.6» or «24.5 N 104.6 O». */
function parsePlace(text: string): Where | null {
  const named = findPlace(text);
  if (named) return named;
  const m = text.trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*°?\s*([ns])?\s*[ ,;]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*°?\s*([eow])?$/i);
  if (!m) return null;
  let lat = Number(m[1].replace(",", "."));
  let lon = Number(m[3].replace(",", "."));
  if (m[2]?.toLowerCase() === "s") lat = -Math.abs(lat);
  if (m[4] && /[ow]/i.test(m[4])) lon = -Math.abs(lon);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, lat, lon };
}

export function LivePanel({ lang, imagery, onImagery, onLook }: {
  lang: Lang; imagery: string | null; onImagery: (id: string | null) => void; onLook: (lat: number, lon: number) => void;
}) {
  const es = lang === "es";
  const [places, setPlaces] = useState<Where[]>([HOME_PLACE]);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const [slot, setSlot] = useState(liveSlot);
  useEffect(() => { setPlaces(readPlaces()); }, []);
  useEffect(() => {
    const id = window.setInterval(() => setSlot(liveSlot()), 60e3);
    return () => window.clearInterval(id);
  }, []);
  const live = LAYERS.filter((l) => l.live);
  const actions = { look: onLook, imagery: (id: string) => onImagery(id) };

  const add = () => {
    const p = parsePlace(draft);
    if (!p) { setBad(true); return; }
    const next = [p, ...places.filter((x) => x.name !== p.name)].slice(0, 6);
    setPlaces(next);
    savePlaces(next);
    setDraft("");
    setBad(false);
  };
  const remove = (name: string) => {
    const next = places.filter((x) => x.name !== name);
    setPlaces(next);
    savePlaces(next);
  };

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      <LiveDetections lang={lang} places={places} onLook={onLook} />

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3"><span className="live-dot" aria-hidden="true" />{es ? "Satélites ahora" : "Satellites now"}</h2>
        <p className="mt-1 text-sm text-text-2">
          {es ? `Infrarrojo térmico de las ${slot.slice(11, 16)} UTC: lo brillante son nubes frías y altas, también de noche. Se actualiza cada 10 minutos.`
            : `Thermal infrared at ${slot.slice(11, 16)} UTC: bright means cold, high clouds, day or night. Updated every 10 minutes.`}
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {live.map((l) => (
            <button key={l.id} type="button" onClick={() => onImagery(imagery === l.id ? null : l.id)} aria-pressed={imagery === l.id}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${imagery === l.id ? "border-accent bg-accent text-on-accent" : "border-border bg-surface hover:border-accent"}`}>
              <span className="block font-medium">{l.title.replace(/^Infrarrojo en vivo · /, "")}</span>
              <span className={`block text-xs ${imagery === l.id ? "opacity-80" : "text-text-3"}`}>{es ? "cada 10 min · 2 km" : "every 10 min · 2 km"}</span>
            </button>
          ))}
        </div>
        {imagery ? (
          <button type="button" onClick={() => onImagery(null)} className="mt-2 text-sm text-text-2 underline underline-offset-2 hover:text-text">
            {es ? "Quitar la imagen (volver a Blue Marble)" : "Remove imagery (back to Blue Marble)"}
          </button>
        ) : null}
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3">{es ? "Tus lugares" : "Your places"}</h2>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input value={draft} onChange={(e) => { setDraft(e.target.value); setBad(false); }} aria-invalid={bad}
            placeholder={es ? "Ciudad o «lat, lon» (24.5, -104.6)" : "City or «lat, lon» (24.5, -104.6)"}
            className="min-w-0 flex-1 rounded-xl border border-border-control bg-surface px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl bg-accent px-3.5 text-sm font-medium text-on-accent">{es ? "Agregar" : "Add"}</button>
        </form>
        {bad ? <p className="mt-1 text-xs text-text-2">{es ? "No reconocí ese lugar. Escribe sus coordenadas, por ejemplo: 24.5, -104.6" : "I did not recognise that place. Try coordinates: 24.5, -104.6"}</p> : null}
        <div className="mt-3 space-y-3">
          {places.map((p) => (
            <div key={p.name}>
              <NowWidget where={p} lang={lang} actions={actions} />
              {places.length > 1 ? (
                <button type="button" onClick={() => remove(p.name)} className="mt-1 text-xs text-text-3 underline underline-offset-2 hover:text-text">
                  {es ? `Quitar ${p.name}` : `Remove ${p.name}`}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <EventsWidget near={places[0] ?? null} lang={lang} actions={actions} />
      </section>
    </div>
  );
}

const KIND = {
  es: { tormenta: "Tormenta (topes muy fríos)", lluvia_intensa: "Lluvia intensa", nieve: "Nieve o lluvia helada" },
  en: { tormenta: "Storm (very cold tops)", lluvia_intensa: "Heavy rain", nieve: "Snow or freezing rain" },
};
const TREND = {
  es: { nuevo: "nuevo", crece: "crece", se_debilita: "se debilita", sigue: "sigue" },
  en: { nuevo: "new", crece: "growing", se_debilita: "weakening", sigue: "ongoing" },
};

/**
 * «Detección en vivo»: the storms and heavy rain the live detector (core/map/weather.ts) finds in the same infrared and
 * IMERG pictures the globe shows, followed from one frame to the next. A detection is a signal in the picture, not a forecast.
 */
function LiveDetections({ lang, places, onLook }: { lang: Lang; places: Where[]; onLook: (lat: number, lon: number) => void }) {
  const es = lang === "es";
  const [f, setF] = useState<WeatherFrame | null>(null);
  useEffect(() => subscribeWeather(setF), []);
  const where = (d: LiveDetection) => {
    const near = places.map((p) => ({ p, km: distanceKm(p.lat, p.lon, d.lat, d.lon) })).sort((a, b) => a.km - b.km)[0];
    const ll = `${Math.abs(d.lat).toFixed(1)}° ${d.lat >= 0 ? "N" : "S"}, ${Math.abs(d.lon).toFixed(1)}° ${d.lon >= 0 ? "E" : es ? "O" : "W"}`;
    return near && near.km < 1500 ? `${ll} · ${es ? "a" : ""} ${Math.round(near.km).toLocaleString(lang)} km ${es ? "de" : "from"} ${near.p.name}` : ll;
  };
  const hhmm = (t: string | null) => (t ? `${t.slice(11, 16)} UTC` : "—");
  const list = f?.detections.slice(0, 10) ?? [];
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3"><span className="live-dot" aria-hidden="true" />{es ? "Detección en vivo" : "Live detection"}</h2>
      <p className="mt-1 text-sm text-text-2">
        {!f ? (es ? "Leyendo las nubes y la lluvia de ahora…" : "Reading current clouds and rain…")
          : es ? `Nubes ${hhmm(f.irTime)} · lluvia ${hhmm(f.rainTime)}. ${f.detections.length} zonas activas; se revisa cada 10 minutos y cada una se sigue entre imágenes.`
            : `Clouds ${hhmm(f.irTime)} · rain ${hhmm(f.rainTime)}. ${f.detections.length} active areas; checked every 10 minutes and followed between pictures.`}
      </p>
      {list.length ? (
        <ul className="mt-2 space-y-1.5">
          {list.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => onLook(d.lat, d.lon)}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm transition-colors hover:border-accent">
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.kind === "tormenta" ? "bg-[#ff5a3c]" : d.kind === "nieve" ? "bg-[#7fd8ff]" : "bg-[#3cb4ff]"}`} />
                  <span className="font-medium">{KIND[lang][d.kind]}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.trend === "nuevo" || d.trend === "crece" ? "bg-accent text-on-accent" : "bg-surface-2 text-text-2"}`}>{TREND[lang][d.trend]}</span>
                </span>
                <span className="mt-0.5 block text-xs text-text-3">
                  {where(d)} · ≈{Math.round(d.areaKm2 / 1000).toLocaleString(lang)} mil km²{d.movedKm ? ` · ${es ? "se movió" : "moved"} ${d.movedKm} km` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-text-3">
        {es ? "Tormenta = topes de nube muy fríos en el infrarrojo (GOES/Himawari); lluvia intensa = naranja a rojo en IMERG. Es lo que se ve en la imagen, no un pronóstico; IMERG llega con unas horas de retraso."
          : "Storm = very cold cloud tops in the infrared (GOES/Himawari); heavy rain = orange to red in IMERG. It is what the picture shows, not a forecast; IMERG arrives a few hours late."}
      </p>
    </section>
  );
}
