"use client";

// A watched stream and what HORI's detector flagged on it: the line is the data as it came (gaps stay gaps), shaded bands
// are sustained shifts, dots are one-off values, hatched bands are missing data. Plain SVG, every mark is a number.

import type { AnomalyEvent } from "@/core/watch/anomaly";

export function WatchChart({ values, labels, events, label, height = 110 }: {
  values: number[]; labels: string[]; events: AnomalyEvent[]; label: string; height?: number;
}) {
  const n = values.length;
  const fin = values.filter(Number.isFinite);
  if (n < 3 || fin.length < 3) return null;
  const W = 420, H = height, padL = 4, padR = 4, padT = 6, padB = 16;
  const lo = Math.min(...fin), hi = Math.max(...fin), span = hi - lo || 1;
  const X = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  let d = "", pen = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) { pen = false; return; }
    d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    pen = true;
  });
  const band = (e: AnomalyEvent) => ({ x: X(e.start) - 1, w: Math.max(2, X(e.end) - X(e.start) + 2) });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
      <defs>
        <pattern id="wc-gap" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="currentColor" strokeWidth="1" opacity="0.35" />
        </pattern>
      </defs>
      {events.filter((e) => e.type === "cambio_nivel").map((e, k) => {
        const b = band(e);
        return <rect key={`s${k}`} x={b.x} y={padT} width={b.w} height={H - padT - padB} fill={e.direction === "bajo" ? "var(--cool)" : "var(--warm)"} opacity="0.18" />;
      })}
      {events.filter((e) => e.type === "sin_datos").map((e, k) => {
        const b = band(e);
        return <rect key={`g${k}`} x={b.x} y={padT} width={b.w} height={H - padT - padB} fill="url(#wc-gap)" className="text-text-3" />;
      })}
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" className="text-text-2" />
      {events.filter((e) => e.type === "punto" || e.type === "racha").flatMap((e) => {
        const out = [];
        for (let i = e.start; i <= e.end; i++) if (Number.isFinite(values[i])) out.push(<circle key={`p${e.start}-${i}`} cx={X(i)} cy={Y(values[i])} r="3.2" fill={e.direction === "bajo" ? "var(--cool)" : "var(--warm)"} stroke="var(--surface)" strokeWidth="1" />);
        return out;
      })}
      <text x={padL} y={H - 3} fontSize="10" className="fill-current text-text-3">{labels[0]}</text>
      <text x={W - padR} y={H - 3} fontSize="10" textAnchor="end" className="fill-current text-text-3">{labels[n - 1]}</text>
    </svg>
  );
}
