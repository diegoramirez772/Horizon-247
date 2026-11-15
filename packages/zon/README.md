# ZON — runtime

Connects to sources, downloads, normalizes into **cubes** (`contract/CUBE.md`), calls **HORI through `hori.api`**
and writes **bundles** (`contract/SPEC.md`) with full provenance. Entry point: `python -m zon build <layer>`.

* Base install is light on purpose (laptops with ~6 GB RAM): process month by month, aggregate while reading.
* Optional extras: `earthdata` (earthaccess), `netcdf` (netCDF4/h5py).
* Credentials: environment variables or `~/.netrc` — never in the repo.
* Catalog of entities and layers (Z2): `src/zon/catalog.json` (`python -m zon registry`, `python -m zon build <layer-id>`).

Status: **skeleton.**

## Connector: NASA POWER (no account needed)
`src/zon/fetch/power.py` — stdlib + NumPy only.
* **Polite:** adaptive rate limiting (default 1 request/s), retries with backoff + jitter, honours `Retry-After`.
* **Never repeats a request:** content-addressed cache with integrity checks, TTL and an offline mode. Points that fall in the same grid cell are ONE request.
* **Learns the real grid:** `probe_native_grid` measures the native cell size from the API itself (measured on 2026-11-14: 0.5° lat × 0.625° lon, the MERRA-2 grid).
* **Validates** every response (parameters, fill values → NaN, expected length) and records provenance (URL, time, sha256 per request and combined).
* **Builds cubes** (`contract/CUBE.md`) for any bounding box: `.npz` with values, validity, time, lat/lon and full provenance.
* **Knows freshness:** `latest_available` (monthly / daily).

```bash
export PYTHONPATH=packages/zon/src
python3 -m zon.fetch.power point --lat 24.02 --lon -104.65 --start 2001 --end 2024
python3 -m zon.fetch.power latest --level daily
python3 -m zon.fetch.power cube --bbox 22.3 -107.2 26.8 -102.5 --start 2001 --end 2024 \
        --param T2M --param PRECTOTCORR --out data/cubes --probe-first
python3 -m unittest discover -s packages/zon/tests -v     # 23 tests, no network (fake server)
```
Cache: `data/cache/` (git-ignored; override with `ZON_CACHE_DIR`). Cite POWER with the text stored in each cube's `meta.citation`.


## Runtime (v0.8)
Todo con la biblioteca estándar de Python + NumPy, un solo archivo `zon.db` (SQLite, WAL).
```bash
export PYTHONPATH=packages/zon/src:packages/hori/src
python -m zon key --root data/zon --name diego --role admin --orgs '*'      # la llave se muestra UNA vez
python -m zon serve --root data/zon --port 8247 --bundles data/bundles      # API + /events (SSE)
python -m zon watch --config watch.json --once                               # datos nuevos -> alertas -> avisos (cron/systemd)
python -m zon anomaly-map --param T2M --out data                             # el planeta este mes (paralelo)
python -m zon update-planet --param T2M --out data                           # tendencias: ¿mes nuevo? recalcula + eventos
python -m zon export-web --src data/bundles --out apps/web/public/bundles     # estáticos para la web
```
Módulos: `db` (almacén y cadena) · `monitors` (monitores, alertas, ciclo de vida) · `swarm` (enjambre) · `signing` (Ed25519) ·
`auth` (llaves/roles/organizaciones) · `connectors` (fuentes + salud) · `jobs` (cola aislada con reintentos) · `notify` (avisos,
escalamiento, vigilancia) · `server` (API + SSE) · `sync` (sin red ↔ servidor) · `anomaly_map` · `update` · `serve` (export).
Contrato: `contract/SPEC.md` §11–14. Números medidos: ficha del modelo del equipo (fuera del repositorio).

## NASA Earthdata, cualquier misión (`zon/earthdata.py`)
Busca en CMR, lee **solo la variable** que hace falta y entrega un cubo mensual a 1° con **evidencia reproducible**.
Tres caminos, el que NASA sirva para ese producto: `opendap` (Hyrax recorta en el servidor; convierte hasta HDF4 de MODIS
a NetCDF-4), `range` (lectura por rangos HTTP de un HDF5/NetCDF-4 en la nube) y `download` (archivo completo). Zarr v2 con
los códecs propios. El token (`EARTHDATA_TOKEN`) solo viaja a hosts de Earthdata y nunca se escribe.
```bash
export PYTHONPATH=packages/zon/src:packages/hori/src EARTHDATA_TOKEN=...   # token de urs.earthdata.nasa.gov
python -m zon earthdata recipes                                              # NDVI, humedad del suelo, aerosoles, nieve
python -m zon earthdata search --short-name MOD13C2 --version 061 --start 2024-01-01 --end 2024-12-31
python -m zon earthdata cube --recipe ndvi --out data/earthdata               # reanudable; cubo .npz + evidence.json
python -m zon earthdata cube --recipe mi_receta.json                         # cualquier producto: una receta JSON
python -m zon earthdata reproduce --evidence data/earthdata/ndvi/evidence.json --k 5    # vuelve a leer y compara SHA-256
python -m zon multivar --vars T2M NDVI AOD SNOW_COVER --window 2001 2025     # una capa por variable + cambio conjunto
```
**Receta** (`Recipe`): producto y versión, ruta de la variable, latitud/longitud (ruta o eje regular), recorte, convención de
escala (`cf` o `divide` de MODIS), filtro de calidad, rango físico, días muestreados, tipo (satélite / reanálisis) y notas.
**Evidencia:** por grano, la URL usada, la restricción enviada al servidor y el SHA-256 **del arreglo decodificado** (las
respuestas del servidor traen fechas y no sirven para comparar). Hielo marino (NSIDC-0051): `zon/fetch/seaice.py`.

### Dependencias opcionales (licencias BSD/Apache, en `.venv`)
`python3 -m venv --system-site-packages .venv && .venv/bin/pip install h5py pynacl` — h5py (BSD-3) lee HDF5/NetCDF4 (IMERG);
PyNaCl (Apache-2.0) firma con libsodium. Sin ellas todo lo demás funciona (las pruebas que las necesitan se saltan).
Servidor con varios procesos: `python -m zon serve --workers 2`. Prueba de carga: `python sim/load_test.py 8 20`.
