"""ZON end-to-end with a FAKE file shaped like GISTEMP (no network, no NASA data).

Everything this test writes is labelled simulated (--simulated-test) and goes to a temporary folder.
Needs netCDF4 to create the fake file (the reader also works with h5py).
"""
import datetime as dt
import json
import os
import sys
import tempfile

import numpy as np
import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "src"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "hori", "src"))

netCDF4 = pytest.importorskip("netCDF4")

from zon import build as builder  # noqa: E402
from zon.fetch import gistemp  # noqa: E402


def make_fake_gistemp(path: str, first_year: int = 1880, last_year: int = 2025, last_month: int = 9) -> None:
    rng = np.random.default_rng(1)
    lat = np.arange(-89, 90, 2.0)
    lon = np.arange(-179, 180, 2.0)
    months = [(y, m) for y in range(first_year, last_year + 1) for m in range(1, 13)
              if not (y == last_year and m > last_month)]
    origin = dt.datetime(1800, 1, 1)
    days = np.array([(dt.datetime(y, m, 15) - origin).days for y, m in months], float)
    ds = netCDF4.Dataset(path, "w", format="NETCDF4")
    ds.createDimension("lat", lat.size)
    ds.createDimension("lon", lon.size)
    ds.createDimension("time", None)
    ds.createVariable("lat", "f4", ("lat",))[:] = lat
    ds.createVariable("lon", "f4", ("lon",))[:] = lon
    t = ds.createVariable("time", "i4", ("time",))
    t.units = "days since 1800-01-01 00:00:00"
    t[:] = days
    v = ds.createVariable("tempanomaly", "i2", ("time", "lat", "lon"), fill_value=32767)
    v.scale_factor = 0.01
    v.units = "K"
    yrs = np.array([y for y, _ in months], float)
    # warming that grows with latitude, AR noise, some cells always missing
    trend = (0.01 + 0.03 * (np.abs(lat)[:, None] / 90.0)) * np.ones((1, lon.size))
    for k in range(len(months)):
        field = trend * (yrs[k] - 1950) + 0.6 * rng.standard_normal((lat.size, lon.size))
        field[:5, :] = np.nan                      # Antarctic rows without data
        v[k] = np.ma.masked_invalid(field)
    ds.close()


def test_reader_and_end_to_end_build():
    with tempfile.TemporaryDirectory() as d:
        nc = os.path.join(d, "fake_gistemp.nc")
        make_fake_gistemp(nc)
        raw = gistemp.read(nc, 2001, 2024)
        assert raw["values"].shape == (24 * 12, 90, 180)
        assert raw["last_month"] == "2024-12"
        assert np.isnan(raw["values"][0, 0, 0]) and np.isfinite(raw["values"][0, 50, 50])

        bundles = os.path.join(d, "bundles")
        for layer in ("temp_gistemp_2001-2024", "temp_gistemp_1980-2024"):
            builder.build(layer, data_dir=os.path.join(d, "data"), bundles_dir=bundles, local_file=nc,
                          simulated_test=True, log=lambda *a: None)

        m = json.load(open(os.path.join(bundles, "earth", "temp_gistemp_2001-2024", "manifest.json"), encoding="utf-8"))
        assert m["honesty"]["simulated"] is True and m["honesty"]["data_real"] is False
        assert m["grid"]["nlat"] == 90 and m["grid"]["lat0"] == 89.0 and m["grid"]["dlat"] == -2.0
        assert m["window"]["n"] == 24 and m["windows"]["ends"][-1] == 2024
        s = m["summary"]
        assert s["insuficiente"] == 5 * 180 and s["probado"] > 0
        flags = np.fromfile(os.path.join(bundles, "earth", "temp_gistemp_2001-2024", "flags.u8"), np.uint8)
        assert (flags & 32).all(), "every cell must carry the simulado flag"

        index = json.load(open(os.path.join(bundles, "index.json"), encoding="utf-8"))
        assert {e["id"] for e in index} == {"temp_gistemp_2001-2024", "temp_gistemp_1980-2024"}
        regions = json.load(open(os.path.join(bundles, "regions.json"), encoding="utf-8"))
        dgo = regions[0]
        assert dgo["id"] == "mx-dgo" and set(dgo["layers"]) == set(e["id"] for e in index)
        assert dgo["layers"]["temp_gistemp_2001-2024"]["n_cells"] >= 4


def make_fake_gpcp(path: str, first_year: int = 1979, last_year: int = 2025, last_month: int = 9) -> None:
    """Shaped like NOAA PSL precip.mon.mean.nc: 2.5°, lat north->south, lon 0..360, mm/day, missing -9.96921e36."""
    rng = np.random.default_rng(2)
    lat = np.arange(88.75, -90, -2.5)
    lon = np.arange(1.25, 360, 2.5)
    months = [(y, m) for y in range(first_year, last_year + 1) for m in range(1, 13)
              if not (y == last_year and m > last_month)]
    origin = dt.datetime(1800, 1, 1)
    days = np.array([(dt.datetime(y, m, 1) - origin).days for y, m in months], float)
    ds = netCDF4.Dataset(path, "w", format="NETCDF4")
    ds.createDimension("lat", lat.size)
    ds.createDimension("lon", lon.size)
    ds.createDimension("time", None)
    ds.createVariable("lat", "f4", ("lat",))[:] = lat
    ds.createVariable("lon", "f4", ("lon",))[:] = lon
    t = ds.createVariable("time", "f8", ("time",))
    t.units = "days since 1800-01-01 00:00:0.0"
    t[:] = days
    v = ds.createVariable("precip", "f4", ("time", "lat", "lon"))
    v.missing_value = np.float32(-9.96921e36)
    v.units = "mm/day"
    yrs = np.array([y for y, _ in months], float)
    for k in range(len(months)):
        field = np.clip(2.5 + 0.01 * (yrs[k] - 1990) * np.sign(lat)[:, None] + 0.4 * rng.standard_normal((lat.size, lon.size)), 0, None)
        field[-3:, :] = -9.96921e36                # southern rows missing
        v[k] = field
    ds.close()


def test_gpcp_reader_and_build():
    with tempfile.TemporaryDirectory() as d:
        nc = os.path.join(d, "precip.mon.mean.nc")
        make_fake_gpcp(nc)
        from zon.fetch import gpcp
        raw = gpcp.read(nc, 2001, 2024)
        assert raw["values"].shape == (24 * 12, 72, 144)
        assert raw["lon"][0] == -178.75 and raw["lon"][-1] == 178.75 and np.all(np.diff(raw["lon"]) > 0)
        assert np.isnan(raw["values"][0, -1, 0]) and abs(np.nanmean(raw["values"][0, :10]) - 2.5 * 365.25) < 200
        # the h5py fallback must read the same numbers (missing_value, no _FillValue)
        h = gistemp._H5(nc)
        a = h.get_slice("precip", 0, 2)
        h.close()
        assert np.isnan(a[0, -1, 0]) and np.isfinite(a[0, 0, 0])

        bundles = os.path.join(d, "bundles")
        for layer in ("precip_gpcp_2001-2024", "precip_gpcp_1980-2024"):
            builder.build(layer, data_dir=os.path.join(d, "data"), bundles_dir=bundles, local_file=nc,
                          simulated_test=True, no_windows=True, log=lambda *a: None)
        m = json.load(open(os.path.join(bundles, "earth", "precip_gpcp_1980-2024", "manifest.json"), encoding="utf-8"))
        assert m["grid"]["lat0"] == 88.75 and m["grid"]["dlat"] == -2.5 and m["grid"]["lon0"] == -178.75
        assert m["variable"]["color_more"] == "blue" and m["variable"]["unit"] == "mm/año"
        assert m["honesty"]["simulated"] is True and m["summary"]["insuficiente"] == 3 * 144
        regions = json.load(open(os.path.join(bundles, "regions.json"), encoding="utf-8"))
        assert regions[0]["layers"]["precip_gpcp_1980-2024"]["n_cells"] == 4
