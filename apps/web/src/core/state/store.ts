// Shared state: ONE source of truth for map, series and panel (Diseño de solución 6b).
// It is mirrored in the URL, so switching register keeps your place, a link can be shared and the demo
// video can start from an exact state (web-diseno §4.1). The register preference is also remembered.

import type { Lang, Register } from "@/core/i18n/texts";

export type Profile = "earth" | "mars" | "person";
export type Tab = "cambio" | "contraste" | "detectabilidad" | "evidencia";
export type TimeMode = "completa" | "anual" | "acumulada";
/** What the map paints in the full window. Only Experto offers anything but the verdict. */
export type Metric = "verdict" | "effect" | "mde" | "years";
export type Selection = { kind: "cell"; index: number } | { kind: "region"; id: string } | null;

export interface AppState {
  lang: Lang;
  register: Register;
  profile: Profile;
  tab: Tab;
  layerId: string | null;
  timeMode: TimeMode;
  windowEnd: number | null;
  year: number | null;
  selection: Selection;
  evidenceOpen: boolean;
  metric: Metric;
  /** Verdicts shown at full strength on the map (null = all). */
  filter: number[] | null;
  /** Bumped by commands that should move the camera (map taps do not move it). */
  camera: number;
  /** True once the URL has been read on the client (never written to the URL). */
  hydrated: boolean;
}

/** Server and first client render use this; the URL is read after hydration. */
export const DEFAULT_STATE: AppState = {
  lang: "es",
  register: "sencillo", // doc 01 §2: the default serves the first-time visitor
  profile: "earth",
  tab: "cambio",
  layerId: null,
  timeMode: "completa",
  windowEnd: null,
  year: null,
  selection: null,
  evidenceOpen: false,
  filter: null,
  metric: "verdict",
  camera: 0,
  hydrated: false,
};

type Listener = () => void;

export class Store {
  private s: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState = DEFAULT_STATE) {
    this.s = initial;
  }

  get = (): AppState => this.s;

  set = (patch: Partial<AppState>): void => {
    const next = { ...this.s, ...patch };
    const changed = (Object.keys(patch) as (keyof AppState)[]).some((k) => !same(this.s[k], next[k]));
    if (!changed) return;
    this.s = next;
    for (const l of this.listeners) l();
  };

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- URL ⇄ state ----
// ?p=earth&tab=cambio&l=<layer>&sel=c:123|r:mx-dgo&reg=sencillo|experto&lang=es&t=anual&y=2019&w=2015&ev=1

const TABS: Tab[] = ["cambio", "contraste", "detectabilidad", "evidencia"];
const MODES: TimeMode[] = ["completa", "anual", "acumulada"];
const PROFILES: Profile[] = ["earth", "mars", "person"];

function int(v: string | null): number | null {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function parseSelection(v: string | null): Selection {
  if (!v) return null;
  if (v.startsWith("c:")) {
    const i = int(v.slice(2));
    return i !== null && i >= 0 ? { kind: "cell", index: i } : null;
  }
  if (v.startsWith("r:") && v.length > 2) return { kind: "region", id: v.slice(2) };
  return null;
}

function parseFilter(v: string | null): number[] | null {
  if (!v) return null;
  const f = v.split(".").map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 4);
  return f.length ? f : null;
}

export function fromSearch(search: string, base: AppState, browserLang?: string): AppState {
  const q = new URLSearchParams(search);
  const lang = q.get("lang");
  const reg = q.get("reg");
  const tab = q.get("tab") as Tab | null;
  const t = q.get("t") as TimeMode | null;
  const p = q.get("p") as Profile | null;
  return {
    ...base,
    // doc 02 F0: browser language; anything that is not es/en → Spanish.
    lang: lang === "en" || lang === "es" ? lang : browserLang?.toLowerCase().startsWith("en") ? "en" : "es",
    register: reg === "experto" ? "tecnico" : reg === "sencillo" ? "sencillo" : base.register,
    profile: p && PROFILES.includes(p) ? p : base.profile,
    tab: tab && TABS.includes(tab) ? tab : base.tab,
    layerId: q.get("l") || base.layerId,
    timeMode: t && MODES.includes(t) ? t : base.timeMode,
    year: int(q.get("y")) ?? base.year,
    windowEnd: int(q.get("w")) ?? base.windowEnd,
    selection: parseSelection(q.get("sel")) ?? base.selection,
    evidenceOpen: q.get("ev") === "1" || base.evidenceOpen,
    filter: parseFilter(q.get("f")) ?? base.filter,
    metric: (["verdict", "effect", "mde", "years"] as Metric[]).includes(q.get("m") as Metric) ? (q.get("m") as Metric) : base.metric,
  };
}

export function toSearch(s: AppState): string {
  const q = new URLSearchParams();
  if (s.profile !== DEFAULT_STATE.profile) q.set("p", s.profile);
  if (s.tab !== DEFAULT_STATE.tab) q.set("tab", s.tab);
  if (s.layerId) q.set("l", s.layerId);
  if (s.selection) q.set("sel", s.selection.kind === "cell" ? `c:${s.selection.index}` : `r:${s.selection.id}`);
  q.set("reg", s.register === "tecnico" ? "experto" : "sencillo");
  q.set("lang", s.lang);
  if (s.timeMode !== "completa") q.set("t", s.timeMode);
  if (s.timeMode === "anual" && s.year !== null) q.set("y", String(s.year));
  if (s.timeMode === "acumulada" && s.windowEnd !== null) q.set("w", String(s.windowEnd));
  if (s.evidenceOpen) q.set("ev", "1");
  if (s.filter?.length) q.set("f", s.filter.join("."));
  if (s.metric !== "verdict") q.set("m", s.metric);
  const str = q.toString();
  return str ? `?${str}` : "";
}
