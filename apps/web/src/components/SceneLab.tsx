"use client";

// Scene generator screen: pick a situation (ranch, drought, heat, storm, flood, fire, snow, night, Mars, Moon),
// move the readings, and the diorama rebuilds itself. Every element says which reading made it; every reading says
// whether it is an example, simulated or observed. Generated ≠ observed (SANTUARIO H5).

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { registerView } from "@/core/interaction/manipulate";
import { sceneCommand } from "@/core/scene/voice";
import { InteractionRoot } from "./interaccion/InteractionRoot";
import { useHub } from "./interaccion/context";
import { compose, type Scene } from "@/core/scene/compose";
import { PRESETS, preset } from "@/core/scene/presets";
import { SceneView, type SceneStats } from "@/core/scene/SceneView";
import { type SceneSpec, type VarKey, VAR_INFO } from "@/core/scene/spec";
import { detectTier } from "@/core/map/tier";
import { loadHome } from "@/core/contract/loader";
import { fetchPowerPoint, type PowerDay } from "@/core/live/power";
import { baseFor, specForDay, specForYear, type Place } from "@/core/scene/fromData";

const EARTH_VARS: VarKey[] = ["hour", "temp_c", "rh_pct", "ndvi", "cloud_frac", "precip_mm_h", "wind_ms", "spi", "soil_moisture", "fire_frp_mw", "burned_frac", "flood_frac", "snow_frac", "aod"];
const MARS_VARS: VarKey[] = ["hour", "temp_c", "wind_ms", "dust_tau"];
const MOON_VARS: VarKey[] = ["hour"];

const KIND_LABEL = { observacion: "observación", estimacion: "estimación", simulada: "simulado", ejemplo: "ejemplo" } as const;
const LEVEL_STYLE = {
  info: "border-border",
  atencion: "border-[#d9a400]",
  alto: "border-[#e0662a]",
  emergencia: "border-[#c62828]",
} as const;

interface Params { embed: boolean; place: Place | null; years: boolean; serie: number[] | null; y0: number; /** What HORI holds for the focus this scene illustrates. */ foco?: string; /** Timeline speed ×0.5 / ×1 / ×2. */ vel?: number }

/** «?lat=&lon=&name=» opens the scene of a real place; «t=anos» starts the yearly timeline; «serie» = HORI anomalies. */
function readParams(): Params {
  try {
    const q = new URLSearchParams(location.search);
    const lat = Number(q.get("lat")), lon = Number(q.get("lon"));
    const place = q.has("lat") && Number.isFinite(lat) && Number.isFinite(lon) ? { name: q.get("name") || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, lat, lon } : null;
    const serie = q.get("serie")?.split(",").map((x) => (x === "" ? NaN : Number(x))) ?? null;
    return { embed: q.get("embed") === "1", place, years: q.get("t") === "anos", serie: serie && serie.some(Number.isFinite) ? serie : null, y0: Number(q.get("y0")) || 1981, foco: q.get("foco")?.slice(0, 320) || undefined, vel: [0.5, 1, 2].includes(Number(q.get("vel"))) ? Number(q.get("vel")) : 1 };
  } catch { return { embed: false, place: null, years: false, serie: null, y0: 1981 }; }
}

function initialId(): string {
  try { return new URLSearchParams(location.search).get("escena") ?? "rancho"; } catch { return "rancho"; }
}

/** The scene generator, controllable by voice, hand, gamepad and keys (doc «Interacción v2» §2.6). */
export function SceneLab() {
  return (
    <InteractionRoot lang="es">
      <SceneLabView />
    </InteractionRoot>
  );
}

function SceneLabView() {
  const hub = useHub();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
  const [id, setId] = useState("rancho");
  const [spec, setSpec] = useState<SceneSpec>(() => preset("rancho"));
  const [scene, setScene] = useState<Scene | null>(null);
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [noGL, setNoGL] = useState(false);
  const [panel, setPanel] = useState<"datos" | "escena">("datos");
  // Read after mounting: the server has no GPU to ask, so the first render must match it («?») and then update.
  const [tier, setTier] = useState<ReturnType<typeof detectTier> | null>(null);
  useEffect(() => { setTier(detectTier()); }, []);

  // A real place: NASA POWER of the last weeks + HORI's yearly series → the timeline.
  const [params, setParams] = useState<Params>({ embed: false, place: null, years: false, serie: null, y0: 1981 });
  const [days, setDays] = useState<PowerDay[]>([]);
  const [serie, setSerie] = useState<{ values: number[]; y0: number } | null>(null);
  const [mode, setMode] = useState<"dias" | "anos">("dias");
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [vel, setVel] = useState(1);
  const [showData, setShowData] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const p = readParams();
    setParams(p);
    setVel(p.vel ?? 1);
    if (p.embed) setShowData(false);
    if (!p.place) { const first = initialId(); setId(first); setSpec(preset(first)); return; }
    const place = p.place;
    setId("");
    setSpec(baseFor(place));
    setStatus("Leyendo NASA POWER…");
    fetchPowerPoint(place.lat, place.lon, 30).then((pt) => {
      setDays(pt.days);
      setStatus("");
      if (pt.days.length) { setStep(pt.days.length - 1); setSpec(specForDay(place, pt.days[pt.days.length - 1])); }
    }).catch(() => setStatus("No se pudo leer NASA POWER: valores de ejemplo."));
    if (p.serie) { setSerie({ values: p.serie, y0: p.y0 }); if (p.years) setMode("anos"); }
    else {
      // Without a series from the map, the place's own monitor in «Mis monitores» (home.json), if it is one.
      loadHome("../bundles/").then((h) => {
        const near = h?.entities.find((e) => normalizeName(e.entity.name.es) === normalizeName(place.name))
          ?? (Math.abs(place.lat - 24.02) < 2.5 && Math.abs(place.lon + 104.67) < 2.5 ? h?.entities.find((e) => /durango/i.test(e.entity.name.es)) : undefined);
        const mon = near?.monitors.find((m) => m.variable.name === "T2M");
        if (mon) {
          setSerie({ values: mon.series.values.map((v) => (v === null ? NaN : v)), y0: mon.series.years[0] });
          if (p.years) setMode("anos");
        }
      }).catch(() => {});
    }
  }, []);

  // The timeline: each step rebuilds the scene from that day's or that year's data.
  const years = serie ? serie.values.map((_, i) => serie.y0 + i) : [];
  const steps = mode === "anos" ? years.length : days.length;
  useEffect(() => {
    const place = params.place;
    if (!place || step < 0) return;
    if (mode === "anos" && serie && years[step] !== undefined) setSpec(specForYear(place, days, serie.values, serie.y0, years[step]));
    else if (mode === "dias" && days[step]) setSpec(specForDay(place, days[step]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mode, serie, days, params.place]);
  useEffect(() => { setStep(steps - 1); setPlaying(params.years && mode === "anos" && steps > 1); }, [mode, steps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing || steps < 2) return;
    // one year every 1.1 s (×1), one day every 0.9 s: slow enough to read what changed
    const t = window.setInterval(() => setStep((i) => { if (i >= steps - 1) { setPlaying(false); return i; } return i + 1; }), (mode === "anos" ? 1100 : 900) / vel);
    return () => window.clearInterval(t);
  }, [playing, steps, mode, vel]);
  const play = () => { if (step >= steps - 1) setStep(0); setPlaying((x) => !x); };

  useEffect(() => {
    if (!host.current) return;
    let unregister = () => {};
    try {
      const v = new SceneView(host.current, "Escena generada a partir de los datos");
      v.onStats = setStats;
      view.current = v;
      unregister = registerView(v, { es: "escena", en: "scene" });
    } catch {
      setNoGL(true);
    }
    return () => { unregister(); view.current?.destroy(); view.current = null; };
  }, []);

  // Rebuild after the readings stop moving for a moment (composing takes ~50–300 ms on a 2-core laptop).
  useEffect(() => {
    const t = setTimeout(() => {
      const s = compose(spec);
      setScene(s);
      view.current?.setScene(s);
    }, 120);
    return () => clearTimeout(t);
  }, [spec]);

  const choose = (pid: string) => {
    setId(pid);
    setSpec(preset(pid));
    try { const u = new URL(location.href); u.searchParams.set("escena", pid); history.replaceState(null, "", u); } catch { /* ignore */ }
  };

  const setVar = (k: VarKey, value: number) => {
    setSpec((s) => ({ ...s, vars: { ...s.vars, [k]: { value, unit: VAR_INFO[k].unit, source: "ajustado a mano", kind: "simulada" } } }));
  };

  // Every object of the diorama by voice: what drives it, its readings, the cattle / people / devices themselves.
  const [focusEl, setFocusEl] = useState<string | null>(null);
  const live = useRef({ spec, scene, choose });
  const timelineRef = useRef(() => {});
  useEffect(() => { timelineRef.current = () => { if (serie) setMode("anos"); setStep(0); setPlaying(true); }; });
  useEffect(() => { live.current = { spec, scene, choose }; });
  useEffect(() => hub.registerDomain({
    id: "escena",
    title: { es: "Escena generada", en: "Generated scene" },
    examples: {
      es: [["Más lluvia"], ["Temperatura a 38"], ["Apaga el fuego"], ["De noche"], ["Agrega 5 vacas"], ["Quita el dron"], ["¿Qué mueve el pasto?"], ["Muestra la sequía"], ["Viento al máximo"], ["Nubes al 80"]],
      en: [["More rain"], ["Temperature to 38"], ["Turn off the fire"], ["At night"], ["Add 5 cows"], ["Remove the drone"], ["What drives the grass?"], ["Show the drought"]],
    },
    handle: (t) => {
      if (/linea de(l)? tiempo|timeline|reproduce|play|anos|years/.test(t)) {
        timelineRef.current();
        return { es: "Recorro la línea de tiempo.", en: "Playing the timeline." };
      }
      const { spec: sp, scene: sc, choose: ch } = live.current;
      const r = sceneCommand(t, sp, sc?.elements ?? [], PRESETS.map((p) => ({ id: p.id, label: p.label })));
      if (!r) return null;
      if (r.presetId) ch(r.presetId);
      if (r.spec) setSpec(r.spec);
      if (r.focus) { setFocusEl(r.focus); setPanel(r.spec ? "datos" : "escena"); }
      return r.say;
    },
  }), [hub]);
  // the focused object's row is scrolled into view and outlined
  useEffect(() => {
    if (!focusEl) return;
    document.getElementById(`el-${focusEl}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const id = window.setTimeout(() => setFocusEl(null), 6000);
    return () => clearTimeout(id);
  }, [focusEl, panel]);
  const driving = useMemo(() => new Set(scene?.elements.find((e) => e.id === focusEl)?.drivenBy ?? []), [scene, focusEl]);

  const keys = spec.body === "earth" ? EARTH_VARS : spec.body === "mars" ? MARS_VARS : MOON_VARS;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg text-text">
      <div ref={host} className="absolute inset-0" />
      {noGL ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-md text-text-2">Este equipo no tiene gráfica disponible para la escena 3D. El mapa y las cifras siguen funcionando.</p>
        </div>
      ) : null}

      {/* title */}
      <header className="glass absolute left-4 right-4 top-4 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-3 md:right-auto md:max-w-[560px]">
        {params.embed ? null : <Link href="/" className="text-sm text-text-2 underline-offset-2 hover:underline">← Asistente</Link>}
        <h1 className="text-base font-semibold leading-tight">{spec.title}</h1>
        <span className="text-sm text-text-3">{spec.place}</span>
        <p className="w-full text-xs text-text-2">
          <span className="mr-2 rounded bg-sim px-1.5 py-0.5 font-semibold text-on-sim">Escena generada</span>
          Ilustra los datos; no es una foto. {spec.note ?? ""} {status}
        </p>
        {params.foco ? <p className="w-full rounded-lg bg-surface-2 px-2 py-1 text-xs font-medium text-text">{params.foco}</p> : null}
      </header>

      {/* situations */}
      {params.place ? null : <nav aria-label="Situaciones" className="absolute left-4 right-4 top-[124px] z-10 flex gap-2 overflow-x-auto pb-1 md:right-auto md:max-w-[560px] md:flex-wrap md:overflow-visible">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => choose(p.id)} aria-pressed={p.id === id}
            className={`glass shrink-0 rounded-full px-3 py-1.5 text-sm ${p.id === id ? "outline outline-2 outline-focus" : "text-text-2"}`}>
            {p.label}
          </button>
        ))}
      </nav>}

      {/* timeline: the scene changes with each day (POWER) or each year (HORI) */}
      {params.place && steps > 0 ? (
        <div className="glass absolute bottom-4 left-4 z-20 flex w-[min(560px,calc(100%-2rem))] flex-col gap-2 rounded-2xl px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs">
            <div role="radiogroup" aria-label="Línea de tiempo" className="flex rounded-full bg-surface-2 p-0.5">
              <button type="button" role="radio" aria-checked={mode === "dias"} onClick={() => setMode("dias")} disabled={!days.length}
                className={`rounded-full px-2.5 py-1 font-medium ${mode === "dias" ? "bg-surface shadow-sm" : "text-text-2"}`}>Días · NASA POWER</button>
              {serie ? (
                <button type="button" role="radio" aria-checked={mode === "anos"} onClick={() => setMode("anos")}
                  className={`rounded-full px-2.5 py-1 font-medium ${mode === "anos" ? "bg-surface shadow-sm" : "text-text-2"}`}>Años · HORI</button>
              ) : null}
            </div>
            <span className="ml-auto tabular-nums font-semibold text-text">{mode === "anos" ? years[step] ?? "" : days[step]?.date ?? ""}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={play} aria-label={playing ? "Pausar" : "Reproducir"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
              {playing ? "❚❚" : "▶"}
            </button>
            <div role="group" aria-label="Velocidad" className="flex shrink-0 rounded-full bg-surface-2 p-0.5 text-xs">
              {[0.5, 1, 2].map((v) => (
                <button key={v} type="button" aria-pressed={vel === v} onClick={() => setVel(v)} aria-label={`Velocidad ×${v === 0.5 ? "0,5" : v}`}
                  className={`rounded-full px-2 py-1 font-medium ${vel === v ? "bg-surface shadow-sm" : "text-text-2"}`}>×{v === 0.5 ? "0,5" : v}</button>
              ))}
            </div>
            <input type="range" min={0} max={Math.max(0, steps - 1)} step={1} value={Math.max(0, step)} aria-label="Momento"
              onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }} className="w-full" />
          </div>
        </div>
      ) : null}

      {params.embed ? (
        <button type="button" onClick={() => setShowData((x) => !x)} aria-expanded={showData}
          className="glass absolute right-4 top-4 z-20 rounded-full px-3 py-1.5 text-sm font-medium">
          {showData ? "Ocultar datos" : "Datos y por qué"}
        </button>
      ) : null}

      {/* readings and legend */}
      {showData ? <aside className={`glass absolute right-4 z-10 flex ${params.embed ? "top-16" : "bottom-4"} max-h-[min(70vh,620px)] w-[min(360px,calc(100%-2rem))] flex-col overflow-hidden rounded-2xl`}>
        <div className="flex border-b border-border text-sm" role="tablist">
          {(["datos", "escena"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={panel === t} type="button" onClick={() => setPanel(t)}
              className={`flex-1 px-3 py-2 ${panel === t ? "font-semibold" : "text-text-2"}`}>
              {t === "datos" ? "Datos" : "Qué se ve y por qué"}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto p-3">
          {scene?.alerts.length ? (
            <ul className="mb-3 space-y-2">
              {scene.alerts.map((a, i) => (
                <li key={i} className={`rounded-lg border-l-4 bg-surface px-3 py-2 text-sm ${LEVEL_STYLE[a.level]}`}>{a.text}</li>
              ))}
            </ul>
          ) : null}
          {panel === "datos" ? (
            <ul className="space-y-3">
              {keys.map((k) => {
                const info = VAR_INFO[k];
                const r = spec.vars[k];
                const value = r?.value ?? (info.min + info.max) / 2;
                return (
                  <li key={k} className={driving.has(k) ? "-mx-1.5 rounded-lg px-1.5 outline outline-2 outline-focus" : undefined}>
                    <label className="flex items-baseline justify-between gap-2 text-sm">
                      <span>{info.label}</span>
                      <span className="tabular-nums text-text-2">
                        {k === "cloud_frac" || k.endsWith("_frac") ? `${Math.round(value * 100)} %` : `${value}${info.unit ? " " + info.unit : ""}`}
                      </span>
                    </label>
                    <input type="range" className="w-full" min={info.min} max={info.max} step={info.step} value={value}
                      aria-label={info.label} onChange={(e) => setVar(k, Number(e.target.value))} />
                    <p className="text-xs text-text-3">{r ? `${KIND_LABEL[r.kind]} · ${r.source}${r.date ? ` · ${r.date}` : ""}` : "sin dato: valor típico del lugar"}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="space-y-2 text-sm">
              {scene?.elements.map((e) => (
                <li key={e.id} id={`el-${e.id}`} className={e.id === focusEl ? "-mx-1.5 rounded-lg px-1.5 outline outline-2 outline-focus" : undefined}>
                  <p className="font-semibold">{e.label} <span className="font-normal text-text-3">· {e.count}</span></p>
                  <p className="text-text-2">{e.rule}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside> : null}

      {/* play / pause and cost */}
      {params.place ? null : <footer className="glass absolute bottom-4 left-4 z-10 flex items-center gap-3 rounded-xl px-3 py-2 text-xs text-text-2">
        <button type="button" className="rounded-lg border border-border-control px-2 py-1 text-sm text-text"
          onClick={() => view.current?.setPlaying(!view.current.isPlaying())}>
          {stats?.playing === false ? "▶ Mover" : "❚❚ Quieto"}
        </button>
        <span>
          Calidad N{tier?.tier ?? "?"} · {stats?.resting ? "en reposo" : stats?.fps ? `${stats.fps} cps` : "—"} · {(scene?.vertices ?? 0).toLocaleString("es-MX")} vértices
        </span>
      </footer>}
    </div>
  );
}

function normalizeName(x: string): string {
  return x.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
