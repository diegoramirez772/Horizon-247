"use client";

// The components the assistant builds for a topic (Plan de unión U3). Each one fetches or computes its own numbers
// and says where they come from: NASA en vivo (POWER, EONET), HORI, or SIMULADO.

import { useEffect, useMemo, useState } from "react";
import type { Widget } from "@/core/genui/topic";
import { findPlace, type Where } from "@/core/genui/places";
import type { Lang } from "@/core/i18n/texts";
import { CAT_LABEL, CAT_PLURAL, fetchEvents, km, type NaturalEvent } from "@/core/live/eonet";
import { fetchPowerPoint, thiDays, type PowerPoint, type ThiLevel } from "@/core/live/power";
import { dbConfigured, listSwarmReports, sendSwarmReport, type SwarmReport } from "@/core/live/db";
import { loadLayer, loadSeries } from "@/core/contract/loader";
import { BUNDLES } from "../useBundles";
import { DailyLine, LevelBars } from "../charts";

export interface WidgetActions {
  /** Fly the Monitoreo globe to a point and open it. */
  look: (lat: number, lon: number) => void;
  /** Put a NASA layer under the data and open Monitoreo. */
  imagery: (id: string) => void;
}

const fmt = (x: number | null | undefined, lang: Lang, d = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—"
    : x.toLocaleString(lang === "es" ? "es-ES" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: 0, useGrouping: false });

function dayName(iso: string, lang: Lang): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function Widgets({ widgets, lang, actions }: { widgets: Widget[]; lang: Lang; actions: WidgetActions }) {
  return (
    <div className="mt-3 grid gap-3">
      {widgets.map((w, k) => (
        <div key={`${w.w}-${k}`} className="widget-in" style={{ animationDelay: `${k * 90}ms` }}>
          {w.w === "now" ? <NowWidget where={w.where} lang={lang} actions={actions} />
            : w.w === "thi" ? <ThiWidget where={w.where} lang={lang} />
            : w.w === "events" ? <EventsWidget near={w.near} lang={lang} actions={actions} />
            : w.w === "astronaut" ? <AstronautWidget lang={lang} />
            : w.w === "mars" ? <MarsWidget lang={lang} />
            : w.w === "swarm" ? <SwarmWidget where={w.where} draft={w.draft} lang={lang} actions={actions} />
            : <PlanetsWidget lang={lang} />}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- frame

function Frame({ title, badge, children, foot }: { title: string; badge: { text: string; kind: "live" | "hori" | "sim" | "ref" }; children: React.ReactNode; foot?: React.ReactNode }) {
  const cls = badge.kind === "sim" ? "bg-sim/70 text-on-sim" : "border border-border text-text-2";
  return (
    <section className="rounded-2xl border border-border bg-surface-2/60 p-3.5">
      <header className="mb-2 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
          {badge.kind === "live" ? <span className="live-dot" aria-hidden="true" /> : null}{badge.text}
        </span>
      </header>
      {children}
      {foot ? <p className="mt-2 text-xs text-text-3">{foot}</p> : null}
    </section>
  );
}

function usePower(where: Where): { p: PowerPoint | null; err: boolean } {
  const [st, setSt] = useState<{ key: string; p: PowerPoint | null; err: boolean }>({ key: "", p: null, err: false });
  const key = `${where.lat},${where.lon}`;
  useEffect(() => {
    let live = true;
    fetchPowerPoint(where.lat, where.lon).then((p) => live && setSt({ key, p, err: false })).catch(() => live && setSt({ key, p: null, err: true }));
    return () => { live = false; };
  }, [key, where.lat, where.lon]);
  return st.key === key ? st : { p: null, err: false };
}

function Loading({ lang }: { lang: Lang }) {
  return <p className="animate-pulse py-4 text-sm text-text-3">{lang === "es" ? "Consultando a la NASA…" : "Asking NASA…"}</p>;
}

function Offline({ lang, what }: { lang: Lang; what: string }) {
  return <p className="py-2 text-sm text-text-2">{lang === "es" ? `No pude leer ${what} ahora (¿sin internet?). Lo demás sigue funcionando.` : `I could not read ${what} now (offline?). Everything else still works.`}</p>;
}

// ---------------------------------------------------------------- now (POWER)

export function NowWidget({ where, lang, actions }: { where: Where; lang: Lang; actions: WidgetActions }) {
  const { p, err } = usePower(where);
  const es = lang === "es";
  const title = es ? `${where.name} · lo último medido` : `${where.name} · latest measured`;
  const badge = { text: es ? "NASA POWER" : "NASA POWER", kind: "live" as const };
  if (err) return <Frame title={title} badge={badge}><Offline lang={lang} what="NASA POWER" /></Frame>;
  if (!p) return <Frame title={title} badge={badge}><Loading lang={lang} /></Frame>;
  const d = p.days;
  const last = d.at(-1);
  if (!last) return <Frame title={title} badge={badge}><Offline lang={lang} what="NASA POWER" /></Frame>;
  const week = d.slice(-7);
  const rain7 = week.reduce((a, x) => a + (x.rain ?? 0), 0);
  const dates = d.map((x) => x.date);
  const tiles: { k: string; v: string; u: string; line: React.ReactNode }[] = [
    { k: es ? "Temperatura" : "Temperature", v: fmt(last.t2m, lang), u: "°C", line: <DailyLine values={d.map((x) => x.t2m)} dates={dates} color="var(--warm)" label={es ? "Temperatura" : "Temperature"} lang={lang} unit="°C" /> },
    { k: es ? "Máxima" : "Maximum", v: fmt(last.tmax, lang), u: "°C", line: <DailyLine values={d.map((x) => x.tmax)} dates={dates} color="var(--lvl-danger)" label={es ? "Máxima" : "Maximum"} lang={lang} unit="°C" /> },
    { k: es ? "Lluvia 7 días" : "Rain 7 days", v: fmt(rain7, lang), u: "mm", line: <DailyLine values={d.map((x) => x.rain)} dates={dates} color="var(--cool)" label={es ? "Lluvia" : "Rain"} lang={lang} unit="mm" /> },
    { k: es ? "Humedad" : "Humidity", v: fmt(last.rh, lang, 0), u: "%", line: <DailyLine values={d.map((x) => x.rh)} dates={dates} color="var(--text-2)" label={es ? "Humedad" : "Humidity"} lang={lang} unit="%" /> },
  ];
  return (
    <Frame title={title} badge={badge}
      foot={<>{es ? `Último dato: ${dayName(last.date, lang)}. POWER publica con unos días de retraso; cada valor trae su fecha.` : `Latest data: ${dayName(last.date, lang)}. POWER publishes a few days late; every value carries its date.`}{" "}
        <button type="button" className="underline underline-offset-2 hover:text-text" onClick={() => actions.look(where.lat, where.lon)}>{es ? "Ver en Monitoreo" : "See in Monitoring"}</button></>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.k} className="rounded-xl bg-surface p-2.5">
            <p className="text-[11px] text-text-3">{t.k}</p>
            <p className="tabular text-lg font-semibold leading-tight">{t.v}<span className="ml-0.5 text-xs font-normal text-text-2">{t.u}</span></p>
            {t.line}
          </div>
        ))}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- livestock heat stress (THI)

const THI_COLOR: Record<ThiLevel, string> = { normal: "var(--lvl-ok)", alerta: "var(--lvl-watch)", alto: "var(--lvl-danger)", muy_alto: "var(--lvl-critical)" };
const THI_WORD: Record<Lang, Record<ThiLevel, string>> = {
  es: { normal: "Normal", alerta: "Alerta", alto: "Alto", muy_alto: "Muy alto" },
  en: { normal: "Normal", alerta: "Alert", alto: "High", muy_alto: "Very high" },
};

function ThiWidget({ where, lang }: { where: Where; lang: Lang }) {
  const { p, err } = usePower(where);
  const es = lang === "es";
  const title = es ? `Estrés por calor del ganado · ${where.name}` : `Livestock heat stress · ${where.name}`;
  const badge = { text: es ? "NASA POWER + THI" : "NASA POWER + THI", kind: "live" as const };
  const days = useMemo(() => (p ? thiDays(p.days) : []), [p]);
  if (err) return <Frame title={title} badge={badge}><Offline lang={lang} what="NASA POWER" /></Frame>;
  if (!p) return <Frame title={title} badge={badge}><Loading lang={lang} /></Frame>;
  const last = days.at(-1);
  if (!last) return <Frame title={title} badge={badge}><Offline lang={lang} what="NASA POWER" /></Frame>;
  const worst = days.reduce((a, b) => (b.thi > a.thi ? b : a), days[0]);
  const risky = days.filter((x) => x.level !== "normal").length;
  return (
    <Frame title={title} badge={badge}
      foot={es
        ? "THI = 0,8·T + HR/100·(T − 14,4) + 46,4 con la máxima del día (NRC 1971). Umbrales para bovinos del índice LCI: 75 alerta, 79 alto, 84 muy alto. Describe el ambiente, no la salud de un animal."
        : "THI = 0.8·T + RH/100·(T − 14.4) + 46.4 with the day's maximum (NRC 1971). Cattle thresholds from the LCI index: 75 alert, 79 high, 84 very high. It describes the environment, not an animal's health."}>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
        <div>
          <p className="text-[11px] text-text-3">{es ? `Último día (${dayName(last.date, lang)})` : `Latest day (${dayName(last.date, lang)})`}</p>
          <p className="tabular text-2xl font-semibold leading-tight" style={{ color: THI_COLOR[last.level] }}>{fmt(last.thi, lang, 0)} <span className="text-sm">{THI_WORD[lang][last.level]}</span></p>
        </div>
        <p className="text-sm text-text-2">
          {es ? `Peor día: ${dayName(worst.date, lang)} (${fmt(worst.thi, lang, 0)}). ${risky ? `${risky} de ${days.length} días sobre el umbral de alerta.` : `Ningún día de ${days.length} llegó a alerta.`}`
            : `Worst day: ${dayName(worst.date, lang)} (${fmt(worst.thi, lang, 0)}). ${risky ? `${risky} of ${days.length} days above the alert threshold.` : `None of ${days.length} days reached alert.`}`}
        </p>
      </div>
      <LevelBars lang={lang} label={es ? "THI diario" : "Daily THI"} unit="THI"
        items={days.map((x) => ({ key: x.date, value: x.thi, color: THI_COLOR[x.level], title: `${x.date}: THI ${fmt(x.thi, lang, 0)} · ${THI_WORD[lang][x.level]}` }))}
        thresholds={[{ value: 75, color: "var(--lvl-watch)", label: "75" }, { value: 79, color: "var(--lvl-danger)", label: "79" }, { value: 84, color: "var(--lvl-critical)", label: "84" }]} />
    </Frame>
  );
}

// ---------------------------------------------------------------- natural events (EONET)

export function EventsWidget({ near, lang, actions }: { near: Where | null; lang: Lang; actions: WidgetActions }) {
  const [st, setSt] = useState<{ ev: NaturalEvent[] | null; err: boolean }>({ ev: null, err: false });
  useEffect(() => {
    let live = true;
    fetchEvents().then((ev) => live && setSt({ ev, err: false })).catch(() => live && setSt({ ev: null, err: true }));
    return () => { live = false; };
  }, []);
  const es = lang === "es";
  const title = near ? (es ? `Eventos naturales cerca de ${near.name}` : `Natural events near ${near.name}`) : (es ? "Eventos naturales abiertos" : "Open natural events");
  const badge = { text: "NASA EONET", kind: "live" as const };
  if (st.err) return <Frame title={title} badge={badge}><Offline lang={lang} what="NASA EONET" /></Frame>;
  if (!st.ev) return <Frame title={title} badge={badge}><Loading lang={lang} /></Frame>;
  const list = (near ? st.ev.slice().sort((a, b) => km(near, a) - km(near, b)) : st.ev).slice(0, 6);
  const counts = st.ev.reduce<Record<string, number>>((a, e) => ({ ...a, [e.cat]: (a[e.cat] ?? 0) + 1 }), {});
  return (
    <Frame title={title} badge={badge}
      foot={es ? "EONET reúne reportes de otras fuentes (InciWeb, GDACS, centros de tormentas…); HORI no detectó estos eventos." : "EONET gathers reports from other sources (InciWeb, GDACS, storm centres…); HORI did not detect these events."}>
      <p className="mb-2 flex flex-wrap gap-1.5 text-xs text-text-2">
        {Object.entries(counts).map(([c, n]) => (
          <span key={c} className="rounded-full bg-surface px-2 py-0.5">{CAT_LABEL[c as keyof typeof CAT_LABEL].icon} {n} {n > 1 ? CAT_PLURAL[c as keyof typeof CAT_PLURAL][lang] : CAT_LABEL[c as keyof typeof CAT_LABEL][lang].toLocaleLowerCase(lang)}</span>
        ))}
      </p>
      <ul className="divide-y divide-border">
        {list.map((e) => (
          <li key={e.id} className="flex items-center gap-2 py-1.5">
            <span aria-hidden="true" className="text-base">{CAT_LABEL[e.cat].icon}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{e.title}</p>
              <p className="text-xs text-text-3">{dayName(e.date.slice(0, 10), lang)}{near ? ` · ${fmt(km(near, e), lang, 0)} km` : ""}{e.magnitude ? ` · ${e.magnitude}` : ""}
                {e.source ? <> · <a href={e.source} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-text">{es ? "fuente" : "source"}</a></> : null}</p>
            </div>
            <button type="button" onClick={() => actions.look(e.lat, e.lon)}
              className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs hover:border-accent">{es ? "Ver" : "See"}</button>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

// ---------------------------------------------------------------- astronaut (SIMULATED)

/** Deterministic simulated crew vitals (24 h, every 10 min) with one injected event, so the demo is repeatable. */
function simVitals() {
  let seed = 247;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  const n = 144;
  const hr: number[] = [], spo2: number[] = [], temp: number[] = [], dose: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const h = i / 6;
    const sleep = h >= 22 || h < 6;
    const exercise = h >= 10 && h < 11.5;
    let x = 62 + (sleep ? -8 : 6) + (exercise ? 38 : 0) + 3 * Math.sin(i / 7) + 2.4 * rnd();
    if (i >= 87 && i <= 90) x += 34; // injected event at ~14:30 (tachycardia at rest)
    hr.push(x);
    spo2.push(97.6 + 0.5 * Math.sin(i / 11) + 0.35 * rnd() - (i >= 88 && i <= 89 ? 2.4 : 0));
    temp.push(36.6 + 0.25 * Math.sin((h - 4) / 24 * 2 * Math.PI) + 0.06 * rnd());
    acc += (0.33 + 0.04 * rnd()) / 6; // ~0.33 mSv/day order on the ISS, per 10 min
    dose.push(acc);
  }
  return { hr, spo2, temp, dose };
}

/** Robust z (median / MAD), the same «≥ 3.5» rule HORI uses for anomalies. */
function robustZ(xs: number[]): number[] {
  const s = xs.slice().sort((a, b) => a - b);
  const med = s[s.length >> 1];
  const mad = xs.map((x) => Math.abs(x - med)).sort((a, b) => a - b)[xs.length >> 1] * 1.4826 || 1;
  return xs.map((x) => (x - med) / mad);
}

function AstronautWidget({ lang }: { lang: Lang }) {
  const v = useMemo(simVitals, []);
  const es = lang === "es";
  // Exercise is planned: compare each 10 minutes with the same activity, here simply excluding the exercise block.
  const z = useMemo(() => robustZ(v.hr.map((x, i) => (i >= 60 && i < 69 ? NaN : x)).map((x) => (Number.isFinite(x) ? x : 62))), [v]);
  const hits = z.map((x, i) => ({ x, i })).filter((p) => p.x >= 3.5);
  const first = hits[0];
  const hhmm = (i: number) => `${String(Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}`;
  const tiles = [
    { k: es ? "Ritmo cardíaco" : "Heart rate", v: fmt(v.hr.at(-1), lang, 0), u: "lpm", vals: v.hr, c: "var(--warm)" },
    { k: "SpO₂", v: fmt(v.spo2.at(-1), lang, 1), u: "%", vals: v.spo2, c: "var(--cool)" },
    { k: es ? "Temperatura" : "Temperature", v: fmt(v.temp.at(-1), lang, 1), u: "°C", vals: v.temp, c: "var(--lvl-danger)" },
    { k: es ? "Dosis acumulada" : "Dose so far", v: fmt(v.dose.at(-1), lang, 2), u: "mSv", vals: v.dose, c: "var(--lvl-watch)" },
  ];
  const dates = v.hr.map((_, i) => hhmm(i));
  return (
    <Frame title={es ? "Tripulante 1 · últimas 24 h" : "Crew member 1 · last 24 h"} badge={{ text: es ? "SIMULADO" : "SIMULATED", kind: "sim" }}
      foot={es ? "Datos inventados para mostrar el flujo: no son de una persona real ni tecnología médica validada. El evento de las 14:30 lo pusimos a propósito." : "Made-up data to show the flow: not from a real person, not validated medical technology. The 14:30 event was injected on purpose."}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.k} className="rounded-xl bg-surface p-2.5">
            <p className="text-[11px] text-text-3">{t.k}</p>
            <p className="tabular text-lg font-semibold leading-tight">{t.v}<span className="ml-0.5 text-xs font-normal text-text-2">{t.u}</span></p>
            <DailyLine values={t.vals} dates={dates} color={t.c} label={t.k} lang={lang} unit={t.u} />
          </div>
        ))}
      </div>
      {first ? (
        <p className="mt-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
          <strong style={{ color: "var(--lvl-danger)" }}>{es ? "Anomalía" : "Anomaly"}</strong>{" "}
          {es ? `de ritmo cardíaco en reposo a las ${hhmm(first.i)} (z = ${fmt(first.x, lang, 1)}, umbral 3,5), ${hits.length * 10} min seguidos. Fuera del ejercicio programado. Una anomalía no dice qué le pasa a la persona.`
            : `in resting heart rate at ${hhmm(first.i)} (z = ${fmt(first.x, lang, 1)}, threshold 3.5), ${hits.length * 10} min in a row. Outside the planned exercise. An anomaly is not a diagnosis.`}
        </p>
      ) : null}
    </Frame>
  );
}

// ---------------------------------------------------------------- Mars dust (HORI, real data)

const MARS_PATH = `${BUNDLES}mars/dust_cdod610_MY24-MY36/`;

function MarsWidget({ lang }: { lang: Lang }) {
  const [st, setSt] = useState<{ years: number[]; mean: number[]; probado: number; cand: number; cells: number } | null | "err">(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const layer = await loadLayer(MARS_PATH);
      const series = await loadSeries(layer);
      const m = layer.manifest;
      const n = m.window.n, g = m.grid;
      const sum = new Array(n).fill(0), w = new Array(n).fill(0);
      if (series) for (let r = 0; r < g.nlat; r++) {
        const c = Math.cos(((g.lat0 + r * g.dlat) * Math.PI) / 180);
        for (let k = 0; k < g.nlon; k++) {
          const base = (r * g.nlon + k) * n;
          for (let t = 0; t < n; t++) { const x = series[base + t]; if (Number.isFinite(x)) { sum[t] += c * x; w[t] += c; } }
        }
      }
      const years = m.series?.years ?? Array.from({ length: n }, (_, i) => m.window.start + i);
      if (live) setSt({ years, mean: sum.map((s, t) => (w[t] ? s / w[t] : NaN)), probado: m.summary.probado ?? 0, cand: m.summary.candidata ?? 0, cells: m.summary.cells_valid ?? 0 });
    })().catch(() => live && setSt("err"));
    return () => { live = false; };
  }, []);
  const es = lang === "es";
  const title = es ? "Polvo en la atmósfera de Marte · MY24–MY36" : "Dust in Mars' atmosphere · MY24–MY36";
  const badge = { text: "HORI", kind: "hori" as const };
  if (st === "err") return <Frame title={title} badge={badge}><Offline lang={lang} what={es ? "la capa de Marte" : "the Mars layer"} /></Frame>;
  if (!st) return <Frame title={title} badge={badge}><Loading lang={lang} /></Frame>;
  // Years that stand out (> mean + 1.2 SD) are the global dust storms; the known ones get their Earth year.
  const ok = st.mean.filter(Number.isFinite);
  const mu = ok.reduce((a, b) => a + b, 0) / ok.length;
  const sd = Math.sqrt(ok.reduce((a, b) => a + (b - mu) ** 2, 0) / ok.length);
  const storms = st.years.filter((_, t) => st.mean[t] > mu + 1.2 * sd);
  const KNOWN: Record<number, Record<Lang, string>> = {
    25: { es: "2001", en: "2001" },
    28: { es: "2007", en: "2007" },
    34: { es: "2018, la que apagó al rover Opportunity", en: "2018, the one that silenced the Opportunity rover" },
  };
  const named = storms.map((y) => `MY${y}${KNOWN[y] ? ` (${KNOWN[y][lang]})` : ""}`);
  const list = named.length > 1 ? `${named.slice(0, -1).join(", ")} ${es ? "y" : "and"} ${named.at(-1)}` : named[0] ?? "";
  return (
    <Frame title={title} badge={badge}
      foot={es ? "Promedio del planeta por año marciano (opacidad del polvo, 610 Pa). Fuente: Mars Climate Database, climatología de Montabone (CC BY-SA 3.0)." : "Planet average per Martian year (dust opacity, 610 Pa). Source: Mars Climate Database, Montabone climatology (CC BY-SA 3.0)."}>
      <LevelBars lang={lang} label={es ? "Polvo por año marciano" : "Dust per Martian year"}
        items={st.mean.map((x, t) => ({ key: `MY${st.years[t]}`, value: x * 100, color: storms.includes(st.years[t]) ? "var(--lvl-danger)" : "var(--text-3)", title: `MY${st.years[t]}: ${fmt(x, lang, 4)}` }))}
        thresholds={[]} />
      <p className="mt-1 text-sm text-text-2">
        {storms.length ? (es ? `Las barras que destacan son tormentas globales de polvo: ${list}. ` : `The bars that stand out are global dust storms: ${list}. `) : ""}
        {es ? `De ${fmt(st.cells, lang, 0)} zonas, ${st.probado} tienen una tendencia probada y ${st.cand} solo indicios: con 13 años todavía no se sabe si el polvo de Marte cambia.`
          : `Of ${fmt(st.cells, lang, 0)} areas, ${st.probado} have a proven trend and ${st.cand} only hints: with 13 years it is not known yet whether Mars' dust is changing.`}
      </p>
    </Frame>
  );
}

// ---------------------------------------------------------------- planets (NASA fact sheet)

const PLANETS: { es: string; en: string; g: number; t: number; d: number; day: number; moons: number; color: string }[] = [
  { es: "Mercurio", en: "Mercury", g: 3.7, t: 167, d: 57.9, day: 4222.6, moons: 0, color: "#9C9C9C" },
  { es: "Venus", en: "Venus", g: 8.9, t: 464, d: 108.2, day: 2802, moons: 0, color: "#D8B36A" },
  { es: "Tierra", en: "Earth", g: 9.8, t: 15, d: 149.6, day: 24, moons: 1, color: "#3D7DD8" },
  { es: "Marte", en: "Mars", g: 3.7, t: -65, d: 227.9, day: 24.7, moons: 2, color: "#C1440E" },
  { es: "Júpiter", en: "Jupiter", g: 23.1, t: -110, d: 778.5, day: 9.9, moons: 95, color: "#C99A6B" },
  { es: "Saturno", en: "Saturn", g: 9.0, t: -140, d: 1432, day: 10.7, moons: 146, color: "#E3C887" },
  { es: "Urano", en: "Uranus", g: 8.7, t: -195, d: 2867, day: 17.2, moons: 28, color: "#8FD3E0" },
  { es: "Neptuno", en: "Neptune", g: 11.0, t: -200, d: 4515, day: 16.1, moons: 16, color: "#4B6FD6" },
];

function PlanetsWidget({ lang }: { lang: Lang }) {
  const es = lang === "es";
  const [sel, setSel] = useState(3);
  const p = PLANETS[sel];
  const maxLog = Math.log10(PLANETS.at(-1)!.d);
  return (
    <Frame title={es ? "Sistema solar · datos de referencia" : "Solar system · reference values"} badge={{ text: es ? "NASA NSSDC" : "NASA NSSDC", kind: "ref" }}
      foot={es ? "Ficha planetaria del NSSDC (NASA). Temperatura media de superficie o a 1 bar en los gigantes." : "NSSDC planetary fact sheet (NASA). Mean temperature at the surface, or at 1 bar for the giants."}>
      <div className="relative h-14" role="listbox" aria-label={es ? "Planetas por distancia al Sol (escala logarítmica)" : "Planets by distance from the Sun (log scale)"}>
        <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
        <span className="absolute left-0 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full" style={{ background: "#F5B700", boxShadow: "0 0 12px #F5B700" }} aria-hidden="true" />
        {PLANETS.map((x, i) => (
          <button key={x.en} type="button" role="option" aria-selected={i === sel} onClick={() => setSel(i)} title={x[lang]}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform ${i === sel ? "scale-125 ring-2 ring-accent ring-offset-2 ring-offset-surface-2" : "hover:scale-110"}`}
            style={{ left: `${8 + ((Math.log10(x.d) - 1.7) / (maxLog - 1.7)) * 88}%`, width: 10 + Math.sqrt(x.g) * 3, height: 10 + Math.sqrt(x.g) * 3, background: x.color }} />
        ))}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          [es ? "Planeta" : "Planet", p[lang], ""],
          [es ? "Gravedad" : "Gravity", fmt(p.g, lang), "m/s²"],
          [es ? "Temperatura" : "Temperature", fmt(p.t, lang, 0), "°C"],
          [es ? "Distancia al Sol" : "From the Sun", fmt(p.d, lang, 0), es ? "mill. km" : "M km"],
          [es ? "Lunas" : "Moons", fmt(p.moons, lang, 0), ""],
        ].map(([k, v, u]) => (
          <div key={k} className="rounded-xl bg-surface p-2">
            <p className="text-[11px] text-text-3">{k}</p>
            <p className="tabular text-base font-semibold">{v}<span className="ml-0.5 text-xs font-normal text-text-2">{u}</span></p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-sm text-text-2">
        {es ? `Un día en ${p.es} dura ${fmt(p.day, lang, 1)} horas. Una persona de 70 kg pesaría ahí como ${fmt((70 * p.g) / 9.8, lang, 0)} kg en la Tierra.`
          : `A day on ${p.en} lasts ${fmt(p.day, lang, 1)} hours. A 70 kg person would weigh there like ${fmt((70 * p.g) / 9.8, lang, 0)} kg on Earth.`}
      </p>
    </Frame>
  );
}

// ---------------------------------------------------------------- red enjambre

/** Send a report to the public swarm (Supabase, anonymous session) and see the latest ones. Never verified here. */
function SwarmWidget({ where, draft, lang, actions }: { where: Where | null; draft: string | null; lang: Lang; actions: WidgetActions }) {
  const es = lang === "es";
  const [text, setText] = useState(draft ?? "");
  const [placeText, setPlaceText] = useState(where?.name ?? "");
  const [phase, setPhase] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  const [list, setList] = useState<SwarmReport[] | null>(null);
  const [listErr, setListErr] = useState(false);
  const refresh = () => listSwarmReports(12).then((r) => { setList(r); setListErr(false); }).catch(() => setListErr(true));
  useEffect(() => { if (dbConfigured()) void refresh(); }, []);
  if (!dbConfigured()) {
    return <Frame title={es ? "Red enjambre" : "Swarm"} badge={{ text: es ? "sin conexión" : "offline", kind: "ref" }}><p className="text-sm text-text-2">{es ? "Esta copia de la web no está conectada a la base de datos del equipo." : "This copy of the web is not connected to the team database."}</p></Frame>;
  }
  const place = placeFrom(placeText, where);
  const send = async () => {
    if (!place) { setErr(es ? "Escribe un lugar conocido o coordenadas (24.5, -104.6)." : "Type a known place or coordinates (24.5, -104.6)."); setPhase("error"); return; }
    setPhase("sending");
    try {
      await sendSwarmReport({ text, lat: place.lat, lon: place.lon, lang });
      setPhase("sent"); setText(""); void refresh();
    } catch (e) {
      const off = e instanceof Error && e.message === "anon-off";
      setErr(off ? (es ? "La red todavía no acepta reportes: falta activar las sesiones anónimas en Supabase." : "The swarm does not accept reports yet: anonymous sessions must be enabled in Supabase.")
        : (es ? "No se pudo enviar. Intenta de nuevo." : "Could not send. Try again."));
      setPhase("error");
    }
  };
  return (
    <Frame title={es ? "Red enjambre" : "Swarm"} badge={{ text: es ? "fuente no verificada" : "unverified", kind: "ref" }}
      foot={es ? "La ubicación se redondea a ~1 km. Licencia CC BY 4.0. Un revisor del equipo decide si se acepta." : "Location rounded to ~1 km. CC BY 4.0 licence. A team reviewer decides if it is accepted."}>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setPhase("idle"); }} rows={2} maxLength={2000} required
          aria-label={es ? "Qué ves" : "What you see"} placeholder={es ? "Qué ves: «el arroyo ya se secó», «granizo fuerte»…" : "What you see: «the creek dried up», «heavy hail»…"}
          className="w-full resize-y rounded-xl border border-border-control bg-bg px-3 py-2 text-sm" />
        <div className="flex gap-2">
          <input value={placeText} onChange={(e) => { setPlaceText(e.target.value); setPhase("idle"); }} aria-label={es ? "Lugar" : "Place"}
            placeholder={es ? "Lugar o «lat, lon»" : "Place or «lat, lon»"} className="min-w-0 flex-1 rounded-xl border border-border-control bg-bg px-3 py-2 text-sm" />
          <button type="submit" disabled={phase === "sending" || !text.trim()} className="rounded-xl bg-accent px-3.5 text-sm font-medium text-on-accent disabled:opacity-50">
            {phase === "sending" ? (es ? "Enviando…" : "Sending…") : (es ? "Enviar a la red" : "Send")}
          </button>
        </div>
        {phase === "sent" ? <p role="status" className="text-sm text-text-2">{es ? "Enviado. Quedó como fuente no verificada, en espera de revisión." : "Sent. It is an unverified source awaiting review."}</p> : null}
        {phase === "error" ? <p role="alert" className="text-sm text-text-2">{err}</p> : null}
      </form>
      <div className="mt-3 border-t border-border pt-2">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-text-3">{es ? "Últimos reportes" : "Latest reports"}</p>
        {listErr ? <p className="text-sm text-text-3">{es ? "Aún no se pueden leer (sesiones anónimas apagadas)." : "Cannot read them yet (anonymous sessions off)."}</p>
          : list === null ? <p className="text-sm text-text-3">…</p>
          : list.length === 0 ? <p className="text-sm text-text-3">{es ? "Todavía no hay reportes. Sé el primero." : "No reports yet. Be the first."}</p>
          : (
            <ul className="space-y-1.5 text-sm">
              {list.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">«{r.description}» <span className="text-xs text-text-3">· {r.at.slice(0, 10)}</span></span>
                  {r.lat !== null && r.lon !== null ? <button type="button" onClick={() => actions.look(r.lat!, r.lon!)} className="shrink-0 text-xs font-medium underline underline-offset-2">{es ? "Ver" : "See"}</button> : null}
                </li>
              ))}
            </ul>
          )}
      </div>
    </Frame>
  );
}

function placeFrom(text: string, fallback: Where | null): Where | null {
  const t = text.trim();
  if (!t) return fallback;
  if (fallback && t === fallback.name) return fallback;
  const named = findPlace(t);
  if (named) return named;
  const m = t.match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[ ,;]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(",", ".")), lon = Number(m[2].replace(",", "."));
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, lat, lon } : null;
}
