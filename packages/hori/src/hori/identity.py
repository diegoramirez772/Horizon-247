"""L0 identity, built automatically for every query: WHAT is monitored (Entity) and HOW HORI reads it (Profile).

Nothing is seeded by hand per place or per variable. The only curated knowledge is PHYSICAL_CLASSES: for a few
physical classes (temperature, water flux, wind, humidity, fraction) the effect of interest delta in real units.
Everything else is read from the source metadata (units, long_name, definition, valid_min/max) and measured on the
data (zeros, bounds; sigma and phi after the run). Each choice is written down in `decisions`, so the bundle says
WHY ("mean because units = C"). Unknown class -> delta = k * sigma with the DELTA_AUTOMATICO flag, never a silent guess.

Entity ~ NGSI-LD entity (id, type, properties, relationships); observations map to SOSA/O&M.
"""
from __future__ import annotations

import hashlib
import re
import warnings
from dataclasses import asdict, dataclass, field, replace

import numpy as np

from .config import Config

ENTITY_STATUS = ("real", "simulada", "no_verificada")
BODIES = ("earth", "mars", "human")
MODES = ("trend", "sequential")
TREND_METHODS = ("MK-VC", "TFPW-WS", "OLS-AR1")
PROFILES_VERSION = "auto-1"


class IdentityError(ValueError):
    pass


def _need(cond: bool, msg: str) -> None:
    if not cond:
        raise IdentityError(msg)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


@dataclass(frozen=True)
class Entity:
    id: str                         # stable, lowercase, e.g. "earth-chihuahua" or "earth-bbox-22.5-106.9-26.5-102.5"
    type: str                       # region | planet_region | person
    body: str                       # earth | mars | human
    name: dict                      # {"es": ..., "en": ...}
    status: str                     # real | simulada | no_verificada (is the THING real, not the data)
    version: str = "1"
    source: dict = field(default_factory=dict)      # where the place and the data come from (+ hashes)
    geometry: dict | None = None                    # {"type": "bbox", "bbox": [S, W, N, E]} | None
    relations: tuple = ()                           # ({"rel": "part_of", "target": "mx"}, ...)

    def __post_init__(self):
        _need(bool(self.id) and self.id == self.id.lower() and " " not in self.id, f"entity id must be lowercase without spaces: {self.id!r}")
        _need(self.status in ENTITY_STATUS, f"entity {self.id}: status must be one of {ENTITY_STATUS}")
        _need(self.body in BODIES, f"entity {self.id}: body must be one of {BODIES}")
        _need({"es", "en"} <= set(self.name), f"entity {self.id}: name needs es and en")
        for r in self.relations:
            _need({"rel", "target"} <= set(r), f"entity {self.id}: relations need rel and target")

    @classmethod
    def from_dict(cls, d: dict) -> "Entity":
        d = dict(d)
        d["relations"] = tuple(d.get("relations", ()))
        return cls(**d)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["relations"] = list(self.relations)
        return d


@dataclass(frozen=True)
class Profile:
    id: str                         # "auto.<class>.<variable>", e.g. "auto.temperatura.t2m"
    version: str
    body: str
    mode: str                       # trend (implemented) | sequential (H9, not yet)
    variables: tuple                # accepted cube variable names
    unit: str
    aggregation: dict               # {"step": "annual", "method": "mean_monthly_anomaly", "min_months": 9}
    delta_per_decade: float | None  # effect of interest in `unit`/decade; None = delta = k * sigma (DELTA_AUTOMATICO)
    delta_rationale: str
    review: str                     # "automatico" (inferred) | "propuesto" | "revisado"
    methods: tuple = TREND_METHODS
    name: dict = field(default_factory=dict)
    physical_class: str | None = None
    decisions: tuple = ()           # human-readable reasons, one per choice
    flags: tuple = ()               # layer-level: DELTA_AUTOMATICO, ACOTADA, CEROS_FRECUENTES, CLASE_DESCONOCIDA...

    def __post_init__(self):
        _need(self.mode in MODES, f"profile {self.id}: mode must be one of {MODES}")
        _need(self.body in BODIES, f"profile {self.id}: body must be one of {BODIES}")
        _need(len(self.variables) > 0, f"profile {self.id}: needs at least one variable")
        _need(self.delta_per_decade is None or self.delta_per_decade > 0, f"profile {self.id}: delta must be > 0")
        if self.mode == "trend":
            _need(set(self.methods) <= set(TREND_METHODS) and len(self.methods) >= 2,
                  f"profile {self.id}: trend mode needs >= 2 of {TREND_METHODS}")

    def accepts(self, variable: str) -> bool:
        return variable in self.variables

    def apply(self, cfg: Config) -> tuple[Config, str]:
        """Config with this profile applied, and where delta came from. An explicit delta in cfg wins (and is reported)."""
        mm = int(self.aggregation.get("min_months", cfg.min_months))
        if cfg.delta_per_decade is not None:
            return replace(cfg, min_months=mm, methods=tuple(self.methods)), "config"
        if self.delta_per_decade is not None:
            return replace(cfg, delta_per_decade=self.delta_per_decade, min_months=mm, methods=tuple(self.methods)), "profile"
        return replace(cfg, min_months=mm, methods=tuple(self.methods)), "sigma"

    def to_dict(self) -> dict:
        d = asdict(self)
        for k in ("variables", "methods", "decisions", "flags"):
            d[k] = list(d[k])
        return d


# ---------------------------------------------------------------- the ONLY curated table: physical classes
@dataclass(frozen=True)
class PhysicalClass:
    id: str
    name: dict
    units: tuple                    # normalized unit strings that belong to the class
    keywords: tuple                 # at least one must appear in name/long_name/definition when `need_keyword`
    delta: float                    # per decade, in the class's base unit
    unit_scale: dict                # unit -> factor that converts the base delta to that unit
    rationale: str
    need_keyword: bool = False      # units alone are ambiguous (e.g. "%")


PHYSICAL_CLASSES = (
    PhysicalClass("temperatura", {"es": "Temperatura", "en": "Temperature"}, ("c", "degc", "k", "kelvin", "degreesc"),
                  ("temperat", "t2m", "dew", "frost", "skin"), 0.3, {"k": 1.0, "kelvin": 1.0},
                  "0.3 °C/década: algo más que el calentamiento global reciente (~0.2 °C/década en superficie), para que "
                  "lo que se marque sea un cambio regional notable. Valor de trabajo del equipo, no de la literatura."),
    PhysicalClass("flujo_de_agua", {"es": "Flujo de agua", "en": "Water flux"}, ("mm/day", "mm/d", "mmday-1", "kgm-2s-1"),
                  ("precip", "rain", "evap", "runoff", "snowfall", "water"), 0.2, {"kgm-2s-1": 1.0 / 86400.0},
                  "0.2 mm/día/década: ≈13 % por década de la lluvia media de Durango (1.52 mm/día, POWER, medido). En "
                  "zonas muy secas es grande frente a la media: el δ va siempre visible. Valor de trabajo, por revisar."),
    PhysicalClass("viento", {"es": "Velocidad del viento", "en": "Wind speed"}, ("m/s", "ms-1", "m/sec"),
                  ("wind", "ws"), 0.1, {},
                  "0.1 m/s/década: orden del «stilling» reportado en superficie [de memoria, por confirmar]."),
    PhysicalClass("humedad_relativa", {"es": "Humedad relativa", "en": "Relative humidity"}, ("%", "percent"),
                  ("humidity", "rh2m"), 1.0, {}, "1 punto %/década [propuesta del equipo].", need_keyword=True),
    PhysicalClass("fraccion", {"es": "Fracción", "en": "Fraction"}, ("1", "fraction", "0-1"),
                  ("fraction", "albedo", "cover"), 0.02, {}, "0.02/década (2 puntos de fracción) [propuesta del equipo].",
                  need_keyword=True),
)


def _norm_unit(u: str) -> str:
    return re.sub(r"[\s°_^]", "", (u or "").lower()).replace("**", "")


def classify(var: dict) -> tuple[PhysicalClass | None, str]:
    """(class, reason) from the source metadata only."""
    unit = _norm_unit(var.get("unit", ""))
    text = " ".join(str(var.get(k, "")) for k in ("name", "long_name", "definition", "standard_name")).lower()
    for pc in PHYSICAL_CLASSES:
        if unit in pc.units:
            hit = next((k for k in pc.keywords if k in text), None)
            if pc.need_keyword and hit is None:
                continue
            why = f"units = {var.get('unit')!r}" + (f" y el nombre dice {hit!r}" if hit else "")
            return pc, why
    return None, f"units = {var.get('unit')!r} no corresponde a ninguna clase física curada"


def infer_profile(var: dict, values: np.ndarray | None = None, time=None, body: str = "earth",
                  delta_sigma: float = 2.0) -> Profile:
    """Profile from metadata + measured properties of `values` ([T, ...] monthly, optional). Deterministic."""
    name = var.get("name", "") or "var"
    pc, why = classify(var)
    decisions, flags = [], []
    if pc is not None:
        unit_key = _norm_unit(var.get("unit", ""))
        delta = pc.delta * pc.unit_scale.get(unit_key, 1.0)
        decisions.append(f"Clase física «{pc.name['es']}» porque {why}; δ = {delta:g} {var.get('unit', '')}/década (tabla curada).")
        rationale = pc.rationale
    else:
        delta = None
        flags += ["DELTA_AUTOMATICO", "CLASE_DESCONOCIDA"]
        decisions.append(f"Clase física desconocida ({why}): δ = {delta_sigma:g}·σ interanual de cada celda (DELTA_AUTOMATICO).")
        rationale = f"Automático: δ = {delta_sigma:g} σ por década, porque la variable no está en la tabla de clases físicas."
    cm = str(var.get("cell_methods", "")).lower()
    decisions.append("Agregación anual = media de anomalías mensuales (≥ 9 de 12 meses)"
                     + (f", coherente con cell_methods = {var.get('cell_methods')!r}." if "mean" in cm else
                        "; la fuente no declara cell_methods = mean, se asume que los meses son medias." if not cm else
                        f"; OJO: cell_methods = {var.get('cell_methods')!r}."))
    methods = TREND_METHODS
    if values is not None:
        v = np.asarray(values, dtype=float)
        fin = np.isfinite(v)
        n_fin = max(int(fin.sum()), 1)
        zeros = float((np.abs(v[fin]) < 1e-9).sum()) / n_fin
        lo, hi = var.get("valid_min"), var.get("valid_max")
        at_bounds = 0.0
        for b in (lo, hi):
            if b is not None and np.isfinite(b):
                at_bounds += float((np.abs(v[fin] - b) < 1e-6).sum()) / n_fin
        annual_zero = None
        if time is not None:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                raw = np.full_like(v, np.nan)
                years = np.array([int(t[:4]) for t in time])
                for y in np.unique(years):                       # annual MEAN of the raw values (not anomalies)
                    raw[years == y] = np.nanmean(v[years == y], axis=0)
            annual_zero = float((np.abs(raw[np.isfinite(raw)]) < 1e-9).mean()) if np.isfinite(raw).any() else 0.0
        decisions.append(f"Medido en los datos: {zeros:.1%} de meses en cero, {at_bounds:.1%} en los límites válidos"
                         + (f", {annual_zero:.1%} de años con media cero." if annual_zero is not None else "."))
        if annual_zero is not None and annual_zero > 0.10:
            methods = ("MK-VC", "TFPW-WS")
            flags.append("CEROS_FRECUENTES")
            decisions.append("Más de 10 % de años con media cero: OLS deja de votar (residuos lejos de normales) y quedan "
                             "MK-VC + TFPW-WS. Esta combinación NO está calibrada por simulación.")
        if at_bounds > 0.05:
            flags.append("ACOTADA")
            decisions.append("Más de 5 % de valores en el límite válido: variable acotada; v1 no transforma (logit pendiente), "
                             "la tendencia cerca del límite está subestimada.")
    pid = f"auto.{pc.id if pc else 'desconocida'}.{slug(name)}"
    return Profile(pid, PROFILES_VERSION, body, "trend", (name,), var.get("unit", ""),
                   {"step": "annual", "method": "mean_monthly_anomaly", "min_months": 9}, delta, rationale, "automatico",
                   methods, {"es": var.get("long_name") or name, "en": var.get("long_name") or name},
                   pc.id if pc else None, tuple(decisions), tuple(flags))


def auto_entity(meta: dict, lat, lon, *, place: dict | None = None, input_sha256: str = "") -> Entity:
    """The entity card, created for THIS query: place (name/geometry if known, else the bbox) + source + hash."""
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    body = meta.get("body", "earth")
    ds, var = meta.get("dataset", {}), meta.get("variable", {})
    bbox = [round(float(lat.min()), 4), round(float(lon.min()), 4), round(float(lat.max()), 4), round(float(lon.max()), 4)]
    if place:
        eid = place.get("id") or f"{body}-{slug(place['name']['en'])}"
        name, geometry = place["name"], place.get("geometry") or {"type": "bbox", "bbox": bbox}
        relations = tuple(place.get("relations", ()))
        psource = place.get("source", {})
    else:
        eid = f"{body}-bbox-" + "-".join(f"{abs(v):g}{'ns'[v < 0] if i % 2 == 0 else 'ew'[v < 0]}" for i, v in enumerate(bbox))
        name = {"es": f"Recuadro {bbox}", "en": f"Box {bbox}"}
        geometry, relations, psource = {"type": "bbox", "bbox": bbox}, (), {"name": "recuadro de la consulta"}
    kind = ds.get("kind")
    status = "simulada" if kind == "simulated" else "real"
    card = {"place": psource, "dataset": ds.get("name", ""), "dataset_url": ds.get("url", ""),
            "dataset_version": ds.get("version", ""), "variable": var.get("name", ""), "input_sha256": input_sha256}
    card["card_sha256"] = hashlib.sha256(repr(sorted(card.items())).encode()).hexdigest()
    return Entity(slug(eid), "planet_region" if body != "earth" else "region", body, name, status, "1", card,
                  geometry, relations)


def check_pair(entity: Entity, profile: Profile, variable: str, dataset_kind: str | None) -> None:
    """Refuse combinations that would mislead: wrong body, wrong variable, real entity fed simulated data (or vice versa)."""
    _need(entity.body == profile.body, f"profile {profile.id} is for body {profile.body}, entity {entity.id} is on {entity.body}")
    _need(profile.accepts(variable), f"profile {profile.id} does not accept variable {variable!r} (accepts {list(profile.variables)})")
    _need(profile.mode == "trend", f"profile {profile.id} is mode {profile.mode!r}; run_layer only does trends (sequential is H9)")
    simulated = dataset_kind == "simulated"
    _need(simulated == (entity.status == "simulada"),
          f"entity {entity.id} is {entity.status!r} but the data kind is {dataset_kind!r}: real and simulated must not mix")
