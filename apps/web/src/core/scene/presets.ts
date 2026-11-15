// Ready-made scenes for the demo. All readings here are EXAMPLE values (kind "ejemplo"), chosen to be plausible for
// the place and season — not measurements. When a bundle has the real reading, `withReadings` replaces them and the
// legend says "observación" with its source and date.

import type { Entity, Reading, SceneSpec, VarKey } from "./spec";

const ex = (value: number, unit = ""): Reading => ({ value, unit, source: "valor de ejemplo", kind: "ejemplo" });

const ranch: Entity[] = [
  { kind: "dispositivo", type: "corral" },
  { kind: "dispositivo", type: "bebedero" },
  { kind: "dispositivo", type: "molino" },
  { kind: "dispositivo", type: "estacion" },
  { kind: "dispositivo", type: "casa" },
  { kind: "ganado", species: "vaca", breed: "hereford", count: 9, collar: true },
  { kind: "ganado", species: "becerro", breed: "hereford", count: 3 },
  { kind: "ganado", species: "caballo", count: 2 },
  { kind: "personas", role: "vaquero", count: 2 },
];

export const PRESETS: { id: string; label: string; spec: SceneSpec }[] = [
  {
    id: "rancho",
    label: "Rancho en Durango",
    spec: {
      title: "Rancho ganadero · Llanos de Durango", place: "Durango, Dgo.", body: "earth", biome: "semiarido",
      vars: { ndvi: ex(0.42), temp_c: ex(27, "°C"), rh_pct: ex(35, "%"), cloud_frac: ex(0.3), wind_ms: ex(4, "m/s"), spi: ex(0.1), hour: ex(10.5, "h") },
      entities: ranch,
    },
  },
  {
    id: "sequia",
    label: "Sequía",
    spec: {
      title: "Sequía severa en el agostadero", place: "Durango, Dgo.", body: "earth", biome: "semiarido",
      vars: { ndvi: ex(0.14), temp_c: ex(33, "°C"), rh_pct: ex(18, "%"), cloud_frac: ex(0.05), wind_ms: ex(10, "m/s"), spi: ex(-2.1), soil_moisture: ex(0.06, "m³/m³"), aod: ex(0.5), hour: ex(15, "h") },
      entities: ranch,
    },
  },
  {
    id: "calor",
    label: "Ola de calor y ganado",
    spec: {
      title: "Estrés térmico del ganado", place: "Gómez Palacio, Dgo.", body: "earth", biome: "pastizal",
      vars: { ndvi: ex(0.35), temp_c: ex(39, "°C"), rh_pct: ex(45, "%"), cloud_frac: ex(0.1), wind_ms: ex(2, "m/s"), spi: ex(-0.6), hour: ex(15.5, "h") },
      entities: [
        { kind: "dispositivo", type: "bebedero" }, { kind: "dispositivo", type: "estacion" }, { kind: "dispositivo", type: "panel_solar" },
        { kind: "ganado", species: "vaca", breed: "holstein", count: 12, collar: true }, { kind: "personas", role: "vaquero", count: 1 },
      ],
    },
  },
  {
    id: "tormenta",
    label: "Tormenta",
    spec: {
      title: "Tormenta de verano", place: "Durango, Dgo.", body: "earth", biome: "pastizal",
      vars: { ndvi: ex(0.6), temp_c: ex(19, "°C"), rh_pct: ex(88, "%"), cloud_frac: ex(0.95), precip_mm_h: ex(28, "mm/h"), wind_ms: ex(13, "m/s"), spi: ex(1.2), hour: ex(17.5, "h") },
      entities: ranch,
    },
  },
  {
    id: "inundacion",
    label: "Inundación",
    spec: {
      title: "Inundación tras lluvias", place: "Valle del Guadiana", body: "earth", biome: "cultivo",
      vars: { ndvi: ex(0.55), temp_c: ex(21, "°C"), rh_pct: ex(90, "%"), cloud_frac: ex(0.8), precip_mm_h: ex(9, "mm/h"), wind_ms: ex(5, "m/s"), flood_frac: ex(0.45), spi: ex(2.2), hour: ex(12, "h") },
      entities: [{ kind: "dispositivo", type: "casa" }, { kind: "dispositivo", type: "sensor_suelo", count: 3 }, { kind: "dispositivo", type: "dron" }, { kind: "ganado", species: "vaca", breed: "angus", count: 6 }, { kind: "personas", role: "agricultor", count: 2 }],
    },
  },
  {
    id: "incendio",
    label: "Incendio forestal",
    spec: {
      title: "Incendio en la Sierra Madre", place: "El Salto, Dgo.", body: "earth", biome: "bosque",
      vars: { ndvi: ex(0.45), temp_c: ex(31, "°C"), rh_pct: ex(15, "%"), cloud_frac: ex(0.05), wind_ms: ex(9, "m/s"), fire_frp_mw: ex(160, "MW"), burned_frac: ex(0.35), aod: ex(1.6), spi: ex(-1.4), hour: ex(16, "h") },
      entities: [{ kind: "personas", role: "brigadista", count: 4 }, { kind: "dispositivo", type: "dron" }, { kind: "dispositivo", type: "estacion" }],
    },
  },
  {
    id: "nevada",
    label: "Nevada en la sierra",
    spec: {
      title: "Nevada y helada", place: "Sierra de Durango", body: "earth", biome: "bosque",
      vars: { ndvi: ex(0.4), temp_c: ex(-4, "°C"), rh_pct: ex(80, "%"), cloud_frac: ex(0.85), precip_mm_h: ex(3, "mm/h"), wind_ms: ex(6, "m/s"), snow_frac: ex(0.7), hour: ex(9, "h") },
      entities: [{ kind: "dispositivo", type: "casa" }, { kind: "ganado", species: "borrego", count: 8 }, { kind: "personas", role: "habitante", count: 1 }],
    },
  },
  {
    id: "noche",
    label: "Noche en el rancho",
    spec: {
      title: "Rancho de noche", place: "Durango, Dgo.", body: "earth", biome: "semiarido",
      vars: { ndvi: ex(0.4), temp_c: ex(12, "°C"), rh_pct: ex(50, "%"), cloud_frac: ex(0.1), wind_ms: ex(2, "m/s"), hour: ex(22, "h") },
      entities: ranch,
    },
  },
  {
    id: "marte",
    label: "Marte · polvo",
    spec: {
      title: "Cráter Gale con tormenta de polvo", place: "Marte · Gale", body: "mars", biome: "marte",
      note: "Astronautas y módulo simulados",
      vars: { temp_c: ex(-55, "°C"), wind_ms: ex(11, "m/s"), dust_tau: ex(2.4), hour: ex(13, "h") },
      entities: [{ kind: "dispositivo", type: "rover" }, { kind: "dispositivo", type: "modulo" }, { kind: "dispositivo", type: "panel_solar", count: 3 }, { kind: "personas", role: "astronauta", count: 2 }],
    },
  },
  {
    id: "luna",
    label: "Luna",
    spec: {
      title: "Base lunar (simulada)", place: "Luna · polo sur", body: "moon", biome: "luna",
      note: "Escena totalmente simulada",
      vars: { hour: ex(12, "h") },
      entities: [{ kind: "dispositivo", type: "modulo" }, { kind: "dispositivo", type: "rover" }, { kind: "personas", role: "astronauta", count: 3 }, { kind: "dispositivo", type: "panel_solar", count: 2 }],
    },
  },
];

export function preset(id: string): SceneSpec {
  return structuredClone((PRESETS.find((p) => p.id === id) ?? PRESETS[0]).spec);
}

/** Replaces example values with real readings (e.g. from a bundle cell); untouched keys keep their example value. */
export function withReadings(spec: SceneSpec, readings: Partial<Record<VarKey, Reading>>): SceneSpec {
  return { ...spec, vars: { ...spec.vars, ...readings } };
}
