"use client";

// Live views shared by «En vivo», the globe card and the assistant:
//   · IssCam — NASA's official live streams from the International Space Station (YouTube). Only a picture until tapped:
//     the player (and its megabytes) loads on demand. When the station loses signal the stream shows a still or a blue
//     screen; the card says so.
//   · SkyCam — the sky over a region in true colour from GOES (NOAA STAR, GeoColor, every 10 min, 500 px ≈ 280 KB).
//     The last two hours play as a loop only when asked (12 small frames).
//   · JointMap — HORI's joint change (two variables changing together, pre-declared rules), from the joint bundles.
// Checked 2026-11-15: NOAA CDN answers CORS *, sectors mex/cam/car on GOES-19 and wus/ak on GOES-18; the two NASA
// stream ids below were listed on NASA's YouTube channel as official live streams.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Where } from "@/core/genui/places";
import type { Lang } from "@/core/i18n/texts";
import { landMask } from "@/core/map/world";
import { BUNDLES } from "../useBundles";

// ---------------------------------------------------------------- ISS

const ISS_STREAMS = [
  { id: "ROboUHfPUrU", es: "Vistas de la Tierra en HD", en: "HD Earth views" },
  { id: "M3HKLzjvKPc", es: "Video en vivo de la estación", en: "Live station video" },
];

export function IssCam({ lang, compact = false }: { lang: Lang; compact?: boolean }) {
  const es = lang === "es";
  const [k, setK] = useState(0);
  const [on, setOn] = useState(false);
  const s = ISS_STREAMS[k];
  return (
    <figure className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="relative aspect-video bg-black">
        {on ? (
          <iframe className="absolute inset-0 h-full w-full" src={`https://www.youtube-nocookie.com/embed/${s.id}?autoplay=1&mute=1&playsinline=1`}
            title={es ? "Cámara en vivo de la Estación Espacial Internacional (NASA)" : "International Space Station live camera (NASA)"}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button type="button" onClick={() => setOn(true)} className="group absolute inset-0" aria-label={es ? "Ver la cámara en vivo de la ISS" : "Watch the ISS live camera"}>
            <img src={`https://i.ytimg.com/vi/${s.id}/hqdefault_live.jpg`} alt="" loading="lazy" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-xl text-white backdrop-blur">▶</span>
            </span>
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white"><span className="live-dot" aria-hidden="true" />{es ? "EN VIVO · NASA" : "LIVE · NASA"}</span>
          </button>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-2 p-2.5 text-xs">
        <span className="font-semibold">{es ? "Desde la Estación Espacial" : "From the Space Station"}</span>
        {!compact ? (
          <select value={k} onChange={(e) => { setK(Number(e.target.value)); setOn(false); }} aria-label={es ? "Transmisión" : "Stream"}
            className="ml-auto rounded-lg border border-border bg-surface px-1.5 py-0.5">
            {ISS_STREAMS.map((x, j) => <option key={x.id} value={j}>{x[lang]}</option>)}
          </select>
        ) : null}
        <span className="w-full text-text-3">{es ? "Señal oficial de la NASA. Si la estación pierde contacto se ve una imagen fija o pantalla azul." : "Official NASA feed. When the station loses contact it shows a still or a blue screen."}</span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- GOES sky

interface Sector { key: string; sat: "GOES19" | "GOES18"; es: string; en: string; lat: number; lon: number }
const SECTORS: Sector[] = [
  { key: "mex", sat: "GOES19", es: "México", en: "Mexico", lat: 23, lon: -102 },
  { key: "cam", sat: "GOES19", es: "Centroamérica", en: "Central America", lat: 13, lon: -86 },
  { key: "car", sat: "GOES19", es: "Caribe", en: "Caribbean", lat: 18, lon: -70 },
  { key: "wus", sat: "GOES18", es: "Oeste de EE. UU.", en: "Western US", lat: 40, lon: -116 },
  { key: "ak", sat: "GOES18", es: "Alaska", en: "Alaska", lat: 62, lon: -150 },
];

function nearestSector(p: Where | null): Sector {
  if (!p) return SECTORS[0];
  const d = (s: Sector) => (s.lat - p.lat) ** 2 + ((s.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
  return [...SECTORS].sort((a, b) => d(a) - d(b))[0];
}

const base = (s: Sector) => `https://cdn.star.nesdis.noaa.gov/${s.sat}/ABI/SECTOR/${s.key}/GEOCOLOR/`;

/** File of the 10-minute frame at a UTC time: YYYYDDDHHMM_GOES19-ABI-mex-GEOCOLOR-500x500.jpg */
export function frameName(s: Pick<Sector, "key" | "sat">, t: Date): string {
  const y = t.getUTCFullYear();
  const doy = Math.floor((Date.UTC(y, t.getUTCMonth(), t.getUTCDate()) - Date.UTC(y, 0, 0)) / 864e5);
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${y}${p(doy, 3)}${p(t.getUTCHours(), 2)}${p(t.getUTCMinutes(), 2)}_${s.sat}-ABI-${s.key}-GEOCOLOR-500x500.jpg`;
}

export function SkyCam({ lang, near }: { lang: Lang; near: Where | null }) {
  const es = lang === "es";
  const [s, setS] = useState<Sector>(() => nearestSector(near));
  const [stamp, setStamp] = useState(() => Math.floor(Date.now() / 600e3));
  const [loop, setLoop] = useState(false);
  const [frames, setFrames] = useState<{ src: string; t: Date }[]>([]);
  const [i, setI] = useState(0);
  useEffect(() => { setS(nearestSector(near)); }, [near]);
  // the still refreshes every 10 minutes (only while the page is visible)
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) setStamp(Math.floor(Date.now() / 600e3)); }, 60e3);
    return () => window.clearInterval(id);
  }, []);
  // the loop: the last 2 h, 10-minute frames, newest ~25 min old; frames that do not exist are dropped
  useEffect(() => {
    if (!loop) { setFrames([]); return; }
    let live = true;
    const end = Math.floor((Date.now() - 25 * 60e3) / 600e3) * 600e3;
    const want = Array.from({ length: 12 }, (_, k) => new Date(end - (11 - k) * 600e3));
    Promise.all(want.map((t) => new Promise<{ src: string; t: Date } | null>((ok) => {
      const img = new Image();
      const src = base(s) + frameName(s, t);
      img.onload = () => ok({ src, t });
      img.onerror = () => ok(null);
      img.src = src;
    }))).then((got) => { if (live) { setFrames(got.filter((x): x is { src: string; t: Date } => !!x)); setI(0); } });
    return () => { live = false; };
  }, [loop, s]);
  useEffect(() => {
    if (!loop || frames.length < 2) return;
    const id = window.setInterval(() => setI((k) => (k + 1) % frames.length), 350);
    return () => window.clearInterval(id);
  }, [loop, frames.length]);
  const cur = loop && frames.length ? frames[i] : null;
  const hhmm = (t: Date) => t.toISOString().slice(11, 16) + " UTC";
  return (
    <figure className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="relative aspect-[4/3] bg-black">
        <img src={cur ? cur.src : `${base(s)}500x500.jpg?t=${stamp}`} alt={es ? `El cielo sobre ${s.es} visto por ${s.sat}` : `The sky over ${s.en} seen by ${s.sat}`}
          className="h-full w-full object-cover" />
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
          {cur ? hhmm(cur.t) : <><span className="live-dot" aria-hidden="true" />{es ? "CADA 10 MIN" : "EVERY 10 MIN"}</>}
        </span>
        {loop && !frames.length ? <span className="absolute inset-x-0 bottom-2 text-center text-xs text-white/80">{es ? "Cargando 2 horas…" : "Loading 2 hours…"}</span> : null}
      </div>
      <figcaption className="space-y-1.5 p-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{es ? "El cielo sobre" : "The sky over"}</span>
          <select value={s.key} onChange={(e) => { setS(SECTORS.find((x) => x.key === e.target.value)!); setLoop(false); }}
            className="rounded-lg border border-border bg-surface px-1.5 py-0.5" aria-label={es ? "Región" : "Region"}>
            {SECTORS.map((x) => <option key={x.key} value={x.key}>{x[lang]}</option>)}
          </select>
          <button type="button" onClick={() => setLoop((v) => !v)} aria-pressed={loop}
            className={`ml-auto rounded-full px-2.5 py-0.5 font-semibold ${loop ? "bg-accent text-on-accent" : "border border-border"}`}>
            {loop ? (es ? "Ver ahora" : "Now") : (es ? "▶ Últimas 2 h" : "▶ Last 2 h")}
          </button>
        </div>
        <p className="text-text-3">{es ? `${s.sat} (NASA/NOAA), color real de día e infrarrojo de noche (GeoColor de NOAA STAR).` : `${s.sat} (NASA/NOAA), true colour by day and infrared at night (NOAA STAR GeoColor).`}</p>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------- joint change (HORI)

interface JointRule { rule: string; name: Record<Lang, string>; a: string; b: string; counts: Record<string, number>; ratio: number; min_q_joint: number; note?: Record<Lang, string> }
interface JointManifest {
  id: string; title: Record<Lang, string>; window: { start: number; end: number };
  grid: { nlat: number; nlon: number; lat0: number; dlat: number; lon0: number; dlon: number };
  rules: JointRule[]; arrays: Record<string, { file: string }>; honesty?: { note?: Record<Lang, string> };
}
interface IndexEntry { id: string; kind?: string; path: string; title: Record<Lang, string> }

/** Pick the rule a question names («nieve», «vegetación», «aerosoles»), else the strongest finding. */
export function JointMap({ lang, hint, onLook }: { lang: Lang; hint: string | null; onLook: (lat: number, lon: number) => void }) {
  const es = lang === "es";
  const [all, setAll] = useState<{ path: string; m: JointManifest }[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [lv, setLv] = useState<Uint8Array | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`${BUNDLES}index.json`).then((r) => r.json() as Promise<IndexEntry[]>).then(async (idx) => {
      const js = idx.filter((e) => e.kind === "joint");
      const ms = await Promise.all(js.map(async (e) => ({ path: e.path, m: (await (await fetch(`${BUNDLES}${e.path}/manifest.json`)).json()) as JointManifest })));
      if (live) setAll(ms);
    }).catch(() => live && setAll([]));
    return () => { live = false; };
  }, []);

  const rules = useMemo(() => (all ?? []).flatMap((x) => x.m.rules.map((r) => ({ ...x, r }))), [all]);
  const chosen = useMemo(() => {
    if (!rules.length) return null;
    if (pick) return rules.find((x) => x.r.rule === pick) ?? rules[0];
    const h = hint ?? "";
    const by = (re: RegExp) => rules.find((x) => re.test(`${x.r.a} ${x.r.b} ${x.r.name.es} ${x.r.name.en}`.toLowerCase()));
    return (/niev|snow/.test(h) && by(/snow|niev/)) || (/vegeta|verde|ndvi|green/.test(h) && by(/ndvi|verde/)) || (/aerosol|humo|polvo|smoke|dust/.test(h) && by(/aod|aerosol/))
      || (/lluvia|seco|rain|dry/.test(h) && by(/prectot|lluvia/))
      || [...rules].sort((a, b) => (b.r.counts.CONJUNTO_PROBADO ?? 0) - (a.r.counts.CONJUNTO_PROBADO ?? 0))[0];
  }, [rules, pick, hint]);

  useEffect(() => {
    if (!chosen) return;
    let live = true;
    const file = chosen.m.arrays[`level_${chosen.r.rule}`]?.file;
    if (!file) return;
    fetch(`${BUNDLES}${chosen.path}/${file}`).then((r) => r.arrayBuffer()).then((b) => live && setLv(new Uint8Array(b))).catch(() => live && setLv(null));
    return () => { live = false; };
  }, [chosen]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !lv || !chosen) return;
    const { nlat, nlon } = chosen.m.grid;
    c.width = nlon; c.height = nlat;
    const g = c.getContext("2d")!;
    const img = g.createImageData(nlon, nlat);
    const land = landMask();
    const col: Record<number, [number, number, number, number]> = { 4: [255, 107, 44, 255], 3: [255, 183, 120, 255], 2: [120, 150, 190, 200] };
    for (let r = 0; r < nlat; r++) for (let q = 0; q < nlon; q++) {
      const k = r * nlon + q, p = k * 4, v = lv[k];
      const isLand = land.data[Math.floor((r / nlat) * land.h) * land.w + Math.floor((q / nlon) * land.w)];
      const c4 = col[v] ?? (isLand ? [58, 66, 80, 255] : [18, 24, 36, 255]);
      img.data[p] = c4[0]; img.data[p + 1] = c4[1]; img.data[p + 2] = c4[2]; img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, [lv, chosen]);

  if (all && !rules.length) return <p className="text-sm text-text-2">{es ? "No hay resultados de cambio conjunto en esta copia." : "No joint-change results in this copy."}</p>;
  if (!chosen) return <p className="animate-pulse py-4 text-sm text-text-3">{es ? "Cargando el resultado de HORI…" : "Loading HORI's result…"}</p>;
  const n = chosen.r.counts;
  // the most convincing place: the level-4 cell nearest the strongest cluster is enough for «ver en el globo»
  const example = (() => {
    if (!lv) return null;
    const { nlon, lat0, dlat, lon0, dlon } = chosen.m.grid;
    for (let k = 0; k < lv.length; k++) if (lv[k] === 4) return { lat: lat0 + Math.floor(k / nlon) * dlat, lon: lon0 + (k % nlon) * dlon };
    return null;
  })();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {rules.map((x) => (
          <button key={x.r.rule} type="button" onClick={() => setPick(x.r.rule)} aria-pressed={x.r.rule === chosen.r.rule}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${x.r.rule === chosen.r.rule ? "bg-accent text-on-accent" : "border border-border text-text-2"}`}>{x.r.name[lang]}</button>
        ))}
      </div>
      <canvas ref={canvas} className="aspect-[2/1] w-full rounded-xl [image-rendering:pixelated]" aria-label={chosen.r.name[lang]} />
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-surface-2 p-2"><p className="tabular text-lg font-semibold">{(n.CONJUNTO_PROBADO ?? 0).toLocaleString(lang)}</p><p className="text-[11px] text-text-2">{es ? "zonas: las dos juntas, probado" : "areas: both together, proven"}</p></div>
        <div className="rounded-xl bg-surface-2 p-2"><p className="tabular text-lg font-semibold">{(n.AMBAS_PROBADO ?? 0).toLocaleString(lang)}</p><p className="text-[11px] text-text-2">{es ? "cada una probada por separado" : "each proven on its own"}</p></div>
        <div className="rounded-xl bg-surface-2 p-2"><p className="tabular text-lg font-semibold">{chosen.r.ratio.toLocaleString(lang, { maximumFractionDigits: 2 })}×</p><p className="text-[11px] text-text-2">{es ? "vs. lo esperado por azar" : "vs. expected by chance"}</p></div>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-2">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#ff6b2c] align-middle" />{es ? "juntas, probado (q ≤ 0,10)" : "together, proven (q ≤ 0.10)"}</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#ffb778] align-middle" />{es ? "cada una por separado" : "each on its own"}</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#7896be] align-middle" />{es ? "candidato" : "candidate"}</span>
        {example ? <button type="button" onClick={() => onLook(example.lat, example.lon)} className="ml-auto font-semibold underline underline-offset-2">{es ? "Ver una zona en el globo" : "See an area on the globe"}</button> : null}
      </p>
      <p className="text-xs text-text-3">
        {es ? `${chosen.m.window.start}–${chosen.m.window.end}. Regla escrita antes de ver los datos; prueba unilateral intersección-unión y FDR (Benjamini-Hochberg) por regla. q mínima ${chosen.r.min_q_joint.toLocaleString(lang, { maximumFractionDigits: 3 })}. ` : `${chosen.m.window.start}–${chosen.m.window.end}. Rule written before seeing the data; one-sided intersection-union test and FDR (Benjamini-Hochberg) per rule. Minimum q ${chosen.r.min_q_joint.toLocaleString(lang, { maximumFractionDigits: 3 })}. `}
        {chosen.m.honesty?.note?.[lang] ?? (es ? "Que dos cambios ocurran en el mismo lugar no prueba que uno cause el otro." : "Two changes at the same place do not prove one causes the other.")}
      </p>
    </div>
  );
}
