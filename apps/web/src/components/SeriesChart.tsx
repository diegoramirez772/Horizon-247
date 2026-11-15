"use client";

import { trendLine } from "@/core/format/format";
import { num } from "@/core/format/format";
import { UI, type Lang } from "@/core/i18n/texts";

/**
 * Yearly series as SVG (24–45 points do not justify a library, web-diseno §3.3), with the line of the
 * bundle's slope. Monochrome: the interface is black and white; colour is reserved for the map.
 */
export function SeriesChart({ values, years, effect, unit, lang, showTrend }: {
  values: number[]; years: number[]; effect: number; unit: string; lang: Lang; showTrend: boolean;
}) {
  const T = UI[lang];
  const pts = values.map((v, i) => [years[i], v] as const).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 2) return <p className="text-sm text-text-2">{T.noSeries}</p>;

  const W = 320, H = 140, L = 40, R = 8, Tp = 10, B = 24;
  const ys = pts.map(([, v]) => v);
  const line = showTrend ? trendLine(values, years, effect) : null;
  const all = line ? [...ys, line[0][1], line[1][1]] : ys;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x0 = years[0], x1 = years[years.length - 1];
  const px = (x: number) => L + ((x - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const py = (y: number) => Tp + (1 - (y - lo) / (hi - lo)) * (H - Tp - B);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join("");

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full text-text" role="img"
        aria-label={`${T.series}: ${x0}–${x1}, ${num(Math.min(...ys), lang)} … ${num(Math.max(...ys), lang)} ${unit}`}>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--border-control)" strokeWidth="1" />
        <line x1={L} x2={L} y1={Tp} y2={H - B} stroke="var(--border)" strokeWidth="1" />
        <text x={L - 6} y={py(hi - pad) + 4} textAnchor="end" fontSize="11" fill="var(--text-2)" className="tabular">{num(hi - pad, lang, 1)}</text>
        <text x={L - 6} y={py(lo + pad) + 4} textAnchor="end" fontSize="11" fill="var(--text-2)" className="tabular">{num(lo + pad, lang, 1)}</text>
        <text x={L} y={H - 6} fontSize="11" fill="var(--text-2)" className="tabular">{x0}</text>
        <text x={W - R} y={H - 6} textAnchor="end" fontSize="11" fill="var(--text-2)" className="tabular">{x1}</text>
        {line ? (
          <line x1={px(line[0][0])} y1={py(line[0][1])} x2={px(line[1][0])} y2={py(line[1][1])}
            stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
        ) : null}
        <path d={path} fill="none" stroke="var(--text-2)" strokeWidth="1.25" />
        {pts.map(([x, y]) => <circle key={x} cx={px(x)} cy={py(y)} r="2" fill="currentColor" />)}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 text-xs text-text-2">
        <span>● {T.series} ({unit})</span>
        {line ? <span>– – {T.trend}</span> : null}
      </figcaption>
    </figure>
  );
}
