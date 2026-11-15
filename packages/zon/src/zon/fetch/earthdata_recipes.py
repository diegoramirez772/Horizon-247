"""The NASA variables HORIZON reads through zon.earthdata, each one written down as a Recipe (no hidden choice).

Access and sizes were measured on 2026-11-15 from a laptop. Every recipe says what is satellite and what is reanalysis.
"""
from __future__ import annotations

from ..earthdata import Recipe

# MODIS Terra vegetation index, monthly, 0.05 degree (CMG). HDF4 on disk; Hyrax converts and subsets it (~0.8 MB/month).
NDVI = Recipe(
    id="ndvi", short_name="MOD13C2", version="061",
    variable="/MOD_Grid_monthly_CMG_VI/Data_Fields/CMG_0_05_Deg_Monthly_NDVI",
    lat="axis:89.975,-0.05,4", lon="axis:-179.975,0.05,4",       # CMG: 3600 x 7200 cells of 0.05 deg from 90 N, 180 W
    access="opendap", slices="[0:4:3599][0:4:7199]",
    scale="divide", start="2001-01-01", end="2025-12-31", phys_min=-1.0, phys_max=1.0,
    units="1", long_name="Normalized Difference Vegetation Index (MODIS Terra MOD13C2)", kind="satellite",
    notes=["Regular sample: 1 of every 4 x 4 pixels of 0.05 degrees (0.2 degree spacing), then the mean of the ~25 samples "
           "inside each 1 degree box. Not every pixel is read.",
           "MODIS stores NDVI x 10000 with scale_factor = 10000 (divide), as the MOD13 user guide states."])

# SMAP L3 radiometer soil moisture, daily, 36 km EASE-Grid 2.0 (HDF5). Descending (AM, 6 a.m.) pass. Read by HTTP range.
SOIL_MOISTURE = Recipe(
    id="soil_moisture", short_name="SPL3SMP", version="009",
    variable="/Soil_Moisture_Retrieval_Data_AM/soil_moisture",
    lat="/Soil_Moisture_Retrieval_Data_AM/latitude", lon="/Soil_Moisture_Retrieval_Data_AM/longitude",
    access="range", quality={"path": "/Soil_Moisture_Retrieval_Data_AM/retrieval_qual_flag", "rule": "bit0_clear"},
    start="2015-04-01", end="2025-12-31", days=[1, 6, 11, 16, 21, 26], phys_min=0.0, phys_max=0.6,
    names=[f"SMAP_L3_SM_P_??????{d:02d}_*" for d in (1, 6, 11, 16, 21, 26)],
    fixed_coords=True,                  # EASE-Grid 2.0: one latitude per row, one longitude per column (checked)
    units="m3/m3", long_name="Surface soil moisture, top ~5 cm (SMAP L3 radiometer, AM pass)", kind="satellite",
    notes=["Monthly value = mean of 6 sampled days (1, 6, 11, 16, 21, 26), not of every day: SMAP sees each place every "
           "2-3 days, so 6 days give partial coverage that varies by month.",
           "Only pixels with 'recommended quality' (retrieval_qual_flag bit 0 = 0) are used.",
           "Latitude/longitude read once (fixed EASE-Grid 2.0 rows/columns, checked to 0.001 degree).",
           "Record starts April 2015: ten full years at most, the minimum HORI accepts."])

# MERRA-2 total aerosol extinction optical depth at 550 nm, monthly (reanalysis that assimilates MODIS, MISR, AVHRR, AERONET).
AEROSOL = Recipe(
    id="aod", short_name="M2TMNXAER", version="5.12.4",
    variable="/TOTEXTTAU", lat="/lat", lon="/lon", access="opendap",
    slices="[0:1:0][0:1:360][0:1:575]", lat_slice="[0:1:360]", lon_slice="[0:1:575]",
    start="1981-01-01", end="2025-12-31", phys_min=0.0, phys_max=10.0,
    units="1", long_name="Total aerosol extinction optical depth at 550 nm (MERRA-2)", kind="reanalysis",
    notes=["Reanalysis, not a direct measurement: a model that assimilates satellite aerosol optical depth "
           "(MODIS, MISR, AVHRR) and AERONET.",
           "Native grid 0.5 x 0.625 degrees; averaged to 1 degree boxes."])

# MERRA-2 snow cover fraction (land), monthly. Reanalysis; the MODIS snow product (MOD10CM) is HDF4 and not served by
# Hyrax, and reading it directly needs pyhdf (not installed here).
SNOW = Recipe(
    id="snow_cover", short_name="M2TMNXLND", version="5.12.4",
    variable="/FRSNO", lat="/lat", lon="/lon", access="opendap",
    slices="[0:1:0][0:1:360][0:1:575]", lat_slice="[0:1:360]", lon_slice="[0:1:575]",
    start="1981-01-01", end="2025-12-31", phys_min=0.0, phys_max=1.0,
    units="1", long_name="Fractional snow covered area (MERRA-2 land)", kind="reanalysis",
    notes=["Reanalysis (land model forced by observed precipitation), not a satellite snow map.",
           "MODIS MOD10CM (satellite) is HDF4 and Hyrax does not serve it; it needs pyhdf to be read directly."])

RECIPES = {r.id: r for r in (NDVI, SOIL_MOISTURE, AEROSOL, SNOW)}
