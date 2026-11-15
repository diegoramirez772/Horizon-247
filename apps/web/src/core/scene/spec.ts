// What the scene generator receives: a place, a body, a biome, readings with their provenance, and the entities to show.
// The generator turns readings into things you can see (NDVI → how green and dense the grass is, rain rate → drops,
// fire radiative power → flames and smoke…). Every generated thing keeps the reading that drove it (H4), and the scene
// as a whole is always labelled as generated, never as a photo (H5).

import type { WorldId } from "./worlds";

/** Any world of the modeler (worlds.ts): Earth, Mars, the Moon, Mercury, Venus, Titan, Europa, Io, Pluto. */
export type Body = WorldId;

export type Biome =
  | "semiarido" // Durango plains: grass, mesquite, nopal, agave
  | "bosque" // Sierra Madre: pine and oak
  | "pastizal" // grassland
  | "cultivo" // maize rows
  | "selva" // tropical
  | "costa" // coast: palms, sea
  | "desierto"
  | "tundra"
  | "urbano"
  | "marte"
  | "luna";

/** observacion = measured; estimacion = model or index from measurements; simulada = made up on purpose; ejemplo = demo value. */
export type DataKind = "observacion" | "estimacion" | "simulada" | "ejemplo";

export interface Reading { value: number; unit: string; source: string; date?: string; kind: DataKind }

export type VarKey =
  | "ndvi" // vegetation index, −1…1
  | "temp_c" // air temperature
  | "rh_pct" // relative humidity
  | "precip_mm_h" // rain rate
  | "cloud_frac" // cloud fraction 0…1
  | "wind_ms" // wind speed
  | "soil_moisture" // m³/m³
  | "spi" // standardized precipitation index (drought ≤ −1)
  | "fire_frp_mw" // fire radiative power
  | "burned_frac" // burned area fraction 0…1
  | "flood_frac" // flooded fraction 0…1
  | "snow_frac" // snow cover 0…1
  | "aod" // aerosol optical depth (smoke, dust, haze)
  | "dust_tau" // Mars: dust optical depth
  | "hour"; // local solar hour 0…24

export const VAR_INFO: Record<VarKey, { label: string; unit: string; min: number; max: number; step: number }> = {
  ndvi: { label: "Vegetación (NDVI)", unit: "", min: -0.1, max: 0.9, step: 0.01 },
  temp_c: { label: "Temperatura del aire", unit: "°C", min: -25, max: 48, step: 0.5 },
  rh_pct: { label: "Humedad relativa", unit: "%", min: 0, max: 100, step: 1 },
  precip_mm_h: { label: "Lluvia", unit: "mm/h", min: 0, max: 60, step: 0.5 },
  cloud_frac: { label: "Nubosidad", unit: "", min: 0, max: 1, step: 0.01 },
  wind_ms: { label: "Viento", unit: "m/s", min: 0, max: 30, step: 0.5 },
  soil_moisture: { label: "Humedad del suelo", unit: "m³/m³", min: 0, max: 0.5, step: 0.01 },
  spi: { label: "Índice de sequía (SPI)", unit: "", min: -3, max: 3, step: 0.1 },
  fire_frp_mw: { label: "Potencia del fuego (FRP)", unit: "MW", min: 0, max: 500, step: 5 },
  burned_frac: { label: "Área quemada", unit: "", min: 0, max: 1, step: 0.01 },
  flood_frac: { label: "Área inundada", unit: "", min: 0, max: 1, step: 0.01 },
  snow_frac: { label: "Cobertura de nieve", unit: "", min: 0, max: 1, step: 0.01 },
  aod: { label: "Aerosol (humo/polvo)", unit: "", min: 0, max: 3, step: 0.05 },
  dust_tau: { label: "Polvo en Marte (τ)", unit: "", min: 0, max: 5, step: 0.05 },
  hour: { label: "Hora solar", unit: "h", min: 0, max: 24, step: 0.25 },
};

export type Species = "vaca" | "toro" | "becerro" | "borrego" | "cabra" | "caballo";
export type Breed = "hereford" | "angus" | "charolais" | "holstein" | "criollo";
export type Role = "vaquero" | "agricultor" | "brigadista" | "astronauta" | "cientifico" | "habitante";
export type DeviceType = "estacion" | "sensor_suelo" | "molino" | "bebedero" | "corral" | "casa" | "rover" | "modulo" | "dron" | "panel_solar" | "presa";

export type Entity =
  | { kind: "ganado"; species: Species; breed?: Breed; count: number; collar?: boolean }
  | { kind: "personas"; role: Role; count: number }
  | { kind: "dispositivo"; type: DeviceType; count?: number };

export interface SceneSpec {
  title: string;
  place: string;
  body: Body;
  biome: Biome;
  seed?: number;
  vars: Partial<Record<VarKey, Reading>>;
  entities: Entity[];
  /** Free text shown under the title (e.g. "Valores de ejemplo, no medidos"). */
  note?: string;
}

/** Livestock heat stress: Temperature-Humidity Index, NRC (1971) formula used for cattle. */
export function thi(tempC: number, rhPct: number): number {
  return 1.8 * tempC + 32 - (0.55 - 0.0055 * rhPct) * (1.8 * tempC - 26);
}

/** LCI (Livestock Conservation Institute) categories for cattle THI: ≤74 normal, 75–78 alerta, 79–83 alto («danger»), ≥84 emergencia. */
export function thiLevel(v: number): "normal" | "alerta" | "alto" | "emergencia" {
  return v >= 84 ? "emergencia" : v >= 79 ? "alto" : v >= 75 ? "alerta" : "normal";
}

/** McKee et al. (1993) drought categories for SPI. */
export function spiLevel(v: number): "humedo" | "normal" | "moderada" | "severa" | "extrema" {
  return v <= -2 ? "extrema" : v <= -1.5 ? "severa" : v <= -1 ? "moderada" : v >= 1 ? "humedo" : "normal";
}
