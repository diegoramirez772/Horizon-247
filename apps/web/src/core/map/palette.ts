// Map colour. The interface accent (violet) never appears in the data, so it cannot be read as a value.
// Colour = sign and magnitude of a DETECTED change; texture = verdict; never colour alone (WCAG 1.4.1).
// Every data step keeps ≥ 3:1 against BOTH the ocean and the land underneath (checked in tests).
//
// Design change vs doc 03 v1 (black-and-white UI): William asked for a richer, less grey look for the NASA
// hackathon (2026-11-14). The data rules of doc 03 §4 are kept; Estela and Diego to confirm.

export type ThemeName = "light" | "dark";

export interface MapTheme {
  /** Ocean / no-data background. */
  ocean: string;
  /** Land fill under the data, and its outline. */
  land: string;
  landLine: string;
  /** Faint latitude/longitude lines. */
  graticule: string;
  /** Texture ink (the "fog" stripes of «aún no», the dots of «posible»), drawn at `inkAlpha`. */
  ink: string;
  inkAlpha: number;
  /** Flat fill for SIN_CAMBIO ≥ δ. */
  noChange: string;
  /** Selection / hover / region outline. */
  focus: string;
  halo: string;
  /** Steps ±1 (weak) … ±3 (strong): magnitude grows with lightness on dark, with darkness on light. */
  red: readonly [string, string, string];
  blue: readonly [string, string, string];
  /** Sequential ramp (low → high) for magnitudes without sign: MDE, years still needed. */
  seq: readonly [string, string, string, string, string];
}

export const MAP_THEMES: Record<ThemeName, MapTheme> = {
  dark: {
    ocean: "#0E0E0E", land: "#1E1E1E", landLine: "#5E5E5E", graticule: "#1A1A1A",
    ink: "#D4D4D4", inkAlpha: 0.5, noChange: "#6E6E6E", focus: "#FFFFFF", halo: "#0A0A0A",
    red: ["#E4572E", "#FF8A5B", "#FFC2A1"],
    blue: ["#2F80ED", "#5AA9FF", "#A8D4FF"],
    seq: ["#2F8A82", "#45A49B", "#63BDB3", "#8FD5CC", "#C2EEE8"],
  },
  light: {
    ocean: "#E3EAF4", land: "#F8FAFD", landLine: "#8C97AB", graticule: "#D3DCE8",
    ink: "#33405A", inkAlpha: 0.55, noChange: "#727E96", focus: "#0D1526", halo: "#FFFFFF",
    red: ["#D9481F", "#A92E14", "#6E1A0B"],
    blue: ["#2B73D6", "#1C55A8", "#0E3770"],
    seq: ["#3F8F87", "#2E7A73", "#1F655F", "#13504B", "#083A36"],
  },
};

/** Which colour means "more". SPEC has no field yet (D4 asks for `variable.color_more`); fallback = name heuristic. */
export function moreIsBlue(variable: { name: string; color_more?: unknown }): boolean {
  if (variable.color_more === "blue") return true;
  if (variable.color_more === "red") return false;
  return /precip|lluvia|rain/i.test(variable.name);
}

/** Effect → step −3..−1 / 1..3 (0 = no colour). `scale` = effect that reaches the strongest step. */
export function effectStep(effect: number, scale: number): -3 | -2 | -1 | 0 | 1 | 2 | 3 {
  if (!Number.isFinite(effect) || !(scale > 0)) return 0;
  const t = Math.min(1, Math.abs(effect) / scale);
  const s = (t <= 1 / 3 ? 1 : t <= 2 / 3 ? 2 : 3) as 1 | 2 | 3;
  return (effect < 0 ? -s : s) as -3 | -2 | -1 | 1 | 2 | 3;
}

export function stepColor(theme: MapTheme, step: number, blueIsMore: boolean): string | null {
  if (step === 0) return null;
  const ramp = step > 0 !== blueIsMore ? theme.red : theme.blue;
  return ramp[Math.abs(step) - 1];
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function robustScale(effect: Float32Array): number {
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(effect.length / 20000));
  for (let i = 0; i < effect.length; i += step) {
    const v = effect[i];
    if (!Number.isNaN(v)) sample.push(Math.abs(v));
  }
  if (sample.length === 0) return 1;
  sample.sort((a, b) => a - b);
  return sample[Math.floor(sample.length * 0.98)] || 1;
}

// ---- WCAG 2.x contrast ----
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Value → sequential step 0..4 within [lo, hi] (−1 = no colour). */
export function seqStep(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return -1;
  const t = hi > lo ? (v - lo) / (hi - lo) : 0;
  return Math.max(0, Math.min(4, Math.floor(t * 5)));
}

/** Robust range (5th–95th percentile) of finite values, so a few extremes do not flatten the map. */
export function robustRange(a: Float32Array): [number, number] {
  const s: number[] = [];
  const step = Math.max(1, Math.floor(a.length / 20000));
  for (let i = 0; i < a.length; i += step) if (Number.isFinite(a[i])) s.push(a[i]);
  if (!s.length) return [0, 1];
  s.sort((x, y) => x - y);
  return [s[Math.floor(s.length * 0.05)], s[Math.floor(s.length * 0.95)]];
}
