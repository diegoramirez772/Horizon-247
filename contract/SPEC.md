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
| SIN_CAMBIO | «No vemos cambios grandes (de {δ} o más cada 10 años). Si los hubiera, muy probablemente los habríamos notado.» | "We see no large changes ({δ} or more per 10 years). If there were, we would likely have noticed." |
| INSUFICIENTE | «No hay datos suficientes en esta zona.» | "Not enough data in this area." |
El selector **[Técnico | Sencillo]** cambia solo el texto; los números y la evidencia son los mismos.
*(Corregido 2026-11-15: SIN_CAMBIO decía «lo habríamos notado»; la potencia medida es ~80–92 % según φ, no 100 %. Ahora coincide con §5.)*

#### 8.5b Registro **normal** (v0.9, aditivo) — doc «Modos de profundidad… v2» §2.3
Tres niveles sobre los mismos números: **Simple** = §8.5 · **Normal** = esta tabla · **Experto** = §5. Normal muestra gráfica, comparación, «desde cuándo se sabe» e intervalo, **sin** p/q a la vista. En URL: `reg=sencillo|normal|experto`.
| Veredicto | Español (normal) | English (normal) |
|---|---|---|
| PROBADO | «{Variable} {sube/baja} {efecto} {unidad} por década (entre {lo} y {hi}). El cambio aparece con los tres métodos y se mantiene al revisar {N} zonas a la vez.» | "{Variable} is {rising/falling} {effect} {unit} per decade (between {lo} and {hi}). All three methods see it, and it holds when {N} areas are checked at once." |
| CANDIDATA | «Hay una señal de {efecto} {unidad} por década, pero no pasa todos los filtros ({k} de 3 métodos la ven). Puede ser real o casualidad.» | "There is a signal of {effect} {unit} per decade, but it does not pass every check ({k} of 3 methods see it). It may be real or chance." |
| NO_CONCLUYENTE | «Con {n} años de datos solo se distinguen cambios de {mde} o más por década, y lo que buscamos es {δ}. Con ~{años} años más se podría saber.» | "With {n} years of data only changes of {mde} or more per decade stand out, and we are looking for {δ}. About {years} more years would tell." |
| SIN_CAMBIO | «No aparece un cambio de {δ} o más por década. Con estos datos, uno así se habría visto en la gran mayoría de los casos.» | "No change of {δ} or more per decade shows up. With these data, one like that would have been seen in most cases." |
| INSUFICIENTE | «Solo hay {n} años con datos válidos en esta zona; no alcanzan para este análisis.» | "There are only {n} years of valid data here; not enough for this analysis." |

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

## 9 · Extensiones v0.3 (aditivas, 2026-11-14) — sala de monitoreo y asistente
### 9.1 `monitors.json` (HORI/ZON lo escriben; la web lo lee)
```json
[{ "id": "mon-dgo-temp", "profile": "earth",
   "entity": {"kind": "region", "id": "mx-dgo", "name": {"es": "Durango", "en": "Durango"}},
   "layer": "temp_gistemp_1980-2024",
   "state": {"verdict": 1, "effect": 0.0, "unit_per_decade": "°C/década", "last_change_year": 2019, "data_real": true},
   "relevance": 0 }]
```
`relevance` (entero, menor = más relevante) lo calcula HORI con una regla fija; **la web y el asistente no recalculan veredictos**.
### 9.2 `events.json`
```json
[{ "id": "ev-001", "type": "EMERGENCIA", "monitor": "mon-dgo-temp", "year": 2019,
   "from": "NO_CONCLUYENTE", "to": "PROBADO", "evidence": {"window": "1980-2019", "q": 0.0, "n_sig": 3} }]
```
Tipos: `EMERGENCIA`, `CAMBIO_DE_VERSION`, `NUEVO_DATO` (este último solo en operación continua).
### 9.3 `assistant.json` (uno por perfil)
`{ "profile", "entity_word", "synonyms": {"layers": {...}, "regions": {...}}, "chips": [...], "templates": {"<clave>": {"es": "...", "en": "..."}} }` — vocabulario, sugerencias y plantillas de narración. **Plantillas de números y veredictos:** las de §5 y §8.5. Cada mensaje declara `origin`: `"HORI" | "EXTERNAL" | "INTERFACE"`.
### 9.4 Tipos (TypeScript)
```ts
export type Origin = "HORI" | "EXTERNAL" | "INTERFACE";
export interface Monitor { id: string; profile: string; entity: { kind: string; id: string; name: {es: string; en: string} };
  layer: string; state: { verdict: Verdict; effect: number; unit_per_decade: string; last_change_year: number | null; data_real: boolean };
  relevance: number }
export interface MonitorEvent { id: string; type: "EMERGENCIA" | "CAMBIO_DE_VERSION" | "NUEVO_DATO"; monitor: string; year: number;
  from: string; to: string; evidence: { window: string; q: number; n_sig: number } }
```
Los tipos reflejan el JSON tal cual (snake_case), sin adaptador.

## 10 · Extensiones v0.4 (aditivas, 2026-11-14) — identidad (H1) y registro (Z2)
Todo lo anterior **no cambia de significado**. Los manifests nuevos declaran `"contract": "0.4"`.

### 10.1 `entity` ampliado (L0)
Las claves de siempre se quedan **con su significado**: `entity.kind` = tipo de **cada celda** de los arreglos (`region_cell`), `count`, `valid`, `body`. Se agregan las de la **entidad monitoreada** (mapeable a NGSI-LD: entidad · propiedad · relación):
```json
"entity": {"kind": "region_cell", "body": "earth", "count": 72, "valid": 72,
  "id": "mx-dgo", "type": "region", "name": {"es": "Durango", "en": "Durango"},
  "status": "real", "version": "1",
  "source": {"name": "equipo AETHRA", "note": "caja aproximada del estado, NO el polígono oficial"},
  "geometry": {"type": "bbox", "bbox": [22.3, -107.2, 26.8, -102.5]},
  "relations": [{"rel": "part_of", "target": "mx"}]}
```
`status` dice si **la cosa** es real (`real` · `simulada` · `no_verificada`); si los **datos** son reales lo sigue diciendo `honesty`. HORI **rechaza** mezclar entidad real con datos simulados (y al revés).

### 10.2 `profile_spec` (el perfil que HORI aplicó)
`profile` sigue siendo la cadena del cuerpo (`"earth"`). El perfil completo va aparte:
```json
"profile_spec": {"id": "tierra.temperatura", "version": "1", "body": "earth", "mode": "trend",
  "variables": ["T2M", "tempanomaly"], "unit": "°C",
  "aggregation": {"step": "annual", "method": "mean_monthly_anomaly", "min_months": 9},
  "delta_per_decade": 0.3, "delta_rationale": "…", "review": "propuesto",
  "methods": ["MK-VC", "TFPW-WS", "OLS-AR1"], "name": {"es": "Temperatura del aire", "en": "Air temperature"},
  "catalog_version": "1"}
```
Perfiles v1: `tierra.temperatura` (δ 0.3 °C/década) · `tierra.precipitacion` (δ 0.2 mm/día/década) · `marte.polvo` (sin δ físico → 2σ) · `persona.simulada` (modo secuencial, aún no construido). **Todos con `review: "propuesto"`**: δ es valor de trabajo del equipo, no de la literatura.

### 10.3 Parámetros y reproducibilidad
- `params.delta_source`: `"profile"` · `"config"` (alguien lo fijó a mano) · `"sigma"` (δ = k·σ). `params.min_months`.
- `build.input_sha256`: hash de lo que HORI leyó (valores, ejes, variable). Misma entrada → mismo hash.
- `build.created_at` usa `SOURCE_DATE_EPOCH` si existe → **bundle idéntico byte a byte** (probado).
- `layer` (id de capa del catálogo) y `registry: {catalog_version, catalog_sha256}` (los escribe ZON).

### 10.4 `index.json` (v0.4)
Rutas relativas a `bundles/` (`"path": "earth/power_t2m_dgo_2001-2024"`) y por entrada: `layer`, `entity`, `profile_id`, además de lo de antes. Ordenado por `layer`.

### 10.5 Línea de tiempo de la evidencia (`kind: "timeline"`) — máquina del tiempo, eventos y prioridad
Carpeta `earth/timeline_<var>_<inicio>-<fin>/` con `timeline.json` + arreglos por celda (mismo orden que los bundles):
| Archivo | Qué es |
|---|---|
| `verdict_by_window.u8` | `[ventanas × celdas]`: veredicto de HORI usando solo los años hasta cada `windows.ends[i]` (FDR dentro de cada ventana) |
| `emergence_year.f32` | año desde el que la celda es PROBADO **y se mantiene** hasta hoy; NaN si hoy no lo es |
| `first_probado_year.f32` | primera vez que fue PROBADO (aunque luego se retirara) |
| `reversals.u8` · `sign_flip.u8` | veces que un PROBADO se retiró · 1 si fue PROBADO con ambos signos |
| `event.u8` | cambio entre la penúltima y la última ventana: 0 ninguno · 1 NUEVO · 2 SE_DEBILITO · 3 CRUZO · 4 CAMBIO_SIGNO |
| `priority_tier.u8` · `priority_strength.f32` · `priority_order.u32` | nivel (0 EVENTO · 1 PROBADO · 2 POR_EMERGER · 3 RESTO), fuerza = \|efecto\|/MDE, y el orden final de celdas |
`timeline.json` trae `stats` (tasas de reversión **medidas en datos reales**, con su definición), `emergence_histogram`, `priority_top[]` (celda, lat, lon, razón en texto con `origin: "HORI"`) y `honesty` (texto obligatorio: es un ensayo retrospectivo con la versión actual de los datos; ventanas anidadas). Sustituye a las carpetas `windows/AAAA/` del §8.1 (mismo contenido, un solo archivo).

### 10.6 Calidad (L1) y detectabilidad (D2) en cada bundle
- Bandera `128 = quiebre_posible` + arreglo `break_year.f32`: posible salto (recta vs recta + escalón). **No cambia el veredicto.** «Sin bandera» no significa «homogéneo»: con 24–45 años solo se atrapan saltos grandes (medido: 55 % de los de 3σ).
- Arreglo `delta.f32` (el δ con el que se juzgó cada celda) y `manifest.detectability` (qué parte del mapa ya podría ver un cambio δ y cuántos años faltan en el resto).

### 10.7 Memoria larga (L2b) — «PROBADO robusto»
- Arreglo `robust_mem.u8` (1 = PROBADO **y** sigue significativo a `alpha` con la varianza de Mann-Kendall de ruido fGn(H), H = `params.memory_hurst`, 0.7 por defecto; 0 = no). **No cambia el veredicto**: es una afirmación más fuerte que se muestra al lado. `manifest.summary.probado_robusto_memoria` cuenta las celdas.
- No se estima H por celda: con 24–45 años la estimación sale sesgada hacia abajo (medido) y tendencia y memoria larga no se separan. Detalle y cifras en `docs/MODEL_CARD.md`.

### 10.8 Actualización incremental (Z3) — `events.json` de tipo `update`
`bundles/earth/global_<var>_<inicio>-<fin>/events.json` (`kind: "update"`): `last_month`, `window_end`, `previous` (`last_month`, `window_end`, `path`), `counts` (NUEVO / CRUZO / SE_DEBILITO / CAMBIO_SIGNO), `tiers`, `events_top[]` (celda, lat, lon, evento, efecto, razón con `origin: "HORI"`) y `honesty`. Junto a él: `event.u8`, `priority_tier.u8`, `priority_strength.f32`, `priority_order.u32` (mismo código que el timeline). `bundles/earth/updates.json` es la bitácora de actualizaciones (`from`, `to`, `status`, `events`). `manifest.dataset.last_month` = último mes con datos usado. Un año solo entra a la ventana con ≥ 9 meses.

## 11 · Núcleo universal (v0.5, aditivo) — monitores, anomalías y alertas con ciclo de vida
La idea no es solo «tendencias de clima»: es **identificar, observar, supervisar y detectar** en cualquier entidad. Lo que añade v0.5 (mismo núcleo para Tierra, Marte y una persona simulada):
### 11.1 Anomalías (`hori.api.detect_anomalies` / `anomaly_events`)
Sobre un flujo regular (NaN = faltante) con un periodo (12 = mensual, 144 = un día a 10 min, 669 = un año marciano en soles). Tres detectores: `punto` (|z| ≥ 3.5), `cambio_nivel` (CUSUM bilateral, inicio estimado) y `sin_datos` (corrida de faltantes ≥ 3). Las rachas de puntos se agrupan en `racha`; un cambio de nivel que termina puede dejar un `retorno_probable` en sentido contrario (la línea base se adapta). Evento: `type`, `start`, `end`, `t_start`, `t_end`, `peak_z` o `mean_z`, `direction` (`alto`/`bajo`), `n_flagged`, `severity` (`leve`/`media`/`alta` = tamaño de la desviación **estadística**, no de un riesgo). Se juzga con el pasado solamente (causal). Tasas de falsa alarma y potencia medidas: `docs/MODEL_CARD.md` §3.13.
### 11.2 Monitores y alertas (`zon.monitors`)
Archivos planos en una carpeta: `monitors.json` (monitor = entidad + variable + periodo + parámetros), `obs/<id>.json` (observaciones), `alerts.json` (estado actual de cada alerta) y `audit.jsonl` (solo se agrega; cada registro lleva `prev_hash` → `hash` SHA-256, así que editar el pasado es detectable con `verify_audit`).
Alerta: `id` (hash de monitor + tipo + inicio: reingerir no duplica; un evento que crece se actualiza), `state` ∈ `abierta → reconocida → derivada → cerrada` (cualquier estado abierto puede cerrarse; cerrada es final), `severity`, `evidence` (con el método y sus umbrales), `evidence_level: "observacion"`, `origin: "HORI"`, `simulated` (hereda `entity.status`), `note` (H12: una anomalía no es prueba de falla, enfermedad ni peligro) e `history[]` con quién cambió qué y cuándo. Todo cambio de estado exige una persona (`actor` ≠ `sistema`).
### 11.3 Otros cuerpos
`entity.body` ∈ `earth | mars | human`; `entity.status` ∈ `real | simulada | no_verificada` (real y simulado no se mezclan: `check_pair`). Marte: `zon.fetch.mars_dust` (LMD/Montabone, CC BY-SA 3.0, **reconstrucción** marcada, años marcianos). Persona: `zon.sim.astronaut` (determinista, **simulada**, con verdad conocida para medir la detección).

## 12 · Enjambre y estado de la entidad (v0.6, aditivo)
### 12.1 Reporte (`zon.swarm.SwarmStore.add_report`)
`{id, reporter: {id (seudónimo), type: persona|cientifico|institucion|sensor_ciudadano, verified (solo con verified_by)}, lat, lon (redondeadas a 0.01°), time, text, kind?, evidence: [{type: foto|video|medicion|documento, sha256}], themes, directions, source_class: "no_verificada", simulated, received_at}`. `reports.jsonl` encadenado (SHA-256); evidencia guardada por huella en `evidence/`.
### 12.2 Señal del enjambre (`hori.api.swarm_signals`)
`{theme, level (reporte_aislado|senal_ciudadana|senal_con_evidencia|corroborada_por_instrumento), score, independent_reporters, evidence_items, direction, lat, lon, t_start, t_end, reports[], flags[], instrument{seen, direction, detail}|null, instrument_variable, reasons[], per_reporter{}, source_class: "no_verificada", evidence_level (observacion_ciudadana|asociacion), simulated, note_es, version}`. Como alerta: `type: "enjambre"`, mismo ciclo de vida y bitácora (§11.2).
### 12.3 Estado de la entidad (`hori.api.entity_state`)
`{entity, identity, status (atencion|hallazgos|vigilando|sin_novedad), headline{es, priority}, changes[], attention[], follow_up{open_alerts, by_state}, priority[] (cada uno con kind, priority P0–P4, strength, text_es, evidence_level, origin), unknowns[], sources[], honesty}`. Es lo que la web pinta y lo que el asistente narra (H19: plantillas + números, sin generar cifras).

## 13 · Identidad firmada, avisos y vigilancia (v0.7, aditivo)
- **Atestación** (en un reporte del enjambre): `attestation: {statement: {subject, role, valid_until, issuer}, key_id, signature (hex Ed25519 sobre JSON canónico)}`. El reportante queda `verified: true` solo si la llave está en `trust.json` y la firma, la persona, el rol y la vigencia cuadran; `verification` dice por qué sí o por qué no.
- **Observaciones firmadas:** `ingest(..., signed={key_id, signature})` sobre `{monitor, times, values}` canónico; el registro de auditoría guarda `firma`. Monitor con `params.require_signature` rechaza lo no firmado.
- **Aviso** (bandeja JSONL o webhook con cabecera `X-Horizon-Signature` = HMAC-SHA256 del cuerpo): `{kind: aviso_enviado|escalada, alert, to[], level, severity, subject, evidence, origin, evidence_level, note, state}`.
- **Señal del enjambre** añade `calibration: {k_bin, agree_real_data, chance, lift, source, scope}` (medido con CoCoRaHS).
- **index.json** de `zon export-web` es ahora el **arreglo** que la web lee (`IndexEntry[]`: id, profile, title, variable, window{start,end,n}, path) más campos aditivos (kind, files con SHA-256, last_month, has_events).

## 14 · API de ZON (v0.8) — para la web y para cualquier sistema
Base `http://<host>:8247`. JSON en UTF-8. Llave: `Authorization: Bearer <llave>` (crear con `python -m zon key --name … --role lector|operador|admin --orgs …`).
| Método y ruta | Rol | Respuesta |
|---|---|---|
| `GET /health` · `GET /metrics` | público | estado, cadena íntegra, salud por fuente · texto Prometheus |
| `GET /bundles/<ruta>` | público | archivos estáticos (manifest, arreglos, `index.json` = `IndexEntry[]`) |
| `GET /monitors` | lector | monitores de tus organizaciones (+ `org`) |
| `GET /monitors/{id}/observations?since=` | lector | `{times, values}` |
| `GET /alerts?state=&monitor=` | lector | alertas (§11.2) |
| `GET /entities/{id}/state?recent_from=` | lector | estado de la entidad (§12.3): 6 respuestas + prioridad P0–P4 con textos |
| `GET /swarm/signals` | lector | señales del enjambre (§12.2) |
| `GET /audit?since=` | lector | `{intact, records[]}` |
| `GET /events` (SSE) | lector | cada registro nuevo de la bitácora: `id: <seq>`, `event: <acción>`, `data: <registro JSON>`; reanuda con `Last-Event-ID` |
| `POST /monitors/{id}/observations` | operador | `{times, values, signed?}` → `{alerts_opened_or_updated}` |
| `POST /reports` | operador | reporte del enjambre (§12.1) → 201 |
| `POST /alerts/{id}/transition` | operador | `{to, note}`; el actor es el nombre de la llave |
| `POST /monitors` | admin | `{id, entity, variable, period, params?, org?}` → 201 |
Errores: 400 (dato inválido, con motivo), 401 (sin llave), 403 (sin permiso), 404, 413 (> 5 MB). CORS abierto por defecto (configurable).

## 15 · Inicio «Mis monitores» (`home.json`, v0.9, aditivo) — doc «Modos de profundidad… v2» §5
Lo escribe `python -m zon home --place … --var … --out apps/web/public/bundles` (`zon/home.py`). La web lo lee si existe; si no, el inicio es el de siempre.
- `entities[]`: una por lugar seguido, **ordenadas por la prioridad de HORI** (P0 primero) y luego por nombre. Cada una: `entity` (§10.1 + `kind`, `alternatives`), `monitors[]`, `events[]` y `state` = `hori.api.entity_state` (§12.3) tal cual.
- `monitors[]`: uno por variable: `finding` (veredicto regional del lugar = misma regla y mismo número que `zon.query.query_place(...)["regional"]`; solo años completos), `series` (anomalía anual usada en la prueba), `timeline` (ventanas crecientes: `ends`, `verdict`, `effect`, `emergence_year`, `first_probado`, `withdrawals`, `event`, `consistent` = la última ventana reproduce el veredicto completo), `anomalies[]` (detector mensual de §11.1, las últimas 12, con `recent`), `data` (`last_month` ≠ `computed_at`, fuente, versión, `n_cells`, `resolution_deg`, `cell_km`, `input_sha256`), `method`.
- `events[]`: `{id, monitor, type, tray, date, …}`. `id` es **estable** (la web guarda «visto» por id: no vuelve a avisar lo mismo). `tray` ∈ `evidencia` (EMERGENCIA, CRUZO, SE_DEBILITO, CAMBIO_SIGNO, anomalías del fenómeno) · `calidad` (`sin_datos`, `congelado`, `fuera_de_rango`, CAMBIO_DE_VERSION) · `seguimiento` (alertas y aportes, cuando haya cuentas).
- `calibration`: las cifras medidas que la web muestra en «¿qué tan seguro?» (MODEL_CARD §3.1 y §3.9). `honesty`: frase fija.
- La familia FDR de una consulta de lugar es **el lugar** (1 serie regional): `method.family` lo dice.

