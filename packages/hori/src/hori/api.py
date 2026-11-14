"""Public, stable API of HORI. ZON and any other client must use ONLY this module."""
from __future__ import annotations
from .cube import Cube
from .config import Config
from .result import LayerResult


def run_layer(cube: Cube, config: Config) -> LayerResult:
    """cube -> findings (effect, tests, FDR, MDE, verdict, flags). See docs/SPEC.md sections 2-5."""
    raise NotImplementedError


def write_bundle(result: LayerResult, out_dir: str) -> None:
    """Write manifest.json + binary arrays following contract/SPEC.md."""
    raise NotImplementedError
