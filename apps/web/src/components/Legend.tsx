"use client";

import type { Verdict } from "@/contract/types";
import type { Ctx } from "@/core/assistant/compose";
import { count, num } from "@/core/format/format";
import { LEGEND } from "@/core/i18n/texts";
import type { MapData } from "@/core/map/MapView";
import type { MapTheme } from "@/core/map/palette";

const T = {
  es: {
    all: "Ver todo",
    tapHint: "Toca una opción para ver solo esa parte del mapa",
    lohi: (blue: boolean) => (blue ? ["menos", "más"] : ["baja", "sube"]),
    descriptive: "Cada zona tiene el color de su valor ese año. Es descriptivo: no hay veredicto.",
    plain: [
      { vs: [1], label: "Ya cambió", hint: "El cambio es real: se distingue de las variaciones normales" },
      { vs: [2, 3], label: "Aún no se sabe", hint: "Rayado o punteado: con estos años todavía no se puede afirmar" },
      { vs: [4], label: "No cambió mucho", hint: "Si hubiera un cambio grande, se habría notado" },
      { vs: [0], label: "Sin datos", hint: "Faltan años con datos en esta zona" },
    ],
    colorPlain: "El color dice si sube o baja, y cuánto",
    effectNote: "Efecto estimado en todas las zonas · sin veredicto",
    mdeNote: "Cambio mínimo que se podría detectar con estos años · valores altos = solo se notaría un cambio grande",
    yearsNote: "Años de datos que faltan para descartar un cambio ≥ δ · solo zonas «aún no»",
    years: "años",
  },
  en: {
    all: "Show all",
    tapHint: "Tap an option to see only that part of the map",
    lohi: (blue: boolean) => (blue ? ["less", "more"] : ["falling", "rising"]),
    descriptive: "Each area has the colour of its value that year. It is descriptive: there is no verdict.",
    plain: [
      { vs: [1], label: "It changed", hint: "The change is real: it stands out from normal variation" },
      { vs: [2, 3], label: "Not known yet", hint: "Striped or dotted: with these years it cannot be stated yet" },
      { vs: [4], label: "Did not change much", hint: "A large change would have shown up" },
      { vs: [0], label: "No data", hint: "Not enough years with data here" },
    ],
    colorPlain: "Colour shows whether it rises or falls, and how much",
    effectNote: "Estimated effect in every area · no verdict",
    mdeNote: "Smallest change detectable with these years · high values = only a large change would show",
    yearsNote: "Years of data still needed to rule out a change ≥ δ · “not yet” areas only",
    years: "years",
  },
};

const KEY: Record<Verdict, string> = { 0: "insuficiente", 1: "probado", 2: "candidata", 3: "no_concluyente", 4: "sin_cambio" };
const CODE: Record<Verdict, string> = { 0: "INSUFICIENTE", 1: "PROBADO", 2: "CANDIDATA", 3: "NO_CONCLUYENTE", 4: "SIN_CAMBIO" };

/**
 * The key, docked under the map (always visible next to the data, doc 03 §7). Plain: three ideas in everyday
 * words. Expert: the five contract verdicts with their codes, numeric scales and one key per metric.
 */
export function LegendBar({ ctx, theme, blueIsMore, data, onFilter }: {
  ctx: Ctx; theme: MapTheme; blueIsMore: boolean; data: MapData | null; onFilter: (f: number[] | null) => void;
}) {
  const { lang, filter, timeMode, register, metric } = ctx.state;
  const t = T[lang];
  const m = ctx.layer?.manifest;
  if (!m) return null;
  const expert = register === "tecnico";
  const div = [...[...(blueIsMore ? theme.red : theme.blue)].reverse(), ...(blueIsMore ? theme.blue : theme.red)];
  const [lo, hi] = t.lohi(blueIsMore);
  const upd = m.variable.unit_per_decade;
  const frame = "border-t border-border bg-surface px-3 py-2";

  // Year by year, or the expert "effect" metric: a signed scale.
  if (timeMode === "anual" || (timeMode === "completa" && metric === "effect")) {
    const scale = data?.scale ?? NaN;
    return (
      <div className={`${frame} flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm`}>
        <Ramp colours={div} left={expert && Number.isFinite(scale) ? `−${num(scale, lang)}` : lo} right={expert && Number.isFinite(scale) ? `+${num(scale, lang)} ${timeMode === "anual" ? m.variable.unit : upd}` : hi} />
        <span className="text-text-2">{timeMode === "anual" ? t.descriptive : t.effectNote}</span>
      </div>
    );
  }
  // Expert sequential metrics.
  if (timeMode === "completa" && (metric === "mde" || metric === "years")) {
    const [a, b] = data?.range ?? [0, 1];
    return (
      <div className={`${frame} flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm`}>
        <Ramp colours={[...theme.seq]} left={metric === "years" ? `${Math.round(a)} ${t.years}` : `${num(a, lang)}`}
          right={metric === "years" ? `${b >= 61 ? "60+" : Math.round(b)} ${t.years}` : `${num(b, lang)} ${upd}`} />
        <span className="text-text-2">{metric === "mde" ? t.mdeNote : t.yearsNote}</span>
      </div>
    );
  }

  const counts = timeMode === "completa";
  const isOn = (vs: number[]) => !!filter && vs.length === filter.length && vs.every((v) => filter.includes(v));

  if (!expert) {
    return (
      <div className={frame}>
        <ul className="grid grid-cols-2 gap-1 xl:grid-cols-4" aria-label={t.tapHint}>
          {t.plain.map((row) => {
            const on = isOn(row.vs);
            const n = row.vs.reduce((acc, v) => acc + (m.summary[KEY[v as Verdict]] ?? 0), 0);
            return (
              <li key={row.label}>
                <button type="button" aria-pressed={on} onClick={() => onFilter(on ? null : row.vs)} title={row.hint}
                  className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-2.5 text-left transition-colors ${
                    on ? "border-text bg-surface-2" : "border-transparent hover:bg-surface-2"} ${filter && !on ? "opacity-45" : ""}`}>
                  <PlainSwatch vs={row.vs} theme={theme} ramp={div} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-sm font-semibold">{row.label}</span>
                    {counts ? <span className="tabular block text-xs text-text-3">{count(n, lang)} {lang === "es" ? "zonas" : "areas"}</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-text-3">
          <span className="flex items-center gap-2">{t.colorPlain} <Ramp colours={div} left={lo} right={hi} small /></span>
          {filter ? <button type="button" onClick={() => onFilter(null)} className="font-semibold text-text underline underline-offset-4">{t.all}</button> : <span>{t.tapHint}</span>}
        </div>
      </div>
    );
  }

  const scale = data?.scale ?? NaN;
  return (
    <div className={frame}>
      <ul className="grid grid-cols-2 gap-x-1 2xl:grid-cols-3" aria-label={t.tapHint}>
        {([1, 2, 3, 4, 0] as Verdict[]).map((v) => {
          const on = isOn([v]);
          const n = m.summary[KEY[v]];
          return (
            <li key={v}>
              <button type="button" aria-pressed={on} onClick={() => onFilter(on ? null : [v])} title={LEGEND[lang][v].phrase}
                className={`flex min-h-9 w-full items-center gap-2 rounded-lg border px-2 text-left transition-colors ${
                  on ? "border-text bg-surface-2" : "border-transparent hover:bg-surface-2"} ${filter && !on ? "opacity-45" : ""}`}>
                <Swatch v={v} theme={theme} ramp={div} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold tracking-wide">{CODE[v]}</span>
                {counts && Number.isFinite(n) ? <span className="tabular text-xs text-text-3">{count(n, lang)}</span> : null}
              </button>
            </li>
          );
        })}
        <li className="flex min-h-9 items-center gap-2 px-2 text-xs text-text-3">
          {filter ? <button type="button" onClick={() => onFilter(null)} className="whitespace-nowrap font-semibold text-text underline underline-offset-4">{t.all}</button> : null}
          <Ramp colours={div} left={Number.isFinite(scale) ? `−${num(scale, lang)}` : lo} right={Number.isFinite(scale) ? `+${num(scale, lang)}` : hi} small />
        </li>
      </ul>
    </div>
  );
}

function Ramp({ colours, left, right, small = false }: { colours: string[]; left: string; right: string; small?: boolean }) {
  return (
    <span className="tabular inline-flex shrink-0 items-center gap-2 text-xs text-text-3">
      <span>{left}</span>
      <span className={`flex overflow-hidden rounded-full ${small ? "h-2 w-16" : "h-2.5 w-36"}`}>
        {colours.map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}
      </span>
      <span>{right}</span>
    </span>
  );
}

function PlainSwatch({ vs, theme, ramp }: { vs: number[]; theme: MapTheme; ramp: string[] }) {
  if (vs.length === 2) {
    // «Aún no se sabe» covers two textures: show both, side by side.
    return (
      <span className="flex shrink-0 overflow-hidden rounded-md">
        <Swatch v={3} theme={theme} ramp={ramp} half />
        <Swatch v={2} theme={theme} ramp={ramp} half />
      </span>
    );
  }
  return <Swatch v={vs[0] as Verdict} theme={theme} ramp={ramp} />;
}

export function Swatch({ v, theme, ramp, half = false }: { v: Verdict; theme: MapTheme; ramp: string[]; half?: boolean }) {
  const id = `sw-${v}-${half ? "h" : "f"}`;
  const w = half ? 15 : 30;
  return (
    <svg width={half ? 12 : 24} height="18" viewBox={`0 0 ${w} 22`} aria-hidden="true" className={`shrink-0 overflow-hidden ${half ? "" : "rounded-md"}`}>
      <defs>
        <pattern id={`${id}-fog`} width="9.9" height="9.9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="9.9" height="9.9" fill={theme.ocean} />
          <rect width="9.9" height="9.9" fill={theme.ink} opacity="0.1" />
          <line x1="0" y1="0" x2="0" y2="9.9" stroke={theme.ink} strokeWidth="1.5" opacity={theme.inkAlpha} />
        </pattern>
        <pattern id={`${id}-dot`} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill={theme.ocean} />
          <circle cx="3" cy="3" r="1" fill={theme.ink} opacity={Math.min(1, theme.inkAlpha + 0.3)} />
        </pattern>
      </defs>
      {v === 1 ? (<><rect width={w / 2} height="22" fill={ramp[1]} /><rect x={w / 2} width={w / 2} height="22" fill={ramp[4]} /></>)
        : v === 2 ? <rect width={w} height="22" fill={`url(#${id}-dot)`} />
        : v === 3 ? <rect width={w} height="22" fill={`url(#${id}-fog)`} />
        : v === 4 ? <rect width={w} height="22" fill={theme.noChange} />
        : <rect x="0.75" y="0.75" width={w - 1.5} height="20.5" rx="4" fill={theme.ocean} stroke={theme.ink} strokeOpacity="0.6" strokeWidth="1.2" strokeDasharray="3 2" />}
    </svg>
  );
}
