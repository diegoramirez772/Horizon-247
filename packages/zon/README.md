# ZON — runtime

Connects to sources, downloads, normalizes into **cubes** (`contract/CUBE.md`), calls **HORI through `hori.api`**
and writes **bundles** (`contract/SPEC.md`) with full provenance. Entry point: `python -m zon build <layer>`.

* Base install is light on purpose (laptops with ~6 GB RAM): process month by month, aggregate while reading.
* Optional extras: `earthdata` (earthaccess), `netcdf` (netCDF4/h5py).
* Credentials: environment variables or `~/.netrc` — never in the repo.
* Layer configs: `src/zon/layers/*.yaml`.

## Build the real layers

```bash
cd packages/zon
pip install -e ../hori -e ".[netcdf]"        # netCDF4 (or h5py) reads the NASA file
python -m zon list
python -m zon build temp_gistemp_2001-2024 temp_gistemp_1980-2024 precip_gpcp_2001-2024 precip_gpcp_1980-2024
```

* Temperature: GISTEMP v4 (NASA GISS, 2°). Rain: GPCP v2.3 monthly (2.5°, served by NOAA PSL, ≈20 MB, no login),
  converted from mm/day to mm/año.
* Downloads GISTEMP v4 once into `<repo>/data/raw/gistemp/` (≈26 MB, no login), records sha256, size and time.
* No internet or a blocked site: download the `.nc.gz` in a browser and pass it with `--file path/to/file.nc.gz`.
* Writes `apps/web/public/bundles/earth/<layer>/` (manifest, arrays, `series.f32`, `windows/`, `emergence_year.f32`,
  `build_info.json`) and adds or replaces only this layer in `index.json` and `regions.json` (Durango, `mx-dgo`).
* Cost measured on 16 200 cells: 24 years ≈ 9 s and ≈ 220 MB of RAM; 45 years with 36 windows ≈ 60 s and ≈ 580 MB.
* `--no-windows` skips the expanding windows (faster). `--simulated-test` is ONLY for tests: it labels everything simulated.

Status: **GISTEMP and GPCP done.** IMERG, NDVI and Mars dust still need Earthdata access / their readers (`fetch/*.py`).
Test without network: `python -m pytest tests -q` (builds both layers from a fake GISTEMP-shaped file, labelled simulated).
