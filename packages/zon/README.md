# ZON — runtime

Connects to sources, downloads, normalizes into **cubes** (`contract/CUBE.md`), calls **HORI through `hori.api`**
and writes **bundles** (`contract/SPEC.md`) with full provenance. Entry point: `python -m zon build <layer>`.

* Base install is light on purpose (laptops with ~6 GB RAM): process month by month, aggregate while reading.
* Optional extras: `earthdata` (earthaccess), `netcdf` (netCDF4/h5py).
* Credentials: environment variables or `~/.netrc` — never in the repo.
* Layer configs: `src/zon/layers/*.yaml`.

Status: **skeleton.**
