"use client";

// Monitoreo · «Señales de fauna»: how often each group of animals is reported around a place (iNaturalist, effort-normalised),
// watched with HORI's anomaly detector. It answers WHERE the reports depart from their own past, HOW MUCH, and since WHEN,
// ordered so the groups that changed come first. «Vigilar» re-checks every 6 hours while the page is open and gives a notice
// only for events not seen before; for watching 24/7 the same rule runs in ZON (`zon watch` with fauna sources).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findPlace, type Where } from "@/core/genui/places";
import { num } from "@/core/format/format";
import type { Lang } from "@/core/i18n/texts";
import { type Box, type FaunaGroup, type FaunaSignal, type TopSpecies, GROUPS, boxAround, topSpecies, watchFauna } from "@/core/live/fauna";
import type { AnomalyEvent } from "@/core/watch/anomaly";
import { WatchChart } from "./WatchChart";

const ALL = Object.keys(GROUPS) as FaunaGroup[];
const SEEN = "h247-fauna-seen-v1";
const WATCH = "h247-fauna-watch-v1";
const EVERY_MS = 6 * 3600e3;
const ICON: Record<FaunaGroup, string> = { aves: "🐦", mamiferos: "🦊", anfibios: "🐸", reptiles: "🦎", insectos: "🐝", mariposas: "🦋" };

export interface FaunaPlace { name: string; lat: number; lon: number; box?: Box }

const C = {
  es: {
    title: "Señales de fauna", place: "Lugar", size: "Área", check: "Revisar los 6 grupos", checking: "Revisando…",
    watch: "Vigilar y avisarme", watching: "Vigilando (cada 6 h con la página abierta)", stop: "Dejar de vigilar",
    other: "Otro lugar", go: "Usar", bad: "No reconocí ese lugar. Escribe sus coordenadas, por ejemplo: 24.5, -104.6",
    since: (t: string) => `desde ${t}`, rate: "reportes por cada 1000 observaciones",
    noChange: "Sin desviaciones en los últimos 12 meses frente a su propio pasado.",
    thin: "Muy pocas observaciones aquí para juzgar (meses con menos de 30 reportes en total no cuentan).",
    shift: (dir: string, pct: string, from: string) => `Cambio sostenido ${dir === "bajo" ? "a la baja" : "al alza"} ${from}: ${pct} en la tasa de reporte.`,
    spike: (dir: string, t: string, z: string) => `Mes fuera de lo común (${dir === "bajo" ? "muy bajo" : "muy alto"}) en ${t}, z = ${z}.`,
    sev: { leve: "leve", media: "media", alta: "alta" },
    newAlerts: "Avisos nuevos", none: "Aún nada revisado.",
    honesty: "Esto mide cuánto se REPORTA cada grupo, dividido entre todo lo que se reporta ahí ese mes (así no cuenta que cada año haya más gente usando la app). Un cambio puede venir de los animales —más, menos, antes, en otro lugar— o de cómo busca la gente. HORI dice dónde, cuánto y desde cuándo; no dice por qué.",
    method: "Detector: el de anomalías de HORI (mismo código que en Python), mensual, con raíz cuadrada; punto |z| ≥ 3,5 y cambio sostenido por CUSUM. El mes en curso no se juzga.",
    zon: "Para vigilar sin la página abierta: «zon watch --config vigilancia.json --once» cada día (cron o systemd), con fuentes {\"monitor\": \"mon-aves-dgo\", \"fauna\": {\"box\": [...], \"group\": \"aves\"}}. Los avisos van a la bandeja o a un webhook.",
    source: "Datos: iNaturalist, observaciones verificables (ciencia ciudadana; licencia de cada observación).",
    notifTitle: (g: string, p: string) => `HORI · ${g} en ${p}`,
    error: "No se pudo leer iNaturalist (¿sin internet?).",
    summary: { changed: "Cambiaron", mild: "Leve", calm: "Estables", thin: "Pocos datos" },
    progress: (a: number, b: number) => `Revisando ${a} de ${b} grupos…`,
    again: "Revisar de nuevo", stable: "Estable", few: "Pocos datos", seen: "Lo que más se reporta aquí",
    reports: (n: string) => `${n} reportes`, how: "¿Cómo se calcula?", seenAt: (t: string) => `Revisado ${t}`,
  },
  en: {
    title: "Animal signals", place: "Place", size: "Area", check: "Check the 6 groups", checking: "Checking…",
    watch: "Watch and notify me", watching: "Watching (every 6 h while the page is open)", stop: "Stop watching",
    other: "Another place", go: "Use", bad: "Place not recognised. Try coordinates: 24.5, -104.6",
    since: (t: string) => `since ${t}`, rate: "reports per 1000 observations",
    noChange: "No departures in the last 12 months against its own past.",
    thin: "Too few observations here to judge (months with fewer than 30 reports in total do not count).",
    shift: (dir: string, pct: string, from: string) => `Sustained ${dir === "bajo" ? "drop" : "rise"} ${from}: ${pct} in the reporting rate.`,
    spike: (dir: string, t: string, z: string) => `Unusual month (${dir === "bajo" ? "very low" : "very high"}) in ${t}, z = ${z}.`,
    sev: { leve: "mild", media: "medium", alta: "high" },
    newAlerts: "New notices", none: "Nothing checked yet.",
    honesty: "This measures how often each group is REPORTED, divided by everything reported there that month (so more app users each year does not count). A change can come from the animals — more, fewer, earlier, elsewhere — or from how people look. HORI says where, how much and since when; not why.",
    method: "Detector: HORI's anomaly detector (same code as in Python), monthly, square root; point |z| ≥ 3.5 and sustained shift by CUSUM. The current month is not judged.",
    zon: "To watch without the page open: «zon watch --config watch.json --once» daily (cron or systemd), with sources {\"monitor\": \"mon-birds\", \"fauna\": {\"box\": [...], \"group\": \"aves\"}}. Notices go to the inbox or a webhook.",
    source: "Data: iNaturalist, verifiable observations (citizen science; each observation's licence).",
    notifTitle: (g: string, p: string) => `HORI · ${g} at ${p}`,
    error: "Could not read iNaturalist (offline?).",
    summary: { changed: "Changed", mild: "Mild", calm: "Stable", thin: "Too few data" },
    progress: (a: number, b: number) => `Checking ${a} of ${b} groups…`,
    again: "Check again", stable: "Stable", few: "Too few data", seen: "Most reported here",
    reports: (n: string) => `${n} reports`, how: "How is it computed?", seenAt: (t: string) => `Checked ${t}`,
  },
};

const eventId = (s: FaunaSignal, e: AnomalyEvent) => `${s.group}|${s.box.map((x) => x.toFixed(2)).join(",")}|${e.type}|${e.tStart}`;

function readSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]); } catch { return new Set(); }
}
function writeSet(key: string, s: Set<string>): void {
  try { localStorage.setItem(key, JSON.stringify([...s].slice(-500))); } catch { /* not kept: fine */ }
}

/** One sentence per group: the latest sustained shift (with its size), else the latest unusual month, else calm. */
export function faunaLine(s: FaunaSignal, lang: Lang): { text: string; level: "leve" | "media" | "alta" | null } {
  const c = C[lang];
  const judged = s.values.filter(Number.isFinite).length;
  if (judged < 36) return { text: c.thin, level: null };
  const r = s.recent;
  if (!r) return { text: c.noChange, level: null };
  if (r.type === "cambio_nivel" && s.change) {
    const pct = `${s.change.pct > 0 ? "+" : "−"}${num(Math.abs(s.change.pct), lang, 0)} % (${num(s.change.before, lang, 0)} → ${num(s.change.after, lang, 0)})`;
    return { text: c.shift(r.direction ?? "alto", pct, c.since(r.tStart)), level: r.severity };
  }
  if (r.type === "punto" || r.type === "racha") return { text: c.spike(r.direction ?? "alto", r.tStart, num(r.peakZ ?? NaN, lang, 1)), level: r.severity };
  return { text: c.noChange, level: null };
}

const RANK = { alta: 3, media: 2, leve: 1 } as const;

/**
 * One group of animals at a place: what happened (sentence + big change), its chart and the species reported most.
 * Shared by the panel and by the assistant, which prints it inside the conversation when it matters.
 */
export function FaunaGroupCard({ g, s, species, lang }: { g: FaunaGroup; s: FaunaSignal; species?: TopSpecies[]; lang: Lang }) {
  const c = C[lang];
  const line = faunaLine(s, lang);
  return (
    <article className={`rounded-2xl border p-3 ${line?.level === "media" || line?.level === "alta" ? "border-accent" : "border-border"}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl">{ICON[g]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{GROUPS[g][lang]}</h3>
            {line?.level ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${line.level === "leve" ? "bg-surface-2 text-text-2" : "bg-accent text-on-accent"}`}>{c.sev[line.level]}</span> : null}
          </div>
          <p className="mt-0.5 text-sm leading-snug text-text-2">{line?.text}</p>
        </div>
        <div className="shrink-0 text-right">
          {s.change && line?.level ? (
            <p className="tabular text-2xl font-semibold leading-none">{s.change.pct > 0 ? "↑" : "↓"}{num(Math.abs(s.change.pct), lang, 0)}%</p>
          ) : (
            <p className="text-xs font-semibold text-text-3">{line?.text === c.thin ? c.few : c.stable}</p>
          )}
        </div>
      </div>
      <WatchChart values={s.values} labels={s.times} events={s.events} label={`${GROUPS[g][lang]} · ${c.rate}`} height={80} />
      <p className="mt-1 text-[11px] text-text-3">{c.rate}</p>
      {species?.length ? (
        <div className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-3">{c.seen}</p>
          <ul className="mt-1 grid grid-cols-3 gap-2">
            {species.map((t) => (
              <li key={t.scientific}>
                <a href={t.url} target="_blank" rel="noreferrer" className="group block">
                  {t.photo ? <img src={t.photo} alt="" loading="lazy" width={75} height={75} className="h-20 w-full rounded-lg bg-surface-2 object-cover" /> : <span className="block h-20 w-full rounded-lg bg-surface-2" />}
                  <span className="mt-1 block truncate text-xs font-medium group-hover:underline">{t.name}</span>
                  <span className="block text-[11px] text-text-3">{c.reports(num(t.count, lang, 0))}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

export function FaunaPanel({ place, lang }: { place: FaunaPlace; lang: Lang }) {
  const c = C[lang];
  const [where, setWhere] = useState<FaunaPlace>(place);
  const [half, setHalf] = useState(0.5);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [signals, setSignals] = useState<Partial<Record<FaunaGroup, FaunaSignal>>>({});
  const [species, setSpecies] = useState<Partial<Record<FaunaGroup, TopSpecies[]>>>({});
  const [fresh, setFresh] = useState<string[]>([]);
  const [watching, setWatching] = useState(() => { try { return localStorage.getItem(WATCH) === "1"; } catch { return false; } });
  const [prevPlace, setPrevPlace] = useState(place);
  if (place !== prevPlace) { setPrevPlace(place); setWhere(place); setSignals({}); setSpecies({}); }

  const box: Box = useMemo(() => where.box ?? boxAround(where.lat, where.lon, half), [where, half]);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (notify: boolean) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true); setErr(false);
    const seen = readSet(SEEN);
    const news: string[] = [];
    // one group at a time: 2 small requests each, gentle with the API and with the laptop
    for (const g of ALL) {
      try {
        const s = await watchFauna(g, box, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        setSignals((prev) => ({ ...prev, [g]: s }));
        topSpecies(g, box, lang, ctrl.signal).then((t) => { if (!ctrl.signal.aborted) setSpecies((prev) => ({ ...prev, [g]: t })); }).catch(() => {});
        if (s.recent && s.recent.severity !== "leve") {
          const id = eventId(s, s.recent);
          if (!seen.has(id)) {
            seen.add(id);
            const line = faunaLine(s, lang).text;
            news.push(`${GROUPS[g][lang]}: ${line}`);
            if (notify && typeof Notification !== "undefined" && Notification.permission === "granted") {
              try { new Notification(c.notifTitle(GROUPS[g][lang], where.name), { body: line, tag: id }); } catch { /* some browsers need a service worker */ }
            }
          }
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (!(e instanceof DOMException)) setErr(true);
      }
    }
    writeSet(SEEN, seen);
    if (news.length) setFresh((f) => [...news, ...f].slice(0, 12));
    setBusy(false);
  }, [box, lang, where.name, c]);

  // Watching: re-check every 6 h and when the page comes back; nothing runs while it is hidden.
  useEffect(() => {
    if (!watching) return;
    const tick = () => { if (!document.hidden) void run(true); };
    const id = window.setInterval(tick, EVERY_MS);
    const vis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", vis);
    const first = window.setTimeout(tick, 0);
    return () => { window.clearInterval(id); window.clearTimeout(first); document.removeEventListener("visibilitychange", vis); };
  }, [watching, run]);
  useEffect(() => () => abort.current?.abort(), []);
  // Open = look: the panel checks the place by itself (12 small requests, cached 6 h), no empty state to click through.
  useEffect(() => { if (!watching) void run(false); }, [box]); // eslint-disable-line react-hooks/exhaustive-deps -- once per place

  const toggleWatch = async () => {
    const on = !watching;
    if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch { /* the panel list still works */ }
    }
    setWatching(on);
    try { localStorage.setItem(WATCH, on ? "1" : "0"); } catch { /* fine */ }
  };

  const use = () => {
    const p = findPlace(draft) as Where | null;
    const m = draft.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[ ,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    const q = p ?? (m ? { name: `${m[1]}, ${m[2]}`, lat: Number(m[1].replace(",", ".")), lon: Number(m[2].replace(",", ".")) } : null);
    if (!q || !(Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180)) { setBad(true); return; }
    setWhere({ name: q.name, lat: q.lat, lon: q.lon }); setSignals({}); setSpecies({}); setDraft(""); setBad(false);
  };

  const rows = ALL.map((g) => ({ g, s: signals[g] ?? null, line: signals[g] ? faunaLine(signals[g]!, lang) : null }))
    .sort((a, b) => (b.line?.level ? RANK[b.line.level] : 0) - (a.line?.level ? RANK[a.line.level] : 0)
      || Math.abs(b.s?.change?.pct ?? 0) - Math.abs(a.s?.change?.pct ?? 0));

  const done = Object.keys(signals).length;
  const tally = { changed: 0, mild: 0, calm: 0, thin: 0 };
  for (const r of rows) if (r.line) {
    if (r.line.level === "media" || r.line.level === "alta") tally.changed++;
    else if (r.line.level === "leve") tally.mild++;
    else if (r.line.text === c.thin) tally.thin++;
    else tally.calm++;
  }
  const last = Math.max(0, ...Object.values(signals).map((x) => x?.fetchedAt ?? 0));

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <section>
        <h2 className="sr-only">{c.title}</h2>
        <div className="flex items-baseline gap-2">
          <p className="text-lg font-semibold leading-tight">{where.name}</p>
          <p className="tabular text-xs text-text-3">{num(box[1], lang, 2)}…{num(box[3], lang, 2)}°, {num(box[0], lang, 2)}…{num(box[2], lang, 2)}°</p>
        </div>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); use(); }}>
          <input value={draft} onChange={(e) => { setDraft(e.target.value); setBad(false); }} placeholder={c.other} aria-label={c.other}
            className="min-w-0 flex-1 rounded-xl border border-border-control bg-surface px-3 py-1.5 text-sm" />
          {where.box ? null : (
            <select value={half} aria-label={c.size} onChange={(e) => { setHalf(Number(e.target.value)); setSignals({}); setSpecies({}); }} className="rounded-xl border border-border bg-surface px-2 text-sm">
              <option value={0.25}>~55 km</option><option value={0.5}>~110 km</option><option value={1}>~220 km</option><option value={2}>~440 km</option>
            </select>
          )}
          <button type="submit" className="rounded-xl border border-border px-3 text-sm">{c.go}</button>
        </form>
        {bad ? <p className="mt-1 text-xs text-text-2">{c.bad}</p> : null}
        {err ? <p role="alert" className="mt-2 text-sm text-text-2">{c.error}</p> : null}
      </section>

      <section aria-live="polite" className="rounded-2xl border border-border bg-surface p-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          {(["changed", "mild", "calm", "thin"] as const).map((k) => (
            <div key={k} className={`rounded-xl px-1 py-2 ${k === "changed" && tally.changed ? "bg-accent text-on-accent" : "bg-surface-2"}`}>
              <p className="tabular text-xl font-semibold leading-none">{done ? tally[k] : "–"}</p>
              <p className={`mt-1 text-[11px] leading-tight ${k === "changed" && tally.changed ? "opacity-85" : "text-text-2"}`}>{c.summary[k]}</p>
            </div>
          ))}
        </div>
        {busy ? (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(done / ALL.length) * 100}%` }} /></div>
            <p className="mt-1 text-xs text-text-3">{c.progress(done, ALL.length)}</p>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void run(false)} disabled={busy} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-60">
            {busy ? c.checking : done ? c.again : c.check}
          </button>
          <button type="button" onClick={() => void toggleWatch()} aria-pressed={watching}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${watching ? "bg-accent text-on-accent" : "border border-border text-text-2"}`}>
            {watching ? <><span className="live-dot" aria-hidden="true" />{c.watching}</> : c.watch}
          </button>
          {watching ? <button type="button" onClick={() => void toggleWatch()} className="text-xs underline underline-offset-2">{c.stop}</button> : null}
          {last && !busy ? <span className="ml-auto text-[11px] text-text-3">{c.seenAt(new Date(last).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }))}</span> : null}
        </div>
      </section>

      {fresh.length ? (
        <section aria-live="polite" className="rounded-2xl border border-accent p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-3">{c.newAlerts}</p>
          <ul className="mt-1 space-y-1 text-sm">{fresh.map((f, k) => <li key={k}>{f}</li>)}</ul>
        </section>
      ) : null}

      <section className="space-y-3">
        {rows.map(({ g, s }) => s ? (
          <FaunaGroupCard key={g} g={g} s={s} species={species[g]} lang={lang} />
        ) : busy ? (
          <div key={g} className="flex items-center gap-3 rounded-2xl border border-border p-3 opacity-60">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-xl">{ICON[g]}</span>
            <span className="text-sm text-text-2">{GROUPS[g][lang]} …</span>
          </div>
        ) : null)}
      </section>

      <section className="space-y-2 text-xs leading-5 text-text-2">
        <p className="text-text-3">{c.source}</p>
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer font-semibold text-text">{c.how}</summary>
          <div className="mt-2 space-y-2">
            <p>{c.honesty}</p>
            <p>{c.method}</p>
            <p className="text-text-3">{c.zon}</p>
          </div>
        </details>
      </section>
    </div>
  );
}
