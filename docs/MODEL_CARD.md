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

### 3.13 Anomalías sobre cualquier flujo (`hori/anomaly.py`, `sim/anomaly_calibration.py`) [medido, 100 realizaciones por celda de la tabla]
Modelo causal (cada muestra se juzga solo con el pasado): nivel = media del último ciclo; esperado = mediana de los K ciclos previos en la misma fase; z = residuo / escala robusta (MAD o IQR, encogida hacia la escala de su fase). Tres detectores: `punto` (|z| ≥ 3.5), `cambio_nivel` (CUSUM bilateral, h = 5, con inflación por autocorrelación) y `sin_datos`. Flujos de prueba: ciclo de amplitud 5σ + ruido AR(1) (φ = 0, 0.3, 0.6), ruido t de Student con 5 g.l. (colas pesadas) y ruido que cambia con la fase. **Las magnitudes están en σ del ruido del flujo** (el residuo trae más varianza, por eso un pico de +4σ no da z = 4).
| Falsas alarmas por 1000 muestras juzgadas | Periodo 24 (horario) | Periodo 12 (mensual) |
|---|---|---|
| Gaussiano φ = 0 / 0.3 / 0.6 — puntos | 1.5 / 1.3 / 1.5 | 1.6 / 1.7 / 1.7 |
| Gaussiano φ = 0 / 0.3 / 0.6 — cambios de nivel | 2.8 / 1.5 / 0.5 | 1.8 / 0.9 / 0.2 |
| **Colas pesadas (t5)** — puntos / cambios | **7.5** / 2.4 | **9.1** / 2.2 |
| **Ruido que cambia con la fase** — puntos / cambios | **13.1** / 5.6 | **7.0** / 1.9 |
| Potencia | Periodo 24 | Periodo 12 |
|---|---|---|
| Pico de +3σ / +4σ / +5σ / +6σ / +8σ en esa muestra | 25 / 43 / 76 / 87 / 100 % | 27 / 55 / 77 / 90 / 100 % |
| Cambio de nivel de +1σ / +2σ / +3σ durante 1.5 ciclos (detectado antes de terminar) | 18 / 79 / 99 % (retraso 7 / 6 / 2) | 17 / 46 / 84 % (retraso 6 / 4 / 3) |
**Lectura honesta:** (1) con ruido gaussiano son ~3 falsas por 1000 muestras en total; con colas pesadas o con varianza que cambia por fase suben a 7–15: **un flujo real así dará más alarmas de las que el umbral sugiere**. (2) Un pico necesita ≥ 5σ del propio ruido para verse 3 de cada 4 veces. (3) Un cambio de nivel pequeño y corto (+1σ) casi no se ve: el detector está pensado para desviaciones claras. (4) **La línea base se adapta**: un cambio que dura más de ~1 ciclo se absorbe; por eso al terminar un cambio aparece el contrario (`retorno_probable`), y lo lento le toca a la tendencia. (5) Una anomalía es una desviación estadística, **no** prueba de falla, enfermedad ni peligro (H12).

### 3.14 Tres cuerpos con el mismo núcleo (`sim/universal_demo.py`, `sim/mars_demo.py`) [medido]
| Entidad | Datos | Qué hace el núcleo |
|---|---|---|
| **Tierra** (estado de Washington) | NASA POWER mensual 1981–2026 (real) | Tendencia por celda + monitor de anomalías mensual |
| **Marte** (polvo global, 13 años marcianos) | LMD/Montabone, mapas kriging diarios (**reconstrucción**, CC BY-SA 3.0) | Tendencia por celda: 173 CANDIDATA y 7,027 NO_CONCLUYENTE, ninguna probada (n = 13 < 15: **no calibrado**, marcado). Monitor diario: **la anomalía más fuerte es la tormenta global de polvo de 2018 (MY34, sol 386–472, +60σ, severidad alta)**; también marca MY36 y otros eventos |
| **Astronauta SIMULADO** (FC, temperatura de piel, SpO2 cada 10 min, 30 días) | Generador determinista con verdad conocida | **Encuentra los 5 eventos inyectados** (3 h de FC +22 bpm, un pico de +55 bpm, +0.9 °C durante 40 h con inicio exacto, 100 min sin datos del sensor, SpO2 −5 puntos 1 h). Alertas de más: 2 puntos leves en FC y ~8 alrededor del cambio de la temperatura de piel (la racha dentro del cambio y su retorno) |
Cada entidad es `real`/`simulada` y las alertas lo heredan. **Lo simulado no valida nada sobre personas.** Las alertas tienen ciclo de vida (abierta → reconocida → derivada → cerrada, solo una persona nombrada cambia el estado) y una bitácora con cadena SHA-256 (editar el pasado se detecta). **Validación externa de anomalías en la Tierra:** en estados de EE. UU. con eventos conocidos el detector no se dispara a nivel mensual regional (p. ej. Washington jun-2021, z = 3.3, bajo el umbral): la media mensual de un estado suaviza los extremos.

### 3.15 Enjambre (fuentes no verificadas) y estado unificado de la entidad (`hori/swarm.py`, `hori/state.py`, `sim/swarm_demo.py`)
**Enjambre:** reportes de personas, científicos, instituciones o sensores ciudadanos. **Todo entra como fuente no verificada**; un rol (p. ej. «científico») solo pesa más si alguien lo avala (`verified_by`). Reglas explícitas (valores de trabajo, versión `enjambre-1`, por revisar): persona 1 · científico avalado 2 · institución avalada 2.5 · sensor ciudadano 1.5; evidencia foto/video ×1.3, medición ×1.6, documento ×1.2 (tope ×2), **contada una vez por huella SHA-256**; cada reportante cuenta **una vez** por señal; agrupación por tema (lista fija de palabras, sin modelo de lenguaje) y por cercanía (30 km, 21 días). Escalera: `reporte_aislado` → `senal_ciudadana` (≥ 3 reportantes o índice ≥ 3) → `senal_con_evidencia` (≥ 2 evidencias distintas o una medición) → `corroborada_por_instrumento` (un instrumento de NASA ve lo mismo, **en el mismo sentido**, ahí y entonces). Avisos de manipulación: `un_reportero_domina`, `evidencia_reutilizada_por_varios`, `rafaga` (5+ reportes en 10 min: no puede subir de nivel por sí sola). Privacidad: identificador seudónimo, coordenadas redondeadas a ~1 km, bitácora encadenada.
**Demo honesta (Durango, primavera 2011; reportes SIMULADOS, instrumento real):** 5 reportantes independientes con 4 evidencias distintas → `senal_con_evidencia`, índice 8.1, con aviso de foto reutilizada. **El instrumento a escala del estado NO lo confirma**: lluvia acumulada de 6 meses −1.2σ a mayo de 2011 (la regla pide ≥ 1.5σ; en junio llega a −2.0σ). HORI lo dice así: «puede ser local o menor a su resolución; no lo desmiente». El cielo oscuro, los peces y el frío quedan como reportes aislados, y para fauna y atmósfera **no hay instrumento conectado** (se dice).
**Estado unificado:** una sola respuesta por entidad a las 6 preguntas (qué observamos, identidad, qué ocurre, qué cambió, qué requiere atención, seguimiento) y **una sola lista de prioridad** para tendencias, anomalías y enjambre: P0 cambio conjunto (dos variables o instrumento + enjambre) / anomalía alta reciente · P1 evento de tendencia / anomalía media reciente / sensor enfermo / enjambre corroborado · P2 PROBADO / enjambre con evidencia · P3 por emerger / anomalía leve / señal ciudadana · P4 informativo. Cada línea se arma con plantillas y números de HORI, con origen visible; las pruebas verifican que no haya consejos ni causas.
**Observar mejor:** rango físico (`fuera_de_rango`), sensor congelado (`congelado`, mismo valor ≥ 12 muestras, ×3 en sensores cuantizados), muestreo irregular → rejilla regular sin inventar datos (`zon.monitors.regularize`), déficit acumulado (`accumulated_z`, tipo SPI pero **no** es el SPI).
**No medido todavía:** la tasa de error del enjambre (no hay reportes reales); el umbral de 1.5σ del instrumento de lluvia se fijó en esta demo y **no está calibrado**; la anomalía mensual de lluvia trae colas pesadas (muchos «puntos» en el registro histórico de Durango): falta transformar la lluvia (raíz o logaritmo) antes del detector.

### 3.16 Enjambre calibrado con reportes ciudadanos REALES (`sim/swarm_validation_cocorahs.py`) [medido]
**Datos:** 180,069 reportes de 8,483 personas de la red ciudadana CoCoRaHS (EE. UU., 2016–2026; condition monitoring: cada quien elige de «muy seco» a «muy húmedo» y escribe lo que ve). **Instrumento:** NASA POWER, lluvia acumulada de 3 meses en la celda del reporte (z robusto contra los mismos meses de años previos); «coincide» = |z| ≥ 1 en el mismo sentido. **Azar:** los mismos reportes contra la misma celda y mes de calendario de **otro** año.
| | Coincide con el satélite | Por azar | Lo contradice |
|---|---|---|---|
| Un reporte «seco» / «húmedo» | 27.5 % / 39.6 % | 14.4 % / 19.2 % | 7.5 % / 4.4 % |
| «Muy seco» / «muy húmedo» | 42.4 % / 58.1 % | 14.9 % / 17.6 % | 4.3 % / 1.7 % |
| **Señal de 1 / 2 / 3–4 / 5–9 / 10+ personas independientes** (misma caja de 1° y mes) | **25 / 30 / 33 / 37 / 53 %** | **15 / 11 / 9 / 6 / 4 %** | — |
Correlación de rangos entre la escala elegida y el satélite: **0.45** (azar 0.02). **Lectura:** la gente sí ve lo que el satélite ve, y **la señal mejora con cada persona independiente** (de 1.7× el azar con una persona a 12× con 10 o más). Eso justifica el umbral «3 o más» de la señal ciudadana, y cada señal del enjambre trae ahora esta tabla medida (`calibration`). El clasificador por palabras (sin modelo de lenguaje) lee seco/húmedo en el **61 %** de los textos y acierta el **88 %** de las veces que lee. **Límites:** solo EE. UU., solo seco/húmedo contra lluvia (otros temas sin calibrar), celda de 0.5° frente a lo que ve una persona en su patio; los pesos por rol y por evidencia siguen siendo valores de trabajo (CoCoRaHS no trae fotos ni roles).

### 3.17 Lluvia en el detector de anomalías [medido]
En 18 estados reales (México y EE. UU., 1981–2026, 7,722 meses juzgados): sin transformar, **16.8** «puntos» por 1000 meses; con raíz cuadrada **4.1**; con logaritmo 6.7. ZON aplica la raíz automáticamente a la clase física «flujo de agua».

### 3.18 Identidad verificable, avisos y vigilancia continua [probado en pruebas]
- **Firmas Ed25519** (RFC 8032, biblioteca estándar; pasa el vector de prueba 1 del RFC). Un rol del enjambre («científico») solo cuenta si una institución de un **registro de confianza** firmó la atestación para esa persona, ese rol y vigente; las firmas falsas, ajenas o vencidas se rechazan y se dice por qué. Un sensor puede firmar sus lotes de observaciones; un monitor con `require_signature` rechaza lo no firmado y lo deja en la bitácora. **Límite:** la implementación no es de tiempo constante: sirve para verificar y para llaves de demostración; para firmar en producción, una biblioteca auditada.
- **Avisos y escalamiento:** cada alerta nueva se avisa una vez al nivel 0 (bandeja de archivo y/o webhook firmado con HMAC-SHA256); si sigue «abierta» después del plazo de su gravedad (alta 30 min, media 4 h, leve sin plazo), sube al siguiente nivel, una vez por nivel. Un canal caído no detiene a los demás. Lo simulado lo dice en el asunto.
- **Vigilancia continua:** `zon watch --config watch.json --once` (para cron o un temporizador de systemd) o en bucle: pide solo los datos nuevos, detecta, abre alertas y avisa. No se dejó corriendo ningún servicio.

### 3.19 ZON como runtime [probado en pruebas; medido donde se indica]
| Pieza | Qué hace | Cómo se comprobó |
|---|---|---|
| **Almacén SQLite** (`zon/db.py`) | Un archivo `zon.db`: monitores, observaciones, alertas, bitácora encadenada, reportes, trabajos, salud, llaves. Cada cambio y su registro de auditoría van en **la misma transacción**, con bloqueo inmediato (dos procesos no bifurcan la cadena); modo WAL | Pruebas: editar un registro pasado rompe la cadena; todo lo anterior migró sin cambiar resultados |
| **Conectores enchufables** (`zon/connectors.py`) | POWER por lugar, Marte, CSV de cualquier sensor, cualquier API JSON, CoCoRaHS (reportes) y **NASA Earthdata CMR** (dónde están los gránulos; descargar la mayoría pide token y NetCDF4/HDF5 aún no se lee: dicho) | Pruebas con respuestas simuladas; CMR y POWER no se llamaron en las pruebas |
| **Salud de fuentes** | Por fuente: última vez bien, último error, fallas seguidas, duración. Estados ok / degradada / caída / sin datos recientes | Pruebas |
| **Cola de trabajos aislada** (`zon/jobs.py`) | Cada trabajo en **su propio proceso** con tope de memoria y de tiempo; reintentos con espera exponencial (1, 2, 4… min, máx. 1 h); periódicos se reprograman | Pruebas: un trabajo colgado se mata por tiempo y uno que pide 2 GB muere por el tope sin tumbar el runtime |
| **Llaves, roles y organizaciones** (`zon/auth.py`) | lector / operador / admin; cada llave ve solo sus organizaciones; se guarda solo el SHA-256; comparación en tiempo constante; revocación inmediata | Pruebas |
| **API HTTP + eventos en vivo** (`zon/server.py`, `zon serve`) | Monitores, observaciones, alertas, estado de la entidad (6 respuestas + prioridad), enjambre, bitácora, `/health`, `/metrics` (Prometheus), bundles estáticos, y **/events por SSE** que reanuda con Last-Event-ID | La lógica (`Api.handle`) se probó completa sin sockets; **el servidor y SSE no se probaron con una conexión real** (no se levantó ningún servidor) |
| **Sincronización sin red ↔ servidor** (`zon/sync.py`) | Observaciones por (monitor, tiempo), transiciones como operaciones con id, reportes con firma re-verificada del otro lado; idempotente; conflictos se reportan, no se fuerzan | Pruebas: aplicar dos veces no cambia nada; una alerta cerrada en el servidor no se reabre desde la laptop |
| **Mapa de anomalías del planeta** (`zon anomaly-map`) | z del último mes en las 207,936 celdas, en paralelo, idéntico al detector (diferencia < 1e-9) | **Medido:** T2M 2026-09 en **570 s con 2 núcleos**; 4,858 celdas marcadas (2.9 % del área; 2.1 % más cálido de lo normal, 0.8 % más frío) frente a ~312 esperadas por azar si fueran independientes |

## 4 · Limitaciones conocidas
1. **Memoria larga:** no se corrige el veredicto; se publica un marcador (`robust_mem`) y el límite medido (§3.10). La caminata aleatoria sigue engañando al consenso (12 %).
2. Un **salto artificial** grande se lee como tendencia en la mitad de los casos; la bandera avisa en ~40 %. En T2M no se vio apilamiento en los cambios de corriente de MERRA-2 (§3.11).
3. **FDR de PROBADO entre 6 % y 24 %** según cuánta variabilidad lenta sea ruido (§3.9); e-BH mantiene el nivel (1–9 %) con menos potencia.
4. MERRA-2 **subestima el calentamiento ártico** frente a GISTEMP.
5. La tabla del MDE está medida hasta n = 40; con 45 años se usa el valor de n = 40. El nulo real confirma 80 % de potencia donde MDE ≈ δ (§3.9), pero solo con el ruido optimista.
6. δ de cada clase física es **valor de trabajo del equipo**, no de la literatura.
7. Solo tendencias monótonas; aceleraciones o ciclos no se modelan.
8. Fronteras de Natural Earth admin-1: algunas en disputa (advertencia del propio proveedor). Las regiones físicas («Sahara», «Andes», «Golfo de México») tienen límites aproximados; un lugar que cruza el antimeridiano funciona pero lee todas las columnas de longitud.
12. **Runtime:** el servidor HTTP/SSE no se ha probado con conexiones reales ni bajo carga; un solo nodo (SQLite) — no es un sistema distribuido; NetCDF4/HDF5 sin lector (IMERG, GRACE, MODIS necesitan permiso para instalar una librería); la firma Ed25519 no es de tiempo constante.
10. **Anomalías:** falsas alarmas 3–15 por 1000 muestras según el ruido (§3.13); potencia baja para desviaciones < 4σ; Marte tiene solo 13 años (no calibrado); la persona es simulada y no valida nada médico.
11. **Enjambre:** el valor de «k personas independientes» está medido con 180 mil reportes reales (§3.16); los pesos por rol y evidencia siguen siendo valores de trabajo; la clasificación por palabras se equivoca con frases que no están en la lista; nunca se presenta como prueba.
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
