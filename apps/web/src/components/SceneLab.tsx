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
  const tier = useMemo(() => (typeof window === "undefined" ? null : detectTier()), []);

  useEffect(() => { const first = initialId(); setId(first); setSpec(preset(first)); }, []);

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
  useEffect(() => { live.current = { spec, scene, choose }; });
  useEffect(() => hub.registerDomain({
    id: "escena",
    title: { es: "Escena generada", en: "Generated scene" },
    examples: {
      es: [["Más lluvia"], ["Temperatura a 38"], ["Apaga el fuego"], ["De noche"], ["Agrega 5 vacas"], ["Quita el dron"], ["¿Qué mueve el pasto?"], ["Muestra la sequía"], ["Viento al máximo"], ["Nubes al 80"]],
      en: [["More rain"], ["Temperature to 38"], ["Turn off the fire"], ["At night"], ["Add 5 cows"], ["Remove the drone"], ["What drives the grass?"], ["Show the drought"]],
    },
    handle: (t) => {
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

  const keys = spec.body === "mars" ? MARS_VARS : spec.body === "moon" ? MOON_VARS : EARTH_VARS;

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
        <Link href="/" className="text-sm text-text-2 underline-offset-2 hover:underline">← Mapa</Link>
        <h1 className="text-base font-semibold leading-tight">{spec.title}</h1>
        <span className="text-sm text-text-3">{spec.place}</span>
        <p className="w-full text-xs text-text-2">
          <span className="mr-2 rounded bg-sim px-1.5 py-0.5 font-semibold text-on-sim">Escena generada</span>
          Ilustra los datos; no es una foto. {spec.note ?? ""}
        </p>
      </header>

      {/* situations */}
      <nav aria-label="Situaciones" className="absolute left-4 right-4 top-[124px] z-10 flex gap-2 overflow-x-auto pb-1 md:right-auto md:max-w-[560px] md:flex-wrap md:overflow-visible">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => choose(p.id)} aria-pressed={p.id === id}
            className={`glass shrink-0 rounded-full px-3 py-1.5 text-sm ${p.id === id ? "outline outline-2 outline-focus" : "text-text-2"}`}>
            {p.label}
          </button>
        ))}
      </nav>

      {/* readings and legend */}
      <aside className="glass absolute bottom-4 right-4 z-10 flex max-h-[min(70vh,620px)] w-[min(360px,calc(100%-2rem))] flex-col overflow-hidden rounded-2xl">
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
      </aside>

      {/* play / pause and cost */}
      <footer className="glass absolute bottom-4 left-4 z-10 flex items-center gap-3 rounded-xl px-3 py-2 text-xs text-text-2">
        <button type="button" className="rounded-lg border border-border-control px-2 py-1 text-sm text-text"
          onClick={() => view.current?.setPlaying(!view.current.isPlaying())}>
          {stats?.playing === false ? "▶ Mover" : "❚❚ Quieto"}
        </button>
        <span>
          Calidad N{tier?.tier ?? "?"} · {stats?.resting ? "en reposo" : stats?.fps ? `${stats.fps} cps` : "—"} · {(scene?.vertices ?? 0).toLocaleString("es-MX")} vértices
        </span>
      </footer>
    </div>
  );
}
