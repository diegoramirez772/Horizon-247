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
import { type Aurora, type KpReading, type SpaceDoc, cadDate, fetchAurora, fetchKp, loadSpace } from "@/core/live/space";
import { zoneFromFireball } from "@/core/terrain/events";
import type { ZoneTarget } from "@/core/state/store";

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
        {es ? `${chosen.m.window.start}–${chosen.m.window.end}. Regla escrita antes de ver los datos; test unilateral de intersección-unión y FDR (Benjamini-Hochberg) por regla. q mínima ${chosen.r.min_q_joint.toLocaleString(lang, { maximumFractionDigits: 3 })}. ` : `${chosen.m.window.start}–${chosen.m.window.end}. Rule written before seeing the data; one-sided intersection-union test and FDR (Benjamini-Hochberg) per rule. Minimum q ${chosen.r.min_q_joint.toLocaleString(lang, { maximumFractionDigits: 3 })}. `}
        {es ? "Que dos cambios ocurran en el mismo lugar no dice que uno provoque el otro." : "Two changes at the same place do not say that one drives the other."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- near space (JPL + NOAA)

const G_NAME = {
  es: ["sin tormenta geomagnética", "tormenta menor (G1)", "tormenta moderada (G2)", "tormenta fuerte (G3)", "tormenta severa (G4)", "tormenta extrema (G5)"],
  en: ["no geomagnetic storm", "minor storm (G1)", "moderate storm (G2)", "strong storm (G3)", "severe storm (G4)", "extreme storm (G5)"],
};

/**
 * «Espacio cercano»: what near space is doing to and around the Earth — geomagnetic activity (Kp, NOAA's G scale and
 * HORI's anomaly detector), where the aurora can be seen, the closest asteroid approaches, Sentry's impact monitoring
 * (said honestly) and the latest fireball (with its burst in «Vista 3D real»).
 */
export function SpaceCard({ lang, onZone, onLook }: { lang: Lang; onZone?: (z: ZoneTarget) => void; onLook?: (lat: number, lon: number) => void }) {
  const es = lang === "es";
  const [doc, setDoc] = useState<SpaceDoc | null>(null);
  const [kp, setKp] = useState<KpReading | null>(null);
  const [aur, setAur] = useState<Aurora | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    loadSpace().then((d) => live && setDoc(d)).catch(() => live && setErr(true));
    fetchKp().then((k) => live && setKp(k)).catch(() => {});
    fetchAurora().then((a) => live && setAur(a)).catch(() => {});
    return () => { live = false; };
  }, []);
  const lowest = (north: boolean) => { const c = (aur?.cells ?? []).filter(([, la]) => (north ? la > 0 : la < 0)); return c.length ? Math.min(...c.map(([, la]) => Math.abs(la))) : null; };
  const n = lowest(true), sLat = lowest(false);
  const last = doc?.fireballs[0] ?? null;
  const km = (x: number) => x.toLocaleString(lang, { maximumFractionDigits: 0 });
  const recent = kp ? kp.values.slice(-24) : [];
  return (
    <figure className="space-y-3 rounded-2xl border border-border bg-surface p-3 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-3">{es ? "Actividad geomagnética" : "Geomagnetic activity"}</p>
        {kp ? (
          <>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="tabular text-2xl font-semibold">Kp {kp.now.toLocaleString(lang, { maximumFractionDigits: 1 })}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${kp.g ? "bg-accent text-on-accent" : "bg-surface-2 text-text-2"}`}>{G_NAME[lang][kp.g]}</span>
              <span className="ml-auto text-[11px] text-text-3">{kp.at} UTC</span>
            </div>
            <div className="mt-1.5 flex h-8 items-end gap-[2px]" aria-hidden="true">
              {recent.map((v, i) => <span key={i} className={`flex-1 rounded-sm ${v >= 5 ? "bg-[#d92d20]" : v >= 4 ? "bg-[#f5a524]" : "bg-text-3/40"}`} style={{ height: `${Math.max(6, (v / 9) * 100)}%` }} />)}
            </div>
            <p className="mt-1 text-xs text-text-2">
              {kp.hori === null ? (es ? "HORI: muy pocos días para juzgar." : "HORI: too few days to judge.")
                : kp.hori.unusual ? (es ? `HORI: actividad fuera de lo común desde ${kp.hori.since} UTC${kp.hori.z ? ` (z ${kp.hori.z.toFixed(1)})` : ""}.` : `HORI: unusual activity since ${kp.hori.since} UTC${kp.hori.z ? ` (z ${kp.hori.z.toFixed(1)})` : ""}.`)
                : (es ? "HORI: sin desviaciones frente a los días anteriores." : "HORI: no departures from the previous days.")}
              {" "}{es ? "Últimos 3 días, cada 3 h. Escala G de NOAA." : "Last 3 days, every 3 h. NOAA G scale."}
            </p>
          </>
        ) : <p className="animate-pulse text-xs text-text-3">{es ? "Consultando a NOAA…" : "Asking NOAA…"}</p>}
        {aur ? (
          <p className="mt-1 text-xs text-text-2">
            {es ? "Auroras (≥ 10 % de probabilidad): " : "Aurora (≥ 10 % chance): "}
            {n !== null ? (es ? `hasta ${n}° N` : `down to ${n}° N`) : (es ? "ninguna al norte" : "none in the north")} · {sLat !== null ? (es ? `hasta ${sLat}° S` : `down to ${sLat}° S`) : (es ? "ninguna al sur" : "none in the south")}
            {" "}<span className="text-text-3">({es ? "en el globo, capa Espacio" : "on the globe, Space layer"})</span>
          </p>
        ) : null}
      </div>

      {doc ? (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-3">{es ? "Asteroides que pasan cerca" : "Close asteroid approaches"}</p>
            <p className="mt-1 text-xs text-text-2">{es ? `${doc.approaches.length} pasarán a menos de 0.05 UA (~19 distancias lunares) en los próximos 60 días.` : `${doc.approaches.length} will pass within 0.05 au (~19 lunar distances) in the next 60 days.`}</p>
            <ul className="mt-1 space-y-1">
              {doc.approaches.slice(0, 3).map((a) => (
                <li key={a.des} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-medium">{a.name}</span>
                  <span className="text-text-2">{cadDate(a.date, lang)}</span>
                  <span className="tabular">{a.dist_ld.toLocaleString(lang)} {es ? "dist. lunares" : "lunar dist."} ({km(a.dist_km)} km)</span>
                  <span className="text-text-3">{a.v_kms} km/s{a.diameter_m ? ` · ${a.diameter_m[0]}–${a.diameter_m[1]} m` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-3">{es ? "Vigilancia de impacto (Sentry)" : "Impact monitoring (Sentry)"}</p>
            <p className="mt-1 text-xs text-text-2">
              {es
                ? `${km(doc.sentry.count)} objetos vigilados. Escala de Torino máxima: ${doc.sentry.max_torino}. El de mayor valor en la escala de Palermo es ${doc.sentry.top[0]?.name ?? "—"} (${doc.sentry.top[0]?.range ?? "—"}), con ${doc.sentry.top[0]?.ps_cum ?? "—"}: un valor negativo está por debajo del nivel de fondo de todos los objetos aún no descubiertos.`
                : `${km(doc.sentry.count)} objects monitored. Maximum Torino scale: ${doc.sentry.max_torino}. The highest Palermo value is ${doc.sentry.top[0]?.name ?? "—"} (${doc.sentry.top[0]?.range ?? "—"}), at ${doc.sentry.top[0]?.ps_cum ?? "—"}: a negative value is below the background level of all objects not yet discovered.`}
            </p>
          </div>
          {last ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-text-3">{es ? "Último bólido registrado" : "Latest recorded fireball"}</p>
              <p className="mt-1 text-xs text-text-2">
                {last.date.slice(0, 16)} UTC · {last.lat.toFixed(1)}°, {last.lon.toFixed(1)}°
                {last.alt_km !== null ? ` · ${Math.round(last.alt_km)} km ${es ? "de altura" : "high"}` : ""}{last.v_kms !== null ? ` · ${last.v_kms} km/s` : ""}{last.energy_kt !== null ? ` · ${last.energy_kt} kt` : ""}
              </p>
              <div className="mt-1.5 flex gap-2">
                {onZone ? <button type="button" onClick={() => onZone(zoneFromFireball(last, lang))} className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-on-accent">{es ? "Verlo en 3D real" : "See it in real 3D"}</button> : null}
                {onLook ? <button type="button" onClick={() => onLook(last.lat, last.lon)} className="rounded-full border border-border px-3 py-1 text-xs font-semibold">{es ? "En el globo" : "On the globe"}</button> : null}
              </div>
            </div>
          ) : null}
        </>
      ) : err ? <p className="text-xs text-text-2">{es ? "No pude leer los datos de JPL." : "Could not read the JPL data."}</p> : <p className="animate-pulse text-xs text-text-3">…</p>}
      <figcaption className="text-[11px] text-text-3">
        {es ? `NASA/JPL CNEOS (acercamientos, Sentry, bólidos; datos del ${doc?.built.slice(0, 10) ?? "—"}) · NOAA SWPC (Kp y auroras, en vivo).` : `NASA/JPL CNEOS (approaches, Sentry, fireballs; data of ${doc?.built.slice(0, 10) ?? "—"}) · NOAA SWPC (Kp and aurora, live).`}
      </figcaption>
    </figure>
  );
}
