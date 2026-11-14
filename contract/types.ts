// TypeScript types for the bundle (contract v0.1 + v0.2 additive). Source: contract/SPEC.md.
export type Verdict = 0 | 1 | 2 | 3 | 4; // 0 INSUFICIENTE, 1 PROBADO, 2 CANDIDATA, 3 NO_CONCLUYENTE, 4 SIN_CAMBIO_MAYOR_QUE_DELTA
export type EvidenceLevel = "OBSERVACION" | "ASOCIACION" | "RIESGO_POTENCIAL" | "ACCION";

export interface Manifest {
  contract: "0.1" | "0.2";
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
  RECONSTRUCCION: 16, SIMULADO: 32, AUTOCORRELACION_ALTA: 64,
} as const;
