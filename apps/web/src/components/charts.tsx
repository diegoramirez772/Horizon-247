"use client";

// Charts that live INSIDE the conversation (Plan de unión U4). Plain SVG, no library: they scale to the card,
// read in light and dark, and every mark is a number HORI or NASA gave (nothing is smoothed or invented).

import type { Lang } from "@/core/i18n/texts";

const fmt = (x: number, lang: Lang, d = 1) =>
  x.toLocaleString(lang === "es" ? "es-ES" : "en-US", { maximumFractionDigits: d, minimumFractionDigits: 0, useGrouping: false });

/**
 * Yearly values as bars above / below zero (warmer / cooler than normal), the trend HORI measured as a line, and
 * the range of likely trends as a fan around it. With `known`, a mark on the year the change became knowable.
 */
export function TrendChart({ years, values, effect, lo, hi, unit, lang, showFan, known = null, label }: {
  years: number[]; values: number[]; effect: number; lo: number; hi: number; unit: string; lang: Lang;
  showFan: boolean; known?: number | null; label: string;
}) {
  const pts = values.map((v, i) => ({ x: years[i] ?? i, y: v })).filter((p) => Number.isFinite(p.y));
  if (pts.length < 3) return null;
  const W = 420, H = 150, padL = 30, padR = 8, padT = 10, padB = 20;
  const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
  const slope = Number.isFinite(effect) ? effect / 10 : 0;
  // The line goes through the median point of the series (robust, like Sen's estimator).
  const xm = (x0 + x1) / 2;
  const ym = median(pts.map((p) => p.y - slope * (p.x - xm)));
  const line = (s: number, x: number) => ym + s * (x - xm);
  const ys = pts.map((p) => p.y).concat([line(slope, x0), line(slope, x1)]);
  if (showFan && Number.isFinite(lo) && Number.isFinite(hi)) ys.push(line(lo / 10, x0), line(hi / 10, x1), line(hi / 10, x0), line(lo / 10, x1));
  const yLo = Math.min(0, ...ys), yHi = Math.max(0, ...ys);
  const span = yHi - yLo || 1;
  const X = (x: number) => padL + ((x - x0) / Math.max(1, x1 - x0)) * (W - padL - padR);
  const Y = (y: number) => padT + (1 - (y - yLo) / span) * (H - padT - padB);
  const bw = Math.max(1.5, ((W - padL - padR) / pts.length) * 0.7);
  const tick = niceStep(span / 3);
  const ticks: number[] = [];
  for (let t = Math.ceil(yLo / tick) * tick; t <= yHi + 1e-9; t += tick) ticks.push(Math.round(t / tick) * tick);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.2 : 0.6} />
          <text x={padL - 4} y={Y(t) + 3} textAnchor="end" fontSize="9" fill="var(--text-3)">{t > 0 ? "+" : ""}{fmt(t, lang, 2)}</text>
        </g>
      ))}
      {showFan && Number.isFinite(lo) && Number.isFinite(hi) ? (
        <path d={`M${X(x0)} ${Y(line(lo / 10, x0))}L${X(x1)} ${Y(line(lo / 10, x1))}L${X(x1)} ${Y(line(hi / 10, x1))}L${X(x0)} ${Y(line(hi / 10, x0))}Z`}
          fill="var(--text-3)" opacity="0.13" />
      ) : null}
      {pts.map((p) => (
        <rect key={p.x} x={X(p.x) - bw / 2} width={bw} y={Math.min(Y(p.y), Y(0))} height={Math.max(0.8, Math.abs(Y(p.y) - Y(0)))} rx="1"
          fill={p.y >= 0 ? "var(--warm)" : "var(--cool)"} opacity="0.85" />
      ))}
      {slope !== 0 ? <line x1={X(x0)} x2={X(x1)} y1={Y(line(slope, x0))} y2={Y(line(slope, x1))} stroke="var(--text)" strokeWidth="1.8" strokeDasharray="5 3" /> : null}
      {known !== null && known >= x0 && known <= x1 ? (
        <g>
          <line x1={X(known)} x2={X(known)} y1={padT} y2={H - padB} stroke="var(--text)" strokeWidth="1" />
          <text x={X(known) + 3} y={padT + 8} fontSize="9" fill="var(--text)">{lang === "es" ? `se supo en ${known}` : `known in ${known}`}</text>
        </g>
      ) : null}
      <text x={padL} y={H - 5} fontSize="9" fill="var(--text-3)">{x0}</text>
      <text x={W - padR} y={H - 5} fontSize="9" fill="var(--text-3)" textAnchor="end">{x1}</text>
      <text x={(padL + W - padR) / 2} y={H - 5} fontSize="9" fill="var(--text-3)" textAnchor="middle">{unit}</text>
    </svg>
  );
}

/** Daily bars with coloured levels and threshold lines (THI, rain…). */
export function LevelBars({ items, thresholds, max, label, lang, unit }: {
  items: { key: string; value: number; color: string; title: string }[];
  thresholds: { value: number; color: string; label: string }[];
  max?: number; label: string; lang: Lang; unit?: string;
}) {
  if (!items.length) return null;
  const W = 420, H = 120, padL = 26, padR = 6, padT = 8, padB = 16;
  const vals = items.map((i) => i.value);
  const lo = Math.min(...vals, ...thresholds.map((t) => t.value)) - 2;
  const hi = max ?? Math.max(...vals, ...thresholds.map((t) => t.value)) + 2;
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const step = (W - padL - padR) / items.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
      {thresholds.map((t) => (
        <g key={t.label}>
          <line x1={padL} x2={W - padR} y1={Y(t.value)} y2={Y(t.value)} stroke={t.color} strokeWidth="0.8" strokeDasharray="3 3" />
          <text x={padL - 3} y={Y(t.value) + 3} textAnchor="end" fontSize="8.5" fill={t.color}>{fmt(t.value, lang, 0)}</text>
        </g>
      ))}
      {items.map((it, k) => (
        <rect key={it.key} x={padL + k * step + step * 0.15} width={step * 0.7} y={Y(it.value)} height={Math.max(1, H - padB - Y(it.value))} rx="1.5" fill={it.color}>
          <title>{it.title}</title>
        </rect>
      ))}
      <text x={padL} y={H - 3} fontSize="8.5" fill="var(--text-3)">{short(items[0].key)}</text>
      <text x={W - padR} y={H - 3} fontSize="8.5" fill="var(--text-3)" textAnchor="end">{short(items.at(-1)!.key)}</text>
      {unit ? <text x={(padL + W - padR) / 2} y={H - 3} fontSize="8.5" fill="var(--text-3)" textAnchor="middle">{unit}</text> : null}
    </svg>
  );
}

/** A small line for a few weeks of daily values, with min and max marked. */
export function DailyLine({ values, dates, color, label, lang, unit }: {
  values: (number | null)[]; dates: string[]; color: string; label: string; lang: Lang; unit: string;
}) {
  const pts = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2) return null;
  const W = 150, H = 46, pad = 4;
  const lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  const X = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (W - 2 * pad);
  const Y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * pad - 8);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${X(p.i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${fmt(lo, lang)}–${fmt(hi, lang)} ${unit}, ${dates[0]} – ${dates.at(-1)}`} className="h-auto w-full">
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(last.i)} cy={Y(last.v)} r="2.6" fill={color} />
      <text x={pad} y={H - 1} fontSize="8" fill="var(--text-3)">{fmt(lo, lang)}–{fmt(hi, lang)} {unit}</text>
    </svg>
  );
}

/** "2026-11-12" → "11-12"; other keys stay as they are. */
const short = (k: string) => (/^\d{4}-\d\d-\d\d$/.test(k) ? k.slice(5) : k);

function median(a: number[]): number {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x || 1));
  const f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
