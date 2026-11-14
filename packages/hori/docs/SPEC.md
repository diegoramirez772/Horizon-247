<!-- HORI v0.1 method specification (travels with the package). -->


# HORI v0.1 — especificación

> **Qué es:** el modelo **no generativo** que decide. Funciones puras y deterministas: mismos datos + misma configuración + misma semilla → mismo resultado. Sin LLM, sin red, sin estado oculto.
> **Entrada:** un cubo de observaciones con calidad y procedencia. **Salida:** hallazgos por entidad en el formato del contrato.
> **Etiquetas:** 🧮 medido por simulación propia · ❓ no medido todavía.

## 1 · Corrección importante antes de empezar
La Etapa 3 recomendó exigir coincidencia de **PW y TFPW-Y**. Al diseñar, medí la potencia con efectos más grandes y encontré que **eso estaba mal**: el pre-blanqueo simple (PW) **pierde potencia con tendencias fuertes** (n=23, φ=0.3: 25 % a 1 σ/déc, 39 % a 2 σ, 44 % a 3 σ, 64 % a 5 σ), porque la tendencia infla la autocorrelación que estima y el método la elimina. Esta especificación usa la regla corregida (§5).

## 2 · Tuberías (qué hace HORI con una capa)
```
cubo (tiempo × entidades) ──► 1 agregar ──► 2 filtrar ──► 3 magnitud ──► 4 pruebas ──► 5 FDR
        ──► 6 detectabilidad ──► 7 veredicto ──► 8 estabilidad (opcional) ──► bundle
```

### Paso 1 · Agregar
- **Tierra:** anomalía mensual respecto a la climatología de la ventana → **media anual**, válida con **≥ 9 de 12 meses**. La agregación es **anual** (decisión D9: mensual cuesta ~18 min por variable y aporta ruido; Collaud Coen recomienda granularidad fina para ganar potencia, pero con MK estacional; se deja como mejora).
- **Marte:** promedio por **estación de Ls** (4 trimestres) y año marciano; 13 valores por estación. Se prueba cada estación.
- **Regla de ventana:** n ≥ 10 años (Collaud Coen: menos de 10 con mucha cautela, menos de 8 no usar). Si n < 10 → `INSUFICIENTE`.

### Paso 2 · Filtrar por celda
- `nvalid ≥ max(10, 80 % de n)`; huecos **interiores** ≤ 2 años se interpolan linealmente y se **marcan** (`cobertura_baja` si hubo); huecos en los extremos se descartan.
- Máscara de tierra/mar según la variable. Las celdas sin dato → `INSUFICIENTE`.

### Paso 3 · Magnitud
- **Pendiente de Sen** `b` (mediana de pendientes por pares), en **unidades por década**.
- `σ̂` = desviación estándar de la serie sin tendencia; el efecto también se expresa en **σ por década** (comparable entre variables).
- **Intervalo:** `b ± 1.96·se`, con `se` de la regresión con varianza AR(1) (ver paso 4). **Es aproximado:** el intervalo clásico de Sen supone años independientes y queda angosto. ❓ *Cobertura del intervalo no medida; tarea de validación.*

### Paso 4 · Tres pruebas de tendencia
Sea `n` el número de años y `r̂` el coeficiente de autocorrelación de lag 1 de la serie **sin tendencia**, corregido por sesgo: `r̂ = clip(r1 + (1+3·r1)/n, 0, 0.95)` (Kendall 1954; aproximación).
1. **MK-VC:** `z = z_MK / √((1+r̂)/(1−r̂))`.
2. **TFPW-WS** (Wang y Swail 2001, iterativo): repetir 6 veces — quitar la tendencia `b`, estimar `r̂` de la serie sin tendencia, blanquear la serie **original** `Y_t − r̂·Y_{t−1}`, y recalcular `b` como pendiente de Sen del resultado dividida por `(1−r̂)`; el estadístico es MK de la serie blanqueada.
3. **OLS-AR(1):** pendiente por mínimos cuadrados; `se = √( s²/Sxx · (1+r̂)/(1−r̂) )`; `z = b_OLS/se`.
Valores `p_i = 2(1−Φ(|z_i|))`. **`p_cons = max(p_VC, p_WS, p_OLS)`** (prueba de intersección–unión: es significativo solo si los tres lo son).
- Se guarda también `naive_sig`: el MK sin ninguna corrección, **solo** para la pantalla «ingenuo vs honesto».

### Paso 5 · Control de falsos descubrimientos
**Benjamini–Hochberg** sobre `p_cons` de todas las celdas válidas de la capa, `q = 0.10` → `q_cons`. (Si `α` crudo se cumple pero BH no → `CANDIDATA`.)

### Paso 6 · Detectabilidad
- `se_ideal = σ̂ · √( 12/(n(n²−1)) · (1+r̂)/(1−r̂) )`
- `MDE_ideal (por década) = 10 · 2.8016 · se_ideal` (80 % de potencia, α=5 %, dos colas).
- **`MDE = f(n, r̂) · MDE_ideal`**, con el factor medido 🧮 para **nuestra regla de consenso** (la regla real es menos potente que la ideal):

| n \\ φ | 0.0 | 0.3 | 0.5 |
|---|---|---|---|
| 15 | 1.49 | 1.49 | 1.73 |
| 23 | 1.31 | 1.27 | 1.41 |
| 40 | 1.22 | 1.19 | 1.22 |
Interpolación lineal en `n` y en `r̂`; fuera de [15, 40] se usa el borde y se marca. Si `r̂ > 0.5` → bandera `autocorrelacion_alta` (MDE subestimado). ❓ *La tabla se midió con φ **verdadero**; en uso solo se conoce `r̂`; es una aproximación.*
- **Años que faltan** para poder descartar cambios ≥ δ: `n' = n · (MDE/δ)^(2/3)` (porque el MDE decrece como `n^(−3/2)`); `years_more = ⌈n' − n⌉`, 255 si > 60. **Nunca se calcula con el efecto observado** (sería «potencia posterior», una falacia): siempre con `δ`.

### Paso 7 · Veredicto (en este orden)
1. `nvalid` insuficiente → **INSUFICIENTE**.
2. `q_cons ≤ 0.10` **y** los 3 métodos significativos al α crudo → **PROBADO**.
3. Algún método significativo al α crudo (o `p_cons ≤ α` sin FDR) → **CANDIDATA**; si 1–2 de 3 → además bandera `depende_del_metodo`.
4. Ninguno significativo y `MDE ≤ δ` → **SIN_CAMBIO_MAYOR_QUE_DELTA**.
5. Ninguno significativo y `MDE > δ` → **NO_CONCLUYENTE** (+ `years_more`).
- **δ por defecto = 2 σ por década**, ajustable en la interfaz (1 / 2 / 3 σ o unidades físicas). *Razón:* con n≈24, δ=2 σ es detectable ~90 % y además descartable con potencia ≥80 % en la mayoría de celdas; con δ=1 σ casi todo sería «no concluyente» (Etapa 3 §3.6). ❓ **El equipo de ciencia debe revisar este valor por variable.**

### Paso 8 · Estabilidad de la ventana (opcional, nivel 2)
Para varios inicios de ventana con n ≥ 10, repetir pasos 3–7 y guardar `window_stability` = proporción de ventanas con el mismo signo y mismo veredicto. **La interfaz no deja elegir la «mejor» ventana** (eso sería *p-hacking*): enseña la estabilidad. Dos ventanas declaradas de antemano para la temperatura: **24 años (2001–2024)** y **45 años (1980–2024)** — contrastarlas muestra cómo el registro más largo convierte «aún no se puede saber» en «probado».

### Paso 9 · Ventanas crecientes y regiones nombradas (aportes del equipo, v0.2)
- **Ventanas crecientes:** para cada año de fin `e` con `n ≥ 10`, repetir los pasos 3–7 sobre `[inicio, e]` (FDR dentro de cada ventana) → `windows/<e>/`. `emergence_year` = primer `e` desde el cual el veredicto es **PROBADO** y se mantiene hasta el final; `NaN` si nunca. Costo ≈ 15 × una capa (~2 min a 75 000 celdas ❓ estimado desde los 7 s medidos). **Estas ventanas son anidadas, no independientes**: no se interpretan como pruebas repetidas.
- **Regiones nombradas:** serie regional = media ponderada por área (`cos φ`) y por celdas válidas; se aplica **la misma regla** (pasos 1–7) a esa serie; **FDR (BH) entre las regiones** de la lista. Con `n_cells < 4` → `resolucion_gruesa`.
- **Evento EMERGENCIA:** cambio de veredicto a PROBADO al ampliar la ventana, con la evidencia de esa ventana.
- **No se calcula ninguna «consecuencia»:** HORI solo emite **observaciones**; asociaciones, riesgos potenciales y acciones son **nivel web, con fuente** (Santuario H16).

## 3 · Parámetros (un solo archivo `hori.yaml`)
```yaml
alpha: 0.05
fdr_q: 0.10
delta_sigma_per_decade: 2.0
min_years: 10
windows_expanding: {enabled: true, min_n: 10}
regions_fdr: BH
min_valid_fraction: 0.80
max_interior_gap_years: 2
tfpw_ws_iterations: 6
r1_clip: [0.0, 0.95]
mde_power: 0.80
seed: 247
```

## 4 · Reuso y reproducibilidad
Dependencias mínimas: `numpy` (y `scipy.special` si está; `erfc` propia de respaldo). Toda salida escribe `build` (versiones, semilla, hash de entrada). **Declarar y citar** las librerías usadas (regla de entrega, Etapa 3 §7).

## 5 · Evidencia de la regla elegida 🧮
Falsas alarmas (sin tendencia real; nominal 5 %) y potencia, 10 000 series por fila (anexos `rule_search`, `diag_power`):

| Regla | n | φ | Falsas alarmas | Potencia 1 σ/déc | Potencia 2 σ/déc |
|---|---|---|---|---|---|
| MK ingenuo | 23 | 0.5 | 21.5 % | 74 % | 99 % |
| PW (original) | 23 | 0.3 | 4.1 % | 26 % | **39 %** ⚠ no sube con el efecto |
| MK-VC solo | 23 | 0.3 | 6.7 % | 56 % | 95 % |
| **Consenso (VC, WS, OLS)** | **23** | **0.3** | **5.2 %** | 49 % | **92 %** |
| MK-VC solo | 23 | 0.5 | 8.7 % | 42 % | 83 % |
| **Consenso** | **23** | **0.5** | **6.8 %** | 37 % | **78 %** |
| **Consenso** | **40** | **0.5** | **5.6 %** | 91 % | 100 % |

**Por qué consenso y no «mejor método»:** el consenso queda **más cerca del 5 % nominal** que cualquiera de sus partes, **conserva la potencia** (monótona con el efecto) y **hace explícita la robustez al método** (la bandera `depende_del_metodo`). El costo: 5–7 puntos menos de potencia a 1 σ/década frente a MK-VC solo.

**FDR sobre `p_cons`** (mapa 60×60, n=23, φ=0.3, 60 réplicas):
| Señal real | q | Falsas entre lo marcado | Zona real detectada |
|---|---|---|---|
| escasa (4 % del mapa) | 0.10 | **12.6 %** | 21 % |
| escasa | 0.05 | 4.8 % | 5.5 % |
| abundante (16 %) | 0.10 | **10.8 %** | 29 % |
| abundante | 0.05 | 6.0 % | 22 % |
Con `p(MK-VC)` solo y q=0.10 las falsas eran 23 % (escasa) y 15 % (abundante): **el consenso arregla la calibración de FDR**. Se elige **q = 0.10**: queda cerca del 10 % nominal; q=0.05 exige casi nada.
**Lo que no cubre:** ruido AR(1) gaussiano, sin estacionalidad residual, saltos ni cambios de varianza; correlación espacial de una sola forma; n ≤ 40. **Con datos reales la calibración puede ser peor**; se mide en la ejecución.

## 6 · Modo secuencial (persona simulada)
- **Generador (simulado y rotulado):** línea base personal + ritmo circadiano (1–2 armónicos) + ruido AR(1) + cambio inyectado (escalón o deriva) en un instante conocido.
- **Detector:** ajustar línea base y circadiano sobre las primeras `K` muestras; **blanquear** residuos con AR(1); CUSUM de dos lados con holgura `k=0.5σ` y umbral `h` **calibrado por simulación** para un **ARL₀ objetivo** (p. ej. 500 muestras) ❓ *(a medir)*; opcionalmente EWMA.
- **Salida:** alarma con **retraso medido** y **tasa de falsas alarmas medida**; el mismo veredicto («probado», «aún no», «sin cambio ≥ δ») pero con `δ` en σ de la línea base y retraso en lugar de años.
- **Etiqueta fija:** «simulado · no es tecnología médica». Sin datos personales reales.

## 7 · Autopruebas que acompañan al código
1. **Respuesta conocida:** MK y pendiente de Sen sobre secuencias conocidas.
2. **Calibración:** repetir la simulación de §5 con tolerancias (falsas alarmas ≤ 8 % a n=24, φ ≤ 0.5; potencia a 2 σ/déc ≥ 75 %; falsas entre lo marcado por FDR ≤ 15 %). Si falla, no se publica la capa.
3. **Monotonía:** la potencia **no** debe bajar al subir el efecto (detecta el defecto de PW).
4. **Tendencias publicadas** (tolerancias a fijar con el valor oficial al momento de probar): tendencia global de GISTEMP; declive del hielo marino ártico de septiembre (NSIDC); en Marte, que las tormentas globales conocidas (años marcianos 25, 28, 34 ❓ *verificar*) aparezcan como eventos.
5. **Procedencia completa:** toda capa con `dataset.version`, `sha256`, `licence`, `window`, `params`, `build`.
6. **Reproducción:** `zon build <capa>` desde cero reproduce `sha256` de salidas con las versiones fijadas.
