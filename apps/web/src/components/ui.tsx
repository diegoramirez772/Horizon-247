"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface Option<T extends string> { value: T; label: ReactNode; title?: string }

/** Arrow keys move between options (WAI-ARIA radio group / tabs pattern). */
function rovingKeys(e: KeyboardEvent<HTMLElement>, count: number, current: number, go: (i: number) => void): void {
  const k = e.key;
  let next = -1;
  if (k === "ArrowRight" || k === "ArrowDown") next = (current + 1) % count;
  else if (k === "ArrowLeft" || k === "ArrowUp") next = (current - 1 + count) % count;
  else if (k === "Home") next = 0;
  else if (k === "End") next = count - 1;
  if (next < 0) return;
  e.preventDefault();
  go(next);
}

/**
 * Segmented control. The selection is shown by FORM and WEIGHT (filled, bold), not only by colour
 * (doc 03 §7, WCAG 1.4.1). Targets are 40 px tall (doc 03 §7, WCAG 2.5.8).
 */
export function Segmented<T extends string>({ label, options, value, onChange, compact = false }: {
  label: string; options: Option<T>[]; value: T; onChange: (v: T) => void; compact?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-full border border-border bg-surface/60 p-1">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => rovingKeys(e, options.length, idx, (n) => { onChange(options[n].value); refs.current[n]?.focus(); })}
            className={`min-h-9 rounded-full text-sm transition-colors duration-150 ${compact ? "px-2.5" : "px-3.5"} ${
              on ? "bg-accent font-semibold text-on-accent shadow-sm" : "text-text-2 hover:bg-surface-2 hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Tabs (roving focus). The panel itself is rendered by the caller with id `${id}-panel`. */
export function Tabs<T extends string>({ id, label, options, value, onChange }: {
  id: string; label: string; options: Option<T>[]; value: T; onChange: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            id={`${id}-tab-${o.value}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`${id}-panel`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => rovingKeys(e, options.length, idx, (n) => { onChange(options[n].value); refs.current[n]?.focus(); })}
            className={`min-h-10 whitespace-nowrap border-b-2 px-3 text-sm ${
              on ? "border-text font-semibold text-text" : "border-transparent text-text-2 hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The mark: a planet's limb (the horizon), a satellite rising over it and its orbit.
 * One colour (currentColor), readable at 16 px, in both themes (doc 03 §1: "una línea y un punto", evolved).
 */
export function Mark({ size = 20 }: { size?: number }) {
  // A planet seen from orbit (filled limb) and a satellite rising along a dotted trail: "lo que aún no se ve".
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0" fill="none">
      <path d="M1 23C4.2 17.4 7.9 15.2 12 15.2s7.8 2.2 11 7.8z" fill="currentColor" />
      <path d="M3.6 13.2C6.4 9.6 9.8 7.6 13.4 7.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" strokeDasharray="0.1 2.7" />
      <circle cx="17.2" cy="7" r="2.8" fill="currentColor" />
    </svg>
  );
}

/**
 * 3D emblem: a lit planet with the monitoring grid (latitudes/meridians), an orbit that passes behind and in
 * front of it, and a glowing satellite. Graphite and light so it works on white and on black.
 */
export function Emblem({ size = 40 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  const g = (n: string) => `${n}-${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0" fill="none">
      <defs>
        <radialGradient id={g("sphere")} cx="36%" cy="30%" r="78%">
          <stop offset="0" stopColor="#B9C3D3" />
          <stop offset="0.28" stopColor="#5B6577" />
          <stop offset="0.62" stopColor="#1A1E27" />
          <stop offset="1" stopColor="#05060A" />
        </radialGradient>
        <radialGradient id={g("atmo")} cx="50%" cy="50%" r="50%">
          <stop offset="0.78" stopColor="#8FB8FF" stopOpacity="0" />
          <stop offset="0.9" stopColor="#8FB8FF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#8FB8FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={g("ring")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.15" />
          <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="1" stopColor="#CFE0FF" stopOpacity="0.5" />
        </linearGradient>
        <clipPath id={g("ball")}><circle cx="32" cy="32" r="19" /></clipPath>
        <clipPath id={g("front")}><rect x="-10" y="32" width="84" height="40" transform="rotate(-16 32 32)" /></clipPath>
        <filter id={g("glow")} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" /></filter>
      </defs>
      {/* atmosphere halo */}
      <circle cx="32" cy="32" r="23.5" fill={`url(#${g("atmo")})`} />
      {/* orbit, back half (behind the planet) */}
      <ellipse cx="32" cy="32" rx="29" ry="9" transform="rotate(-16 32 32)" stroke="#9AA6BA" strokeOpacity="0.45" strokeWidth="1.4" />
      {/* planet */}
      <circle cx="32" cy="32" r="19" fill={`url(#${g("sphere")})`} />
      <g clipPath={`url(#${g("ball")})`} stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="0.8">
        <ellipse cx="32" cy="32" rx="19" ry="6" />
        <ellipse cx="32" cy="24" rx="16" ry="4.2" />
        <ellipse cx="32" cy="40" rx="16" ry="4.2" />
        <ellipse cx="32" cy="32" rx="7" ry="19" />
        <ellipse cx="32" cy="32" rx="14" ry="19" />
      </g>
      {/* specular highlight */}
      <ellipse cx="25" cy="22" rx="6" ry="3.6" transform="rotate(-30 25 22)" fill="#FFFFFF" opacity="0.28" filter={`url(#${g("glow")})`} />
      {/* orbit, front half */}
      <ellipse cx="32" cy="32" rx="29" ry="9" transform="rotate(-16 32 32)" stroke={`url(#${g("ring")})`} strokeWidth="1.8" clipPath={`url(#${g("front")})`} />
      {/* satellite */}
      <circle cx="54.5" cy="31.2" r="4" fill="#CFE0FF" opacity="0.7" filter={`url(#${g("glow")})`} />
      <circle cx="54.5" cy="31.2" r="2.3" fill="#FFFFFF" />
    </svg>
  );
}

/** Logo: the 3D emblem + the word mark «HORIZON» and a «247» tag. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Emblem size={42} />
      {compact ? null : (
        <span className="flex items-center gap-1.5">
          <span className="text-[18px] font-bold tracking-[0.22em]">HORIZON</span>
          <span className="tabular rounded-md bg-text px-1.5 py-px font-mono text-[11px] font-bold tracking-wider text-bg">247</span>
        </span>
      )}
    </span>
  );
}

export function Button({ children, onClick, title, ariaLabel, pressed }: {
  children: ReactNode; onClick: () => void; title?: string; ariaLabel?: string; pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[8px] border border-border-control bg-surface px-3 text-sm text-text hover:bg-surface-2"
    >
      {children}
    </button>
  );
}
