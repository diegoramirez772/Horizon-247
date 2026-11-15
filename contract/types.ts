// TypeScript types for the bundle (contract v0.1 + v0.2/v0.3/v0.4 additive). Source: contract/SPEC.md.
export type Verdict = 0 | 1 | 2 | 3 | 4; // 0 INSUFICIENTE, 1 PROBADO, 2 CANDIDATA, 3 NO_CONCLUYENTE, 4 SIN_CAMBIO_MAYOR_QUE_DELTA
export type EvidenceLevel = "OBSERVACION" | "ASOCIACION" | "RIESGO_POTENCIAL" | "ACCION";

export interface Manifest {
  contract: "0.1" | "0.2" | "0.3" | "0.4";
  id: string;
  profile: "earth" | "mars" | "person";
  title: { es: string; en: string };
  variable: { name: string; unit: string; unit_per_decade: string };
  grid: { nlat: number; nlon: number; lat0: number; dlat: number; lon0: number; dlon: number; native_resolution_deg: number };
  window: { start: number; end: number; n: number; step: "annual" | "seasonal" };
  params: { alpha: number; fdr_q: number; delta_sigma_per_decade: number };
  methods: string[];
  arrays: Record<string, { file: string; dtype: "f32" | "u8"; unit?: string; note?: string }>;
  series?: { file: string; years: number[] };
  summary: Record<string, number>;
  dataset: { name: string; provider: string; url: string; version: string; doi?: string; licence: string; kind: string; sha256: string };
  honesty: { data_real: boolean; simulated: boolean; label_es: string; label_en: string };
  warnings: string[];
  windows?: WindowsInfo;
  // v0.4 (additive)
  entity: EntityInfo;
  profile_spec?: ProfileSpec;
  layer?: string;
  registry?: { catalog_version: string; catalog_sha256: string };
}

export interface CellFinding {
  index: number; lat: number; lon: number;
  effect: number; ci: [number, number]; sigma: number; r1: number;
  p: number; q: number; mde: number; yearsMore: number | null;
  verdict: Verdict; flags: number; nSig: 0 | 1 | 2 | 3; naiveSig: boolean; series: number[];
}

// v0.2 (additive)
export interface WindowsInfo { mode: "expanding"; start: number; ends: number[]; min_n: number }
export interface RegionLayer {
  n_cells: number; flags: number; series: number[]; effect: number; ci: [number, number];
  pCons: number; qRegions: number; verdict: Verdict; mde: number; yearsMore: number | null; emergenceYear: number | null;
}
export interface Region { id: string; name: { es: string; en: string }; layers: Record<string, RegionLayer> }
export interface ContextCard {
  id: string; region: string; level: EvidenceLevel; text: { es: string; en: string };
  source: { title: string; url: string; year: number }; status: "borrador" | "revisado";
}

// flag bits
export const FLAG = {
  DEPENDE_DEL_METODO: 1, CAMBIO_DE_VERSION: 2, COBERTURA_BAJA: 4, RESOLUCION_GRUESA: 8,
  RECONSTRUCCION: 16, SIMULADO: 32, AUTOCORRELACION_ALTA: 64, QUIEBRE_POSIBLE: 128,
} as const;

// v0.3 (additive) — monitoring room and assistant
export type Origin = "HORI" | "EXTERNAL" | "INTERFACE";
export interface Monitor {
  id: string; profile: string; entity: { kind: string; id: string; name: { es: string; en: string } };
  layer: string; state: { verdict: Verdict; effect: number; unit_per_decade: string; last_change_year: number | null; data_real: boolean };
  relevance: number;
}
export interface MonitorEvent {
  id: string; type: "EMERGENCIA" | "CAMBIO_DE_VERSION" | "NUEVO_DATO"; monitor: string; year: number;
  from: string; to: string; evidence: { window: string; q: number; n_sig: number };
}

// v0.4 (additive) — identity (H1) and registry (Z2)
export type EntityStatus = "real" | "simulada" | "no_verificada";
export interface EntityInfo {
  kind: string; body: string; count: number; valid: number;            // legacy: describe the CELLS of the arrays
  id?: string; type?: string; name?: { es: string; en: string }; status?: EntityStatus; version?: string;
  source?: { name?: string; note?: string }; geometry?: { type: "bbox"; bbox: [number, number, number, number] } | null;
  relations?: { rel: string; target: string }[];
}
export interface ProfileSpec {
  id: string; version: string; body: string; mode: "trend" | "sequential"; variables: string[]; unit: string;
  aggregation: { step: string; method: string; min_months?: number }; delta_per_decade: number | null;
  delta_rationale: string; review: "propuesto" | "revisado"; methods: string[]; name: { es: string; en: string };
  catalog_version: string;
}
export interface IndexEntry {
  id: string; layer?: string; entity?: string; profile_id?: string; profile: string; title: { es: string; en: string };
  variable: string; window: string; path: string; data_real: boolean; delta_per_decade: number | null;
}

// v0.4 — evidence timeline (SPEC 10.5)
export type EventCode = 0 | 1 | 2 | 3 | 4; // NINGUNO, NUEVO, SE_DEBILITO, CRUZO, CAMBIO_SIGNO
export type PriorityTier = 0 | 1 | 2 | 3; // EVENTO, PROBADO, POR_EMERGER, RESTO
export interface TimelineDoc {
  contract: "0.4"; kind: "timeline"; id: string;
  windows: { mode: "expanding"; start: number; ends: number[]; min_n: number };
  stats: { windows: number; cells: number; ever_probado: number; probado_now: number; withdrawn_share: number | null;
    step_reversal_rate: number | null; sign_reversal_share: number | null; events: Record<string, number>;
    tiers: Record<string, number>; definitions: Record<string, string> };
  emergence_histogram: Record<string, number>;
  priority_top: { cell: number; lat: number; lon: number; tier: string; event: string; effect: number; strength: number;
    reason: { es: string; origin: Origin } }[];
  honesty: { es: string; en: string };
}
