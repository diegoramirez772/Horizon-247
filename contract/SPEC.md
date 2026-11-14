<!-- Source of truth for the bundle format. Mirrors the team's 'Contrato de datos v0.1' + v0.2 additive extensions (section 8). -->


# Contrato de datos v0.1 — lo que HORI/ZON entregan y la web consume

> **Regla:** la web **solo** lee este contrato; HORI/ZON **solo** escriben este contrato. Si el contrato no cambia, nadie se bloquea.
> **Formato:** un **bundle estático** por capa (sin servidor): un `manifest.json` + arreglos binarios. La web los carga con `fetch` + `Float32Array`/`Uint8Array`.
> **Por qué binario:** una malla global de 1° son 64 800 celdas ≈ 0.25 MB por arreglo; 0.5° serían 259 200 celdas ≈ 1 MB. Cabe en memoria y se pinta en un `canvas` sin teselas.

## 1 · Estructura de carpetas
```
bundles/
  index.json                      ← lista de capas disponibles (para el selector)
  earth/
    temp_gistemp_2001-2024/
      manifest.json
      effect.f32  ci_lo.f32  ci_hi.f32  sigma.f32  r1.f32
      p_cons.f32  q_cons.f32  mde.f32  years_more.f32
      verdict.u8  flags.u8  nvalid.u8  nsig_methods.u8  naive_sig.u8
      series.f32                  ← [celda × año], para el clic
  mars/   dust_mcs_...            ← mismo formato
  person/ astronaut_sim_01/       ← modo secuencial (§6)
```
- Orden de celdas: **fila mayor, de norte a sur, de oeste a este**. `NaN` = sin dato. Little-endian.
- `index.json`: `[{id, profile, title, variable, window, path}]`.

## 2 · `manifest.json` (ejemplo reducido)
```json
{
  "contract": "0.1",
  "id": "temp_gistemp_2001-2024",
  "profile": "earth",
  "title": {"es": "Temperatura del aire (anomalía)", "en": "Surface air temperature anomaly"},
  "variable": {"name": "tempanomaly", "unit": "°C", "unit_per_decade": "°C/década"},
  "entity": {"kind": "region_cell", "body": "earth", "count": 16200, "valid": 16200},
  "grid": {"type": "latlon", "nlat": 90, "nlon": 180, "lat0": 89.0, "dlat": -2.0, "lon0": -179.0, "dlon": 2.0,
           "native_resolution_deg": 2.0, "effective_resolution_note": "GISTEMP suaviza a 1200 km; las celdas vecinas no son independientes"},
  "dataset": {
    "name": "GISTEMP v4 (GHCNv4 + ERSSTv5)", "provider": "NASA GISS",
    "url": "https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz",
    "version": "v4", "doi": "10.xxxx/por-completar", "sha256": "…", "licence": "NASA open data",
    "kind": "analysis", "downloaded_at": "2026-11-14T…Z", "size_bytes": 25885943
  },
  "window": {"start": 2001, "end": 2024, "n": 24, "step": "annual", "aggregation": "mean of monthly anomalies; ≥9/12 months per year"},
  "params": {"alpha": 0.05, "fdr_q": 0.10, "delta_sigma_per_decade": 2.0, "min_valid_years": 10},
  "methods": ["MK-VC", "TFPW-WS", "OLS-AR1"],
  "arrays": {
    "effect":      {"file": "effect.f32",  "dtype": "f32", "unit": "unit_per_decade"},
    "ci_lo":       {"file": "ci_lo.f32",   "dtype": "f32"},  "ci_hi": {"file": "ci_hi.f32", "dtype": "f32"},
    "sigma":       {"file": "sigma.f32",   "dtype": "f32", "note": "sd interanual de la serie sin tendencia"},
    "r1":          {"file": "r1.f32",      "dtype": "f32"},
    "p_cons":      {"file": "p_cons.f32",  "dtype": "f32", "note": "máx. de los p de los 3 métodos"},
    "q_cons":      {"file": "q_cons.f32",  "dtype": "f32", "note": "ajustado por FDR (Benjamini-Hochberg)"},
    "mde":         {"file": "mde.f32",     "dtype": "f32", "unit": "unit_per_decade"},
    "years_more":  {"file": "years_more.f32", "dtype": "f32", "note": "años extra para poder descartar cambios ≥ δ; 255 = más de 60"},
    "verdict":     {"file": "verdict.u8",  "dtype": "u8"},
    "flags":       {"file": "flags.u8",    "dtype": "u8"},
    "nvalid":      {"file": "nvalid.u8",   "dtype": "u8"},
    "nsig_methods":{"file": "nsig_methods.u8", "dtype": "u8", "note": "cuántos de los 3 métodos son significativos al α sin corregir"},
    "naive_sig":   {"file": "naive_sig.u8","dtype": "u8", "note": "1 si el MK ingenuo (sin correcciones) marcaría la celda"}
  },
  "series": {"file": "series.f32", "dtype": "f32", "shape": ["cells", "n"], "years": [2001, 2002, "…", 2024]},
  "verdict_codes": {"0": "INSUFICIENTE", "1": "PROBADO", "2": "CANDIDATA", "3": "NO_CONCLUYENTE", "4": "SIN_CAMBIO_MAYOR_QUE_DELTA"},
  "flag_bits": {"1": "depende_del_metodo", "2": "cambio_de_version", "4": "cobertura_baja", "8": "resolucion_gruesa", "16": "reconstruccion", "32": "simulado", "64": "autocorrelacion_alta"},
  "summary": {"cells_valid": 16200, "naive_marked": 0, "probado": 0, "candidata": 0, "no_concluyente": 0, "sin_cambio": 0, "insuficiente": 0},
  "calibration": {"source": "anexos/h247_sim_resultados_correccion", "false_alarm_measured": {"n23_phi03": 0.052, "n23_phi05": 0.068, "n40_phi05": 0.056},
                  "power_2sigma_decade": {"n23_phi03": 0.92, "n23_phi05": 0.78}, "note": "simulación AR(1) gaussiano; ilustra, no prueba con datos reales"},
  "honesty": {"data_real": true, "simulated": false, "label_es": "Datos reales NASA GISS", "label_en": "Real NASA GISS data"},
  "warnings": [],
  "build": {"hori": "0.1.0", "zon": "0.1.0", "python": "3.x", "numpy": "x.y", "seed": 247, "created_at": "…"}
}
```
Los valores `"…"`, `"por-completar"` y los contadores de `summary` se llenan al construir la capa.

## 3 · Códigos de veredicto y banderas
| Código | Nombre | Se muestra como |
|---|---|---|
| 1 | **PROBADO** | Relleno **sólido** (color por signo y magnitud) |
| 2 | **CANDIDATA** | Contorno punteado, sin relleno (es el «ingenuo que no sobrevive») |
| 3 | **NO_CONCLUYENTE** | **Rayado** (aún no se puede saber) |
| 4 | **SIN_CAMBIO_MAYOR_QUE_DELTA** | **Gris** liso |
| 0 | **INSUFICIENTE** | Transparente con borde fino |

Banderas (bitmask, combinables): `depende_del_metodo` (1–2 de 3 métodos significativos) · `cambio_de_version` (la ventana cruza versiones del dato, p. ej. Marte) · `cobertura_baja` · `resolucion_gruesa` (p. ej. GRACE ≈3°) · `reconstruccion` (kriging) · `simulado` · `autocorrelacion_alta` (r̂>0.5: el MDE está subestimado).

## 4 · Tipos para la web (TypeScript)
```ts
export type Verdict = 0 | 1 | 2 | 3 | 4;
export interface Manifest { contract: "0.1"; id: string; profile: "earth" | "mars" | "person";
  title: {es: string; en: string}; variable: {name: string; unit: string; unit_per_decade: string};
  grid: {nlat: number; nlon: number; lat0: number; dlat: number; lon0: number; dlon: number; native_resolution_deg: number};
  window: {start: number; end: number; n: number; step: "annual" | "seasonal"};
  params: {alpha: number; fdr_q: number; delta_sigma_per_decade: number};
  methods: string[]; arrays: Record<string, {file: string; dtype: "f32" | "u8"}>;
  series?: {file: string; years: number[]}; summary: Record<string, number>;
  dataset: {name: string; provider: string; url: string; version: string; doi?: string; licence: string; kind: string; sha256: string};
  honesty: {data_real: boolean; simulated: boolean; label_es: string; label_en: string}; warnings: string[]; }
export interface CellFinding { index: number; lat: number; lon: number; effect: number; ci: [number, number];
  sigma: number; r1: number; p: number; q: number; mde: number; yearsMore: number | null;
  verdict: Verdict; flags: number; nSig: 0 | 1 | 2 | 3; naiveSig: boolean; series: number[]; }
```

## 5 · Las frases que la web muestra (textos, para que no se improvisen)
| Veredicto | Español | English |
|---|---|---|
| PROBADO | «Cambio real: {efecto} {unidad}/década (intervalo {lo} a {hi}). Sobrevive a la corrección por mirar {N} zonas a la vez.» | "Real change: {effect} {unit}/decade (interval {lo} to {hi}). Survives correction for testing {N} cells at once." |
| CANDIDATA | «Posible cambio, no confirmado: no sobrevive a la corrección o los métodos discrepan ({k} de 3).» | "Possible change, not confirmed: it does not survive correction, or methods disagree ({k} of 3)." |
| NO_CONCLUYENTE | «Aún no se puede saber. Con {n} años solo habríamos visto cambios de ≥ {mde}/década. Para descartar cambios ≥ {δ}/década faltarían ~{años} años.» | "Not yet knowable. With {n} years we could only have seen changes ≥ {mde}/decade. Ruling out changes ≥ {δ}/decade would need ~{years} more years." |
| SIN_CAMBIO | «Sin cambio detectable ≥ {δ}/década: si existiera, lo habríamos visto con ≥80 % de probabilidad (según el modelo de ruido).» | "No detectable change ≥ {δ}/decade: if it existed we would likely have seen it (≥80 %, under the noise model)." |
| INSUFICIENTE | «Datos insuficientes ({n} años válidos).» | "Insufficient data ({n} valid years)." |
**Prohibido en la interfaz:** «no hay cambio» (sin δ), «prueba», «causa», «predice».

## 6 · Modo secuencial (persona simulada)
Mismo `manifest` con `profile: "person"`, `entity.kind: "person_sim"`, `honesty.simulated: true`, y en lugar de mallas: `signal.f32` (tiempo × señales), `baseline.json`, `statistic.f32` (CUSUM/EWMA), `alarms.json` (`[{t, signal, statistic, delay_to_known_change}]`) y `calibration.json` (ARL₀ medido y retardo medio). Etiqueta fija: **«Datos simulados · no es tecnología médica».**

## 7 · Versionado
`contract: "0.1"` en cada manifest. Cambios **solo aditivos** durante el hackatón (campos nuevos, nunca renombrar). Quien cambie algo lo escribe aquí y avisa al otro.

## 8 · Extensiones v0.2 (aditivas, 2026-11-14) — aportes del equipo
Todo lo de arriba **no cambia**. Un manifest puede declarar `"contract": "0.1"` o `"0.2"`; la web ignora lo que no conozca.

### 8.1 Ventanas crecientes (Estela · «evidencia acumulada»)
```
earth/precip_imerg_2001-2024/
  manifest.json                  ← añade "windows": {"mode":"expanding","start":2001,"ends":[2010,2011,…,2024],"min_n":10}
  windows/2010/ verdict.u8 effect.f32 q_cons.f32 mde.f32 years_more.f32 flags.u8
  windows/2011/ …  windows/2024/ …
  emergence_year.f32             ← primer año de fin a partir del cual la celda es PROBADO y se mantiene; NaN si nunca
```
- Cada ventana repite la **misma regla** de HORI (con FDR dentro de la ventana). **Son ventanas anidadas, no pruebas independientes:** la web debe rotularlo «evolución de la evidencia».
- **Modo año a año (descriptivo):** se lee la columna `t` de `series.f32` (anomalía del año). **Sin veredicto.** Flag `descriptive: true`.
- **Antes/después:** diferencia de medias entre dos periodos calculada en el navegador desde `series.f32`. **Descriptiva, sin prueba.**

### 8.2 Regiones nombradas (`regions.json`) — entidad agregada
```json
[{ "id": "mx-dgo", "name": {"es": "Durango", "en": "Durango"},
   "source": {"name": "Natural Earth admin-1", "note": "licencia por verificar"},
   "layers": { "precip_imerg_2001-2024": {
       "n_cells": 10, "weights": "area × cobertura", "flags": 0,
       "series": [ … ], "effect": 0.0, "ci": [0.0, 0.0], "p_cons": 0.0, "q_regions": 0.0,
       "verdict": 3, "mde": 0.0, "years_more": 0, "emergence_year": null } } }]
```
- Serie regional = **media ponderada por área y por celdas válidas**; se aplica **la misma regla de HORI** a esa serie; FDR (BH) **entre las regiones** de la lista.
- Si `n_cells < 4` → bandera `resolucion_gruesa`. Incluir regiones de contraste (para mostrar signos opuestos) y la comparación «dos regiones» se lee de aquí.

### 8.3 Capa de exposición (opcional, *Could*)
```json
{ "id": "expo_pop", "kind": "exposure", "label": {"es": "Exposición (no es impacto)", "en": "Exposure (not impact)"},
  "dataset": {"name": "…", "version": "…", "licence": "…", "sha256": "…"},
  "by_region": {"mx-dgo": {"PROBADO": {"people": 0, "cropland_km2": 0}, "NO_CONCLUYENTE": {"…": 0}}},
  "caveats": ["Cuenta lo que está dentro de la zona; no demuestra que sufra el cambio."] }
```

### 8.4 Fichas de contexto y niveles de evidencia (`context.json`)
```json
[{ "id": "ctx-001", "region": "mx-dgo", "level": "RIESGO_POTENCIAL",
   "text": {"es": "…", "en": "…"},
   "source": {"title": "…", "url": "…", "year": 2024}, "status": "borrador|revisado", "owner": "Carolina" }]
```
**Niveles** (`level`), con su chip en la interfaz: `OBSERVACION` (lo calcula HORI) · `ASOCIACION` · `RIESGO_POTENCIAL` (fuente externa citada; **no** calculado por HORI) · `ACCION` (**desactivado**). Una ficha sin `source` o con `status: borrador` **no se muestra** al jurado.

### 8.5 Registros de texto: técnico y sencillo (William)
Las plantillas del §5 son el registro **técnico**. Registro **sencillo** (misma información, sin jerga; **sin consejos ni precauciones**):
| Veredicto | Español (sencillo) | English (plain) |
|---|---|---|
| PROBADO | «Aquí sí hay un cambio real: {variable} {sube/baja} unos {efecto} {unidad} cada 10 años. Es muy poco probable que sea casualidad.» | "There is a real change here: {variable} is {rising/falling} about {effect} {unit} every 10 years. It is very unlikely to be chance." |
| CANDIDATA | «Parece haber un cambio, pero aún no estamos seguros: podría ser casualidad o depender de cómo se calcule.» | "There seems to be a change, but we are not sure yet: it could be chance or depend on how it is calculated." |
| NO_CONCLUYENTE | «Todavía no se puede saber. Con {n} años de datos solo notaríamos cambios de {mde} o más cada 10 años. Habría que esperar unos {años} años más.» | "We cannot tell yet. With {n} years of data we could only notice changes of {mde} or more per 10 years. We would need about {years} more years." |
| SIN_CAMBIO | «No vemos cambios grandes (de {δ} o más cada 10 años). Si los hubiera, lo habríamos notado.» | "We see no large changes ({δ} or more per 10 years). If there were, we would likely have noticed." |
| INSUFICIENTE | «No hay datos suficientes en esta zona.» | "Not enough data in this area." |
El selector **[Técnico | Sencillo]** cambia solo el texto; los números y la evidencia son los mismos.

### 8.6 Evento `EMERGENCIA` (función «alertas y seguimiento»)
`{type:"EMERGENCIA", entity:"mx-dgo", layer:"…", year: 2019, from:"NO_CONCLUYENTE", to:"PROBADO", evidence:{window:"2001-2019", q:0.0, nSig:3}}` — se deriva de `windows/` y se lista con su evidencia. **No es una alerta de peligro:** dice que *la evidencia ya alcanza*.

### 8.7 Tipos adicionales (TypeScript)
```ts
export type EvidenceLevel = "OBSERVACION" | "ASOCIACION" | "RIESGO_POTENCIAL" | "ACCION";
export interface WindowsInfo { mode: "expanding"; start: number; ends: number[]; min_n: number }
export interface RegionLayer { n_cells: number; flags: number; series: number[]; effect: number; ci: [number, number];
  pCons: number; qRegions: number; verdict: Verdict; mde: number; yearsMore: number | null; emergenceYear: number | null }
export interface Region { id: string; name: {es: string; en: string}; layers: Record<string, RegionLayer> }
export interface ContextCard { id: string; region: string; level: EvidenceLevel; text: {es: string; en: string};
  source: {title: string; url: string; year: number}; status: "borrador" | "revisado" }
```
