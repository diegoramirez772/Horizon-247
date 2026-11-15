# Ficha del modelo — HORI v1

> Formato inspirado en las *model cards* de los laboratorios de IA. Cada número viene de una medición reproducible
> en este repositorio (`sim/` o `packages/*/tests`). Marcas: **[medido]** lo corrimos nosotros · **[publicado]**
> fuente externa citada · **[supuesto]** decisión del equipo, por revisar.

## 1 · Qué es
**HORI** es un motor de inferencia estadística **no generativo**: convierte series de observación en afirmaciones
sobre cambios («la temperatura de Chihuahua sube 0.51 °C por década») con **tasa de error controlada**,
**procedencia reproducible** y la capacidad de decir **«aún no se puede saber»**. No predice, no genera texto, no
se entrena: se **calibra por simulación** y se **valida contra datos independientes**. Corre solo en CPU.

**Uso previsto:** detectar y afirmar tendencias en series de observación de la Tierra (y, con el mismo núcleo,
otras entidades) con el error medido. **Fuera de alcance:** pronóstico, atribución de causas, diagnóstico médico,
alertas de peligro, consejos.

## 2 · Cómo decide (resumen)
| Paso | Qué hace | Garantía |
|---|---|---|
| Agregación | Media anual de anomalías mensuales (≥ 9 de 12 meses), huecos interiores ≤ 2 años rellenados | — |
| Tres pruebas | MK con varianza corregida · TFPW-WS · OLS con varianza AR(1); pendiente de Sen | Asintótica, ruido AR(1) |
| Consenso | PROBADO solo si las tres son significativas **y** sobrevive al FDR | Empírica (simulación) |
| Mapa | Benjamini–Hochberg q = 0.10 sobre **toda la familia** de la afirmación (planeta para el mapa global, lugar para una consulta) | Exacta bajo dependencia positiva; empírica con correlación espacial |
| «Aún no se sabe» | Efecto mínimo detectable (MDE) con factor medido; años que faltan para ver δ | Empírica |
| Perfil | Inferido de los metadatos (unidades, nombre, límites) y de los datos; δ de una tabla curada de **clases físicas** | Cada decisión queda escrita en el bundle |
| e-valores | Mezcla gaussiana sobre cada z (τ = δ/se, fijado antes de ver el efecto); media de las 3 pruebas; e-BH | **Válida bajo cualquier dependencia** entre pruebas y celdas (dado el modelo de ruido) |
| Calidad | Recta contra «recta + escalón» y «escalón solo» → bandera `quiebre_posible` + año | Umbrales simulados |
| Multifuente | «Confirmado por N fuentes»: PROBADO en ≥ 2 fuentes, mismo signo, media de e-valores ≥ 20 | Media de e-valores: válida con fuentes dependientes |
| Máquina del tiempo | HORI corrido «como si estuviera en» cada año (ventanas crecientes) → año de emergencia, eventos, reversiones | Ensayo retrospectivo con la versión actual de los datos |

## 3 · Métricas medidas
### 3.1 Calibración (simulación, ruido AR(1) gaussiano) [medido]
| Condición | Falsas alarmas del consenso | Potencia a 2σ/década |
|---|---|---|
| n = 23, φ = 0.3 | **5.2 %** (pruebas sueltas: 6.7–8.3 %) | 92 % |
| n = 23, φ = 0.5 | 6.8 % | 78 % |
| Mapa 60×60 correlacionado, señal escasa | FDR real 12.6 % con q = 10 % | — |

### 3.2 Series trampa (red team, `tests/test_redteam.py`) [medido, 400 celdas, n = 24]
| Trampa | PROBADO falsos | Estado |
|---|---|---|
| Un año extremo al final (+5σ) | ≤ 2 % | ✅ |
| Estacionalidad fuerte sin tendencia | ≤ 2 % | ✅ |
| Huecos en los últimos 4 años | 0 (todo INSUFICIENTE) | ✅ |
| Mapa nulo muy correlacionado (factor común) | ≤ 2 % | ✅ |
| Persistencia fuerte (φ = 0.8) sin tendencia | ≤ 5 % | ✅ |
| **Salto de 3σ (cambio de versión)** | **54 %** (41 % lleva aviso) | ❌ **límite conocido** |
| **Caminata aleatoria** | **12 %** (35 % lleva aviso) | ❌ **límite conocido** |

### 3.3 Detección de saltos (`tests/test_quality.py`) [medido, φ = 0.3, salto a la mitad]
| n | Falsas (ruido) | Falsas (tendencia real) | Atrapa 2σ | Atrapa 3σ |
|---|---|---|---|---|
| 24 | 0.9 % | 2–4 % | 19 % | 55 % |
| 40 | 5 % | 6 % | 40 % | 79 % |
«Sin bandera» **no** significa «homogéneo».

### 3.4 e-valores frente a p-valores [medido]
- Simulación (4,000 celdas, 10 % con señal): e-BH pierde 2–3 puntos de potencia frente a BH y tiene FDP más baja (0.9–6 % contra 10–12 %).
- **Planeta real, calibrador p→e (v0):** 2001–2024 → **0** descubrimientos e-BH contra 24,304 con BH; 1981–2025 → 39 % de los de BH.
- Literatura [publicado]: la pérdida de e-BH frente a BH es conocida; e-BH-CC la recupera (Lee y Ren 2024).
- **Decisión:** el veredicto sigue con BH; e-BH se publica en paralelo como «núcleo robusto a cualquier dependencia». Con e-valores de mezcla (§3.12): 66 % de los de BH en 1981–2025; con el nulo real (§3.9) es lo único que mantiene el nivel nominal en ambos modelos de ruido.

### 3.5 Contra la realidad: GISTEMP v4, 1981–2025 [medido]
| Comparación | POWER/MERRA-2 | GISTEMP | Lectura |
|---|---|---|---|
| **Durango (polígono), veredicto regional** | PROBADO +0.49 [0.35, 0.63] °C/déc | PROBADO +0.35 [0.28, 0.43] | **Confirmado por 2 fuentes**, magnitudes compatibles (z = 1.64) |
| Tierra, tendencia media | 0.25 °C/déc | 0.33 | MERRA-2 ~22 % más bajo |
| **Ártico (> 66° N), tierra** | **0.34** | **0.62** | **MERRA-2 subestima ~45 %** |
| Trópicos, tierra | 0.24 | 0.27 | Similar |
| Celdas de tierra a 2°: mismo signo | 94 % | | |
| Celdas de tierra a 2°: correlación de pendientes | 0.29 | | Baja: no comparar celda a celda |
**Consecuencia para el producto:** las afirmaciones se cruzan a escala **regional**; en el Ártico el mapa POWER
se rotula «subestima el calentamiento frente a observaciones».

### 3.6 Escala y costo (laptop, 2 núcleos, ~6 GB) [medido]
| Trabajo | Tiempo | RAM pico |
|---|---|---|
| Planeta 207,936 celdas, 24 años | 52 s | 192 MB |
| Planeta, 45 años | 136 s | 245 MB |
| Una consulta («Chihuahua») | 0.1–0.3 s (Groenlandia: 6 s) | — |
| Descarga POWER global por variable | 1–23 min según la red | streaming |

### 3.7 Reproducibilidad [medido]
Mismo input + misma versión = **bundle idéntico byte a byte** (`SOURCE_DATE_EPOCH`). Durango leído por la API y
por el cubo Zarr de AWS produce los mismos arreglos (golden en CI).

### 3.8 Máquina del tiempo del planeta, T2M 1981–2025 [medido, 207,936 celdas, 31 ventanas crecientes 1995…2025]
Se corre HORI «como si fuera» cada año, con solo los años disponibles entonces (misma regla, FDR dentro de cada ventana). **Es un ensayo retrospectivo con la versión actual de los datos**, con ventanas anidadas (no son pruebas independientes ni lo que se publicó cada año).
| Año de la ventana | Área PROBADO | De ese PROBADO, sigue PROBADO en 2025 |
|---|---|---|
| 2005 | 8.9 % | 82 % |
| 2010 | 32.1 % | 93 % |
| 2015 | 37.4 % | 95 % |
| 2020 | 51.0 % | 97 % |
| 2025 | 62.3 % | 100 % |
- Año de emergencia (cuándo quedó PROBADO y ya no se retiró), celdas PROBADO hoy: percentiles 10/25/50/75/90 = **2006 / 2009 / 2016 / 2020 / 2024**. Ártico (> 60° N): 78.6 % PROBADO hoy, mediana 2016; trópicos 71.7 %, mediana 2010.
- **Retiros reales:** 11.3 % de las celdas que alguna vez fueron PROBADO ya no lo son; **3.86 %** de transiciones «PROBADO → no PROBADO» por celda-año PROBADO; 22 % de las celdas tuvo al menos un retiro (10,573 ≥ 2). **Cambio de signo (probado subiendo y luego bajando): 7·10⁻⁵ de las celdas que alguna vez fueron PROBADO** (el error grave casi no ocurre).
- Eventos de la última ventana (2024 → 2025): 6,716 cruzaron a PROBADO, 1,423 se debilitaron, 0 cambiaron de signo.
- La última ventana reproduce el bundle global **celda por celda (207,936/207,936 veredictos iguales)**. Tardó 63 min con 2 núcleos (cuello de botella: la pendiente de Sen en cada ventana).
- Lectura honesta: «sigue PROBADO en 2025» mide **estabilidad de la evidencia**, no que la afirmación sea verdadera; un retiro puede venir también de que la familia FDR cambia con la ventana.

### 3.9 Calibración con nulo REAL: el ruido del propio planeta, sin tendencia (`sim/null_planet.py`) [medido]
**Cómo:** se toma el cubo anual real T2M 1981–2025, se **destruye la tendencia** aleatorizando las fases de Fourier con **la misma fase en todas las celdas** (conserva la autocorrelación de cada celda **y** la correlación espacial entre celdas; Theiler et al. 1992) y se corre HORI completo sobre el mapa sintético. Se **inyecta** una tendencia conocida de +0.3 °C/déc (= δ) en ~20 % del mapa, en bloques de 8×8 celdas. Todo hallazgo fuera de esos bloques es falso por construcción. 30 realizaciones, celdas a 1° (52,128), mismo FDR (q = 10 %) sobre todo el mapa.
Hay dos versiones porque **tendencia y variabilidad lenta no se separan con 45 años**: *quitando la recta antes* se elimina también parte de la variabilidad lenta real (**optimista**); *sin quitarla* la tendencia real se convierte en ruido lento (**pesimista**). La verdad está en medio.
| Métrica | Optimista | Pesimista |
|---|---|---|
| Tamaño por celda a α = 0.05: consenso de 3 pruebas / «cualquiera» / OLS ingenuo | 3.3 % / 7.4 % / 9.7 % | 11.7 % / 21.3 % / 32.7 % |
| **FDR real de PROBADO** (nominal 10 %): media (desv.) · peor realización | **5.9 %** (6.3) · 22 % | **23.8 %** (21) · 70 % |
| FDR real con el marcador «robusto a memoria larga» | 3.9 % | 22.0 % |
| FDR real de e-BH | 1.1 % | **9.3 %** |
| Potencia de PROBADO a δ = 0.3 °C/déc (sobre las celdas con señal) | 69.7 % | 46.2 % |
| Potencia del marcador robusto / de e-BH | 67.1 % / 56.5 % | 45.3 % / 36.0 % |
| Cobertura del IC al 95 % · sesgo del efecto | 94.3 % · +0.002 °C/déc | 81.8 % · +0.003 °C/déc |
| Celdas sin cambio marcadas `quiebre_posible` | 5.0 % | 25.7 % |
**Potencia por MDE/δ (celdas con señal, ruido optimista):** ≤ 0.5 → 99.97 % · 0.5–0.8 → 98.0 % · **0.8–1.0 → 80.5 %** · 1.0–1.5 → 47 % · > 1.5 → 13 %. Es decir: **donde el MDE ≈ δ, la potencia del 80 % que HORI promete se cumple con datos reales del planeta**. Con el ruido pesimista esa celda baja a 56 %: el «años que faltan» es optimista si hay variabilidad lenta más allá de AR(1).
**Lectura honesta:** (1) el FDR de PROBADO está **por debajo del 10 % nominal con el ruido optimista y lo supera (≈ 24 %) con el pesimista**; lo defendible es «entre 6 % y 24 %». (2) **e-BH es lo único que se mantiene en el nivel nominal en ambos casos** (1.1 % y 9.3 %), a costa de ~13 puntos de potencia: por eso se publica como «núcleo robusto». (3) El FDR de un mapa con correlación espacial es **muy variable entre realizaciones** (desviación ≈ igual a la media): un mapa concreto puede salir mucho peor o mejor que el promedio. (4) Límites de esta prueba: una variable, un periodo, 30 realizaciones, celdas a 1°, un tamaño de señal.

**Lluvia (PRECTOTCORR, 1981–2025, δ = 0.2 mm/día/déc, 12 realizaciones, mismo método)** — la asimetría de la lluvia no rompe la calibración, y el marcador de memoria larga ayuda más que en temperatura:
| Métrica | Optimista | Pesimista |
|---|---|---|
| FDR real de PROBADO (nominal 10 %) · peor realización | 7.1 % · 20 % | 19.8 % · 40 % |
| FDR con marcador robusto / con e-BH | 3.7 % / 1.4 % | 11.8 % / 4.6 % |
| Potencia de PROBADO / robusto / e-BH | 78.0 % / 74.6 % / 69.6 % | 76.8 % / 74.3 % / 68.7 % |
| Potencia donde MDE/δ ∈ [0.8, 1.0) | 78.7 % | 77.2 % |
| Cobertura IC 95 % | 93.3 % | 85.7 % |
Planeta, lluvia 1981–2025: 31,876 celdas PROBADO (15 %), 24,538 robustas a memoria larga (77 %), 10,902 por e-BH; **99,437 celdas (48 %) con «sin cambio mayor que δ»** (la lluvia casi no se mueve a esa escala). No hay segunda fuente de lluvia cruzada todavía (IMERG pide cuenta Earthdata).

### 3.10 Memoria larga (Hamed 2008) y el marcador «robusto» [medido; `sim/longmemory_*.py`, `tests/test_longmemory.py`]
- La **varianza exacta de Mann–Kendall bajo ruido fGn(H)** está implementada; con H = 0.5 reproduce `n(n−1)(2n+5)/18` exacto y coincide con una simulación de Monte Carlo (n = 20, H = 0.8, 20,000 series) dentro de ±5 % (lo exige la prueba).
- **No se estima H por celda.** Estimarlo por máxima verosimilitud sobre las puntuaciones normales de la serie sin la recta de Sen sale **sesgado hacia abajo**: H verdadero 0.8 → estimado **0.60 (n = 24) y 0.67 (n = 45)**; con H = 0.9 → 0.65 y 0.74. La recta de Sen absorbe parte de la oscilación lenta: con tan pocos años **tendencia y memoria larga no se separan** (el test de Hamed con H estimado casi no cambió el resultado en la simulación).
- **Lo que sí se hace:** un marcador de sensibilidad con H **fijo = 0.7** (`robust_mem.u8`): una celda PROBADO es «robusta a memoria larga» si sigue significativa a α con esa varianza. Falsas por celda a α = 0.05 (n = 45, sin FDR): ruido fGn(0.7) **10.4 % → 4.2 %**; fGn(0.8) 13.7 % → 8.9 %; fGn(0.9) 17.2 % → 14.7 %; AR(1) 0.3: 4.6 % → 1.3 %. Costo en potencia: ninguno a n = 45 con ≥ 1σ/déc; a n = 24 y 1σ/déc baja de 73 % a 55 %.
- **En el planeta:** 1981–2025 → **111,307 de 129,645 PROBADO (85.9 %) son robustos**; 2001–2024 → 23,474 de 24,304 (96.6 %). En el nulo real: baja el FDR del PROBADO de 5.9 % a 3.9 % (optimista), casi nada con el pesimista (23.8 % → 22.0 %).
- **No rescata la caminata aleatoria** (H → 1 está fuera de fGn): 48/400 PROBADO falsos, los 48 siguen «robustos». Sigue siendo límite conocido.

### 3.11 Saltos de versión del producto (MERRA-2) [medido]
MERRA-2 se produjo en 4 «corrientes» (cambios en 1992, 2001 y 2011; UCAR Climate Data Guide, reanalyses.org). Se comprobó si las celdas con `quiebre_posible` se apilan en esos años (±1): **11 % observado frente a 22 % esperado si los saltos cayeran al azar** → **no hay evidencia de artefactos de corriente en T2M**. (Diagnóstico en `manifest.quality.known_breaks`; no cambia veredictos.)

### 3.12 e-BH en el planeta [medido]
Con e-valores de mezcla (τ = δ/se): 1981–2025 → **89,024 descubrimientos e-BH frente a 134,531 con BH (66 %)**; 2001–2024 → 10,803 frente a 24,304 (44 %). Antes (calibrador p→e): 39 % y 0 %.

## 4 · Limitaciones conocidas
1. **Memoria larga:** no se corrige el veredicto; se publica un marcador (`robust_mem`) y el límite medido (§3.10). La caminata aleatoria sigue engañando al consenso (12 %).
2. Un **salto artificial** grande se lee como tendencia en la mitad de los casos; la bandera avisa en ~40 %. En T2M no se vio apilamiento en los cambios de corriente de MERRA-2 (§3.11).
3. **FDR de PROBADO entre 6 % y 24 %** según cuánta variabilidad lenta sea ruido (§3.9); e-BH mantiene el nivel (1–9 %) con menos potencia.
4. MERRA-2 **subestima el calentamiento ártico** frente a GISTEMP.
5. La tabla del MDE está medida hasta n = 40; con 45 años se usa el valor de n = 40. El nulo real confirma 80 % de potencia donde MDE ≈ δ (§3.9), pero solo con el ruido optimista.
6. δ de cada clase física es **valor de trabajo del equipo**, no de la literatura.
7. Solo tendencias monótonas; aceleraciones o ciclos no se modelan.
8. Fronteras de Natural Earth admin-1: algunas en disputa (advertencia del propio proveedor). Las regiones físicas («Sahara», «Andes», «Golfo de México») tienen límites aproximados; un lugar que cruza el antimeridiano funciona pero lee todas las columnas de longitud.
9. La actualización incremental (Z3) re-lee los 260 trozos del planeta: un trozo de Zarr abarca todos los meses, así que «solo el mes nuevo» no existe a nivel de descarga (§Z3 en `zon/update.py`).

## 5 · Evitar mal uso
- Nunca mostrar «probado» sin el MDE, el δ y las banderas.
- Lo simulado se marca como simulado (Santuario H5).
- Una anomalía o tendencia **no** es prueba de daño, enfermedad o peligro (H12).
- El asistente narra con plantillas y números de HORI; no genera cifras (H19).

## 6 · Datos y licencias
NASA POWER (MERRA-2) vía AWS Open Data · NASA GISTEMP v4 (GISS) · Natural Earth (dominio público) · GeoNames
(CC BY 4.0, atribución requerida). Código propio con NumPy y la biblioteca estándar de Python; sin dependencias GPL.

## Fuentes
- Vovk y Wang 2021, calibradores de e-valores: https://projecteuclid.org/journals/annals-of-statistics/volume-49/issue-3/E-values-Calibration-combination-and-applications/10.1214/20-AOS2020.full
- Wang y Ramdas 2022, e-BH: https://arxiv.org/abs/2009.02824
- Lee y Ren 2024, e-BH-CC: https://arxiv.org/abs/2404.17562
- NASA, tendencia global ~0.15–0.20 °C/década desde 1975: https://science.nasa.gov/earth/earth-observatory/world-of-change/global-temperatures/
- NOAA Arctic Report Card, Ártico ~3× el promedio: https://arctic.noaa.gov/?p=11285
