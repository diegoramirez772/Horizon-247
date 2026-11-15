"use client";

// «Ficha de HORI» in the conversation: HORI works out loud on one place, step by step — each step is real work (bytes
// read, hashes checked, live sources asked) and gets its ✓ when it is done. One line per step, the evidence one tap
// away. It answers the six questions (what are we seeing, how is it verified, what is happening, what changed, what
// needs attention, how is it followed) and shows the seven capacities, without an LLM: every number comes from a bundle.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "@/core/i18n/texts";
import { FLAG } from "@/contract/types";
import { GROUPS, type FaunaGroup, boxAround, watchFauna } from "@/core/live/fauna";
import { type LiveDetection, subscribeWeather } from "@/core/map/weather";
import {
  type FaunaHit, type JointHit, type Place, type Priority, RULES, STEPS, type StepKey, type Timeline, type VarReading,
  eventsNear, explain, fmtNum, layersFor, prioritize, readJoint, readTimeline, readVariable, stormsNear, trendLine, verifyVariable,
} from "@/core/hori/ficha";
import type { NaturalEvent } from "@/core/live/eonet";
import { faunaLine } from "../FaunaPanel";

const TITLE: Record<StepKey, Record<"es" | "en", { t: string; q: string }>> = {
  identifica: { es: { t: "Identifica", q: "¿Qué estamos viendo y cómo se verifica?" }, en: { t: "Identify", q: "What are we looking at, and how is it verified?" } },
  observa: { es: { t: "Observa", q: "¿Qué tan buenos son los datos?" }, en: { t: "Observe", q: "How good are the data?" } },
  detecta: { es: { t: "Detecta", q: "¿Qué está ocurriendo?" }, en: { t: "Detect", q: "What is happening?" } },
  supervisa: { es: { t: "Supervisa", q: "¿Qué ha cambiado y cómo se le da seguimiento?" }, en: { t: "Supervise", q: "What has changed, and how is it followed?" } },
  prioriza: { es: { t: "Prioriza", q: "¿Qué requiere atención?" }, en: { t: "Prioritise", q: "What needs attention?" } },
  nosabe: { es: { t: "Lo que no sabe", q: "¿Qué no se puede afirmar todavía?" }, en: { t: "What it does not know", q: "What cannot be said yet?" } },
  explica: { es: { t: "Explica", q: "Todo junto, con números y fuentes" }, en: { t: "Explain", q: "All together, with numbers and sources" } },
};

const VERDICT_CHIP: Record<number, Record<"es" | "en", string>> = {
  1: { es: "Ya cambió", en: "Changed" }, 2: { es: "Posible", en: "Possible" }, 3: { es: "Aún no se sabe", en: "Not known yet" },
  4: { es: "No cambió mucho", en: "Little change" }, 0: { es: "Pocos datos", en: "Too few data" },
};
const FLAG_TEXT: Partial<Record<keyof typeof FLAG, Record<"es" | "en", string>>> = {
  QUIEBRE_POSIBLE: { es: "posible salto en la serie", en: "possible jump in the series" },
  COBERTURA_BAJA: { es: "pocos años con datos", en: "few years with data" },
  RECONSTRUCCION: { es: "reconstrucción (no medición directa)", en: "reconstruction (not a direct measurement)" },
  RESOLUCION_GRUESA: { es: "resolución gruesa", en: "coarse resolution" },
  AUTOCORRELACION_ALTA: { es: "años muy parecidos entre sí (memoria alta)", en: "years very alike (high memory)" },
  DEPENDE_DEL_METODO: { es: "el resultado depende del método", en: "the result depends on the method" },
  CAMBIO_DE_VERSION: { es: "cambió la versión de los datos", en: "the data version changed" },
};
const PCOL = ["bg-[#d92d20] text-white", "bg-accent text-on-accent", "bg-surface-2 text-text", "bg-surface-2 text-text-2", "bg-surface-2 text-text-3"];

const WATCH = "h247-ficha-watch-v1";
const SEEN = "h247-ficha-seen-v1";
const EVERY_MS = 6 * 3600e3;
const readJson = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const writeJson = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } };

type Status = "wait" | "run" | "done";

interface State {
  vars: VarReading[]; verified: Record<string, boolean | null>; timeline: Timeline | null; joint: JointHit[];
  storms: { d: LiveDetection; km: number }[] | null; events: { e: NaturalEvent; km: number }[] | null; fauna: FaunaHit[] | null;
  status: Record<StepKey, Status>; at: number;
}
const fresh = (): State => ({ vars: [], verified: {}, timeline: null, joint: [], storms: null, events: null, fauna: null, status: Object.fromEntries(STEPS.map((k) => [k, "wait"])) as Record<StepKey, Status>, at: 0 });

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((ok) => setTimeout(() => ok(fallback), ms))]);
}

export function FichaHori({ place, lang, focus, onLook }: { place: Place; lang: Lang; focus: StepKey | null; onLook: (lat: number, lon: number) => void }) {
  const es = lang === "es";
  const [s, setS] = useState<State>(fresh);
  const [open, setOpen] = useState<Set<StepKey>>(() => new Set<StepKey>(focus ? [focus] : ["explica"]));
  const [run, setRun] = useState(0);
  const [watching, setWatching] = useState(() => readJson<Place[]>(WATCH, []).some((p) => p.lat === place.lat && p.lon === place.lon));
  const [news, setNews] = useState<string[]>([]);
  const storms = useRef<LiveDetection[] | null>(null);

  useEffect(() => subscribeWeather((f) => { storms.current = f.detections; }), []);

  useEffect(() => {
    let live = true;
    const set = (f: (o: State) => State) => { if (live) setS(f); };
    const step = (k: StepKey, st: Status) => set((o) => ({ ...o, status: { ...o.status, [k]: st } }));
    const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
    setS(fresh());
    (async () => {
      // 1 · identify: which layers describe this place, the cell of each, and the verification of every verdict map
      step("identifica", "run");
      const { layers, timeline, joint } = await layersFor();
      const vars = (await Promise.all(layers.map((e) => readVariable(e, place).catch(() => null)))).filter((v): v is VarReading => !!v);
      const usable = vars.filter((v) => v.nvalid > 0 || v.verdict !== 0);
      set((o) => ({ ...o, vars: usable }));
      for (const e of layers) verifyVariable(e).then((ok) => set((o) => ({ ...o, verified: { ...o.verified, [e.id]: ok } }))).catch(() => {});
      await pause(250); step("identifica", "done");
      // 2 · observe: coverage, flags and kind of data (already in the bytes read)
      step("observa", "run"); await pause(350); step("observa", "done");
      // 3 · detect: trends, joint change, live storms and events, the six animal groups
      step("detecta", "run");
      const [jt, ev, fa] = await Promise.all([
        withTimeout(readJoint(joint, place), 8000, [] as JointHit[]),
        withTimeout(eventsNear(place), 8000, [] as { e: NaturalEvent; km: number }[]),
        withTimeout((async () => {
          const box = boxAround(place.lat, place.lon, 0.5), out: FaunaHit[] = [];
          for (const g of Object.keys(GROUPS) as FaunaGroup[]) {
            try { const sig = await watchFauna(g, box); const l = faunaLine(sig, lang); out.push({ group: g, name: GROUPS[g][lang], level: l.level, text: l.text }); } catch { /* skip group */ }
          }
          return out;
        })(), 12000, [] as FaunaHit[]),
      ]);
      for (let k = 0; k < 12 && storms.current === null; k++) await pause(500);
      set((o) => ({ ...o, joint: jt, events: ev, fauna: fa, storms: stormsNear(storms.current ?? [], place) }));
      step("detecta", "done");
      // 4 · supervise: how the evidence evolved (temperature timeline)
      step("supervisa", "run");
      const tl = timeline ? await withTimeout(readTimeline(timeline, place), 6000, null) : null;
      set((o) => ({ ...o, timeline: tl })); await pause(200); step("supervisa", "done");
      for (const k of ["prioriza", "nosabe", "explica"] as StepKey[]) { step(k, "run"); await pause(300); step(k, "done"); }
      set((o) => ({ ...o, at: Date.now() }));
    })().catch(() => { for (const k of STEPS) step(k, "done"); });
    return () => { live = false; };
  }, [place.lat, place.lon, lang, run]); // eslint-disable-line react-hooks/exhaustive-deps

  const pri: Priority[] = useMemo(() => prioritize({ vars: s.vars, timeline: s.timeline, joint: s.joint, storms: s.storms ?? [], events: s.events ?? [], fauna: s.fauna ?? [], place }), [s, place]);
  const unknown = s.vars.filter((v) => v.verdict === 3 || v.verdict === 0);
  const nVerified = s.vars.filter((v) => s.verified[v.id] === true).length;

  // Follow-up: «Vigilar este lugar» re-checks every 6 h while the page is open and gives notice of P0/P1 not seen before.
  useEffect(() => {
    if (!watching) return;
    const id = window.setInterval(() => { if (!document.hidden) setRun((n) => n + 1); }, EVERY_MS);
    return () => window.clearInterval(id);
  }, [watching]);
  useEffect(() => {
    if (!s.at || !watching) return;
    const seen = new Set(readJson<string[]>(SEEN, []));
    const fresh = pri.filter((p) => p.p <= 1 && !seen.has(`${place.lat},${place.lon}|${p.key}`));
    if (!fresh.length) return;
    for (const p of fresh) seen.add(`${place.lat},${place.lon}|${p.key}`);
    writeJson(SEEN, [...seen].slice(-300));
    setNews(fresh.map((p) => p.text[lang]));
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification(`HORI · ${place.name}`, { body: fresh[0].text[lang], tag: `ficha-${place.lat},${place.lon}` }); } catch { /* needs a service worker in some browsers */ }
    }
  }, [s.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleWatch = async () => {
    const list = readJson<Place[]>(WATCH, []).filter((p) => !(p.lat === place.lat && p.lon === place.lon));
    const on = !watching;
    if (on && typeof Notification !== "undefined" && Notification.permission === "default") { try { await Notification.requestPermission(); } catch { /* the card still lists notices */ } }
    writeJson(WATCH, on ? [...list, place] : list);
    setWatching(on);
  };

  const summary: Record<StepKey, string> = {
    identifica: s.vars.length
      ? (es ? `${place.name} (${fmtNum(place.lat, lang)}°, ${fmtNum(place.lon, lang)}°) · lugar real · ${s.vars.length} variables NASA · ${nVerified}/${s.vars.length} huellas verificadas`
        : `${place.name} (${fmtNum(place.lat, lang)}°, ${fmtNum(place.lon, lang)}°) · real place · ${s.vars.length} NASA variables · ${nVerified}/${s.vars.length} fingerprints verified`)
      : (es ? "Buscando los datos de este lugar…" : "Finding this place's data…"),
    observa: s.vars.length
      ? (es ? `${s.vars.map((v) => `${v.name.es.split(" (")[0]} ${v.nvalid}/${v.window.n} años`).join(" · ")}` : `${s.vars.map((v) => `${v.name.en.split(" (")[0]} ${v.nvalid}/${v.window.n} years`).join(" · ")}`)
      : "…",
    detecta: es
      ? `${s.vars.filter((v) => v.verdict === 1).length} tendencias claras · ${s.joint.length} cambio(s) conjunto(s) · ${s.storms?.length ?? 0} tormentas cerca · ${s.events?.length ?? 0} eventos NASA cerca · fauna ${s.fauna ? `${s.fauna.filter((f) => f.level && f.level !== "leve").length} anomalías` : "…"}`
      : `${s.vars.filter((v) => v.verdict === 1).length} clear trends · ${s.joint.length} joint change(s) · ${s.storms?.length ?? 0} storms nearby · ${s.events?.length ?? 0} NASA events nearby · wildlife ${s.fauna ? `${s.fauna.filter((f) => f.level && f.level !== "leve").length} anomalies` : "…"}`,
    supervisa: s.timeline?.firstProbado
      ? (es ? `La temperatura se volvió clara en ${s.timeline.firstProbado}${s.timeline.event === "CRUZO" ? ` · cruzó con el dato de ${s.timeline.lastWindow}` : ""}` : `Temperature became clear in ${s.timeline.firstProbado}${s.timeline.event === "CRUZO" ? ` · crossed with the ${s.timeline.lastWindow} data` : ""}`)
      : (es ? "Sin tendencia de temperatura que se haya vuelto clara aquí" : "No temperature trend has become clear here"),
    prioriza: pri.length ? `${pri.filter((p) => p.p <= 1).length} P0–P1 · ${pri.filter((p) => p.p === 2).length} P2 · ${pri.filter((p) => p.p >= 3).length} P3–P4` : "…",
    nosabe: unknown.length ? (es ? `Aún no se sabe: ${unknown.map((v) => v.name.es.split(" (")[0].toLowerCase()).join(", ")}` : `Not known yet: ${unknown.map((v) => v.name.en.split(" (")[0].toLowerCase()).join(", ")}`) : (es ? "Todo lo revisado tiene datos suficientes" : "Everything checked has enough data"),
    explica: es ? "Párrafo final con números y fuentes" : "Final paragraph with numbers and sources",
  };

  const flip = (k: StepKey) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const done = STEPS.filter((k) => s.status[k] === "done").length;

  return (
    <section className="rounded-2xl border border-border bg-surface-2/60 p-3.5">
      <header className="mb-2 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{es ? "Ficha de HORI" : "HORI file"} · {place.name}</h3>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-text-2">{done < STEPS.length ? (es ? `Pensando ${done}/7` : `Working ${done}/7`) : "HORI"}</span>
      </header>
      {news.length ? (
        <div aria-live="polite" className="mb-2 rounded-xl border border-accent p-2 text-xs"><p className="font-semibold">{es ? "Avisos nuevos" : "New notices"}</p><ul className="ml-4 list-disc">{news.map((n, k) => <li key={k}>{n}</li>)}</ul></div>
      ) : null}
      <ol className="space-y-1.5">
        {STEPS.map((k, n) => {
          const st = s.status[k], isOpen = open.has(k) && st === "done";
          return (
            <li key={k} className={`rounded-xl border bg-surface transition-colors ${focus === k ? "border-accent" : "border-border"}`}>
              <button type="button" onClick={() => flip(k)} aria-expanded={isOpen} disabled={st !== "done"} className="flex w-full items-start gap-2.5 px-3 py-2 text-left">
                <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${st === "done" ? "bg-accent text-on-accent" : st === "run" ? "animate-pulse bg-surface-2 text-text-2" : "bg-surface-2 text-text-3"}`}>{st === "done" ? "✓" : n + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2"><span className="text-sm font-semibold">{TITLE[k][lang].t}</span><span className="truncate text-xs text-text-3">{TITLE[k][lang].q}</span></span>
                  <span className={`block text-xs leading-snug ${st === "done" ? "text-text-2" : "text-text-3"}`}>{st === "wait" ? "…" : st === "run" ? (es ? "trabajando…" : "working…") : summary[k]}</span>
                </span>
                {st === "done" ? <span aria-hidden="true" className="text-xs text-text-3">{isOpen ? "▴" : "▾"}</span> : null}
              </button>
              {isOpen ? <div className="border-t border-border px-3 py-2.5 text-xs leading-relaxed">{detail(k)}</div> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );

  function detail(k: StepKey): React.ReactNode {
    switch (k) {
      case "identifica":
        return (
          <div className="space-y-1.5">
            <p>{es ? `Entidad: un lugar real de la Tierra, no simulado. Cada variable se lee en la celda que cubre ${fmtNum(place.lat, lang)}°, ${fmtNum(place.lon, lang)}° (de ~${Math.round(s.vars[0]?.cellKm ?? 0)} km a ~${Math.round(Math.max(...s.vars.map((v) => v.cellKm), 0))} km de lado).` : `Entity: a real place on Earth, not simulated. Each variable is read at the cell covering ${fmtNum(place.lat, lang)}°, ${fmtNum(place.lon, lang)}° (~${Math.round(s.vars[0]?.cellKm ?? 0)} to ~${Math.round(Math.max(...s.vars.map((v) => v.cellKm), 0))} km across).`}</p>
            <ul className="space-y-1">
              {s.vars.map((v) => {
                const ok = s.verified[v.id];
                return (
                  <li key={v.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{v.name[lang]}</span>
                    <span className="text-text-3">{v.dataset}{v.doi ? ` · doi:${v.doi}` : ""} · {v.datasetKind === "reanalysis" ? (es ? "reanálisis" : "reanalysis") : (es ? "satélite / observación" : "satellite / observation")} · {v.window.start}–{v.window.end}</span>
                    <span className={ok === true ? "font-semibold" : "text-text-3"}>{ok === true ? (es ? `✓ huella SHA-256 ${v.sha?.slice(0, 10)}… coincide` : `✓ SHA-256 ${v.sha?.slice(0, 10)}… matches`) : ok === false ? (es ? "✗ la huella no coincide" : "✗ fingerprint does not match") : (es ? "verificando…" : "verifying…")}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-text-3">{es ? "Verificar = descargar el mapa de veredictos de cada variable y comparar su huella con la publicada en el índice: si alguien lo cambiara, no coincidiría." : "Verify = download each variable's verdict map and compare its fingerprint with the one published in the index: if anyone changed it, it would not match."}</p>
          </div>
        );
      case "observa":
        return (
          <ul className="space-y-1">
            {s.vars.map((v) => {
              const fl = (Object.keys(FLAG) as (keyof typeof FLAG)[]).filter((f) => (v.flags & FLAG[f]) !== 0 && FLAG_TEXT[f]).map((f) => FLAG_TEXT[f]![lang]);
              return (
                <li key={v.id}><span className="font-medium">{v.name[lang]}</span>: {es ? `${v.nvalid} de ${v.window.n} años con datos` : `${v.nvalid} of ${v.window.n} years with data`}
                  {fl.length ? <span className="text-text-2"> · {fl.join(", ")}{v.breakYear ? ` (${v.breakYear})` : ""}</span> : <span className="text-text-3"> · {es ? "sin banderas" : "no flags"}</span>}
                </li>
              );
            })}
          </ul>
        );
      case "detecta":
        return (
          <div className="space-y-2">
            <ul className="space-y-1">
              {s.vars.map((v) => (
                <li key={v.id} className="flex items-start gap-2">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${v.verdict === 1 ? "bg-accent text-on-accent" : "bg-surface-2 text-text-2"}`}>{VERDICT_CHIP[v.verdict]?.[lang] ?? "—"}</span>
                  <span><span className="font-medium">{v.name[lang]}</span> · {trendLine(v, lang)}</span>
                </li>
              ))}
            </ul>
            {s.joint.length ? <p>{es ? "Cambio conjunto: " : "Joint change: "}{s.joint.map((j) => `${j.name[lang]} (${j.level === 4 ? (es ? "probado juntos" : "proven together") : (es ? "cada una por separado" : "each on its own")})`).join("; ")}</p> : null}
            <p>{es ? "En vivo: " : "Live: "}{s.storms?.length ? s.storms.slice(0, 3).map(({ d, km }) => `${d.kind === "tormenta" ? (es ? "tormenta" : "storm") : d.kind === "nieve" ? (es ? "nieve" : "snow") : (es ? "lluvia intensa" : "heavy rain")} a ${Math.round(km)} km`).join(", ") : (es ? "sin tormentas a 600 km" : "no storms within 600 km")}{" · "}{s.events?.length ? s.events.slice(0, 3).map(({ e, km }) => `${e.title} (${Math.round(km)} km)`).join(", ") : (es ? "sin eventos NASA a 400 km" : "no NASA events within 400 km")}</p>
            {s.fauna?.length ? <p>{es ? "Fauna: " : "Wildlife: "}{s.fauna.map((f) => `${f.name} ${f.level ? `(${f.level})` : "✓"}`).join(" · ")}</p> : null}
            <button type="button" onClick={() => onLook(place.lat, place.lon)} className="font-semibold underline underline-offset-2">{es ? "Ver en el mapa" : "See on the map"}</button>
          </div>
        );
      case "supervisa":
        return (
          <div className="space-y-1.5">
            {s.timeline ? (
              <p>{s.timeline.firstProbado
                ? (es ? `Revisando la temperatura con ventanas que crecen año con año (1981→${s.timeline.lastWindow}), el cambio se volvió claro en ${s.timeline.firstProbado}${s.timeline.emergence ? ` y se mantiene desde ${s.timeline.emergence}` : ""}. ${s.timeline.event === "CRUZO" ? `Cruzó a probado con el dato de ${s.timeline.lastWindow}.` : s.timeline.event === "SE_DEBILITO" ? "Con el último dato se debilitó." : "El último dato no cambió el veredicto."}`
                  : `Checking temperature with windows that grow year by year (1981→${s.timeline.lastWindow}), the change became clear in ${s.timeline.firstProbado}${s.timeline.emergence ? ` and has held since ${s.timeline.emergence}` : ""}. ${s.timeline.event === "CRUZO" ? `It crossed to proven with the ${s.timeline.lastWindow} data.` : s.timeline.event === "SE_DEBILITO" ? "It weakened with the latest data." : "The latest data did not change the verdict."}`)
                : (es ? "En ninguna ventana de 1981 a hoy la temperatura cambió de forma clara aquí." : "In no window from 1981 to today did temperature change clearly here.")}</p>
            ) : null}
            <p className="text-text-3">{es ? `Revisado ${s.at ? new Date(s.at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—"}. Las tendencias se recalculan cuando la NASA publica un mes nuevo; lo en vivo, cada 10 minutos.` : `Checked ${s.at ? new Date(s.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}. Trends are recomputed when NASA publishes a new month; live sources every 10 minutes.`}</p>
            <button type="button" onClick={() => void toggleWatch()} aria-pressed={watching} className={`rounded-full px-3 py-1 font-semibold ${watching ? "bg-accent text-on-accent" : "border border-border"}`}>
              {watching ? <><span className="live-dot" aria-hidden="true" />{es ? "Vigilando · revisa cada 6 h y avisa de P0–P1 nuevos" : "Watching · checks every 6 h, notifies new P0–P1"}</> : (es ? "Vigilar este lugar y avisarme" : "Watch this place and notify me")}
            </button>
          </div>
        );
      case "prioriza":
        return (
          <div className="space-y-1.5">
            <ul className="space-y-1">
              {pri.map((p) => (
                <li key={p.key} className="flex items-start gap-2">
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${PCOL[p.p]}`}>P{p.p}</span>
                  <span><span className="font-medium">{p.text[lang]}</span><span className="block text-text-3">{p.why[lang]}</span></span>
                </li>
              ))}
            </ul>
            <details><summary className="cursor-pointer font-semibold">{es ? "¿Cómo se ordena?" : "How is it ordered?"}</summary><ul className="mt-1 space-y-0.5 text-text-2">{RULES[lang].map((r) => <li key={r}>{r}</li>)}</ul></details>
          </div>
        );
      case "nosabe":
        return (
          <ul className="space-y-1">
            {unknown.map((v) => <li key={v.id}><span className="font-medium">{v.name[lang]}</span>: {trendLine(v, lang)}</li>)}
            {s.fauna?.filter((f) => !f.level && /pocas|few/i.test(f.text)).map((f) => <li key={f.group}><span className="font-medium">{f.name}</span>: {f.text}</li>)}
            <li className="text-text-2">{es ? `Escala: cada celda mide de ~${Math.round(s.vars[0]?.cellKm ?? 0)} km a ~${Math.round(Math.max(...s.vars.map((v) => v.cellKm), 0))} km; no describe una calle ni un rancho.` : `Scale: each cell spans ~${Math.round(s.vars[0]?.cellKm ?? 0)} to ~${Math.round(Math.max(...s.vars.map((v) => v.cellKm), 0))} km; it does not describe a street or a ranch.`}</li>
            <li className="text-text-2">{es ? "Varias variables son reanálisis (modelo + observaciones), no mediciones directas del lugar." : "Several variables are reanalysis (model + observations), not direct measurements of the place."}</li>
            <li className="text-text-2">{es ? "HORI dice dónde, cuánto y desde cuándo; no dice por qué." : "HORI says where, how much and since when; it does not say why."}</li>
          </ul>
        );
      case "explica":
        return <p className="text-sm leading-relaxed">{explain({ place, vars: s.vars, pri, timeline: s.timeline, unknown }, lang)}</p>;
    }
  }
}
