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
- **Decisión:** el veredicto sigue con BH; e-BH se publica en paralelo como «núcleo robusto a cualquier dependencia». v1 cambia a e-valores de mezcla (más potentes) — por medir en el planeta.

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

## 4 · Limitaciones conocidas
1. Calibración medida con ruido AR(1); la **memoria larga** (Hurst) no está corregida → la caminata aleatoria engaña al consenso (12 %).
2. Un **salto artificial** grande se lee como tendencia en la mitad de los casos; la bandera avisa en ~40 %.
3. MERRA-2 **subestima el calentamiento ártico** frente a GISTEMP.
4. La tabla del MDE está medida hasta n = 40; con 45 años se usa el valor de n = 40 (conservador).
5. δ de cada clase física es **valor de trabajo del equipo**, no de la literatura.
6. Solo tendencias monótonas; aceleraciones o ciclos no se modelan.
7. Fronteras de Natural Earth admin-1: algunas en disputa (advertencia del propio proveedor).

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
