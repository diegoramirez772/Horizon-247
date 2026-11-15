"""H1 identity (L0), automatic: the profile is inferred from metadata + data, the entity card is created per query,
misleading pairs are refused, and bundles are reproducible."""
import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np

from hori.api import IdentityError, run_layer, write_bundle
from hori.config import Config
from hori.identity import Entity, auto_entity, classify, infer_profile
from test_hori import make_cube

DGO = {"name": {"es": "Durango", "en": "Durango"}, "geometry": {"type": "bbox", "bbox": [22.3, -107.2, 26.8, -102.5]},
       "relations": [{"rel": "part_of", "target": "earth-mexico"}], "source": {"name": "prueba"}}
T2M = {"name": "T2M", "unit": "C", "long_name": "Temperature at 2 Meters", "cell_methods": "time: mean",
       "valid_min": -125.0, "valid_max": 80.0}
PREC = {"name": "PRECTOTCORR", "unit": "mm/day", "long_name": "Precipitation Corrected", "valid_min": 0.0}


def cube_with(var, seed=5, simulated=False):
    cube = make_cube(np.random.default_rng(seed), [(0, 0)], simulated=simulated)
    cube.meta["variable"] = dict(var)
    return cube


def tree_sha(d: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(d.iterdir()):
        h.update(f.name.encode() + f.read_bytes())
    return h.hexdigest()


class TestClassify(unittest.TestCase):
    def test_classes_from_metadata(self):
        self.assertEqual(classify(T2M)[0].id, "temperatura")
        self.assertEqual(classify(PREC)[0].id, "flujo_de_agua")
        self.assertEqual(classify({"name": "WS2M", "unit": "m/s", "long_name": "Wind Speed at 2 Meters"})[0].id, "viento")
        self.assertEqual(classify({"name": "RH2M", "unit": "%", "long_name": "Relative Humidity at 2 Meters"})[0].id,
                         "humedad_relativa")
        self.assertIsNone(classify({"name": "CLOUD_AMT", "unit": "%", "long_name": "Cloud Amount"})[0])   # % alone: unknown
        self.assertIsNone(classify({"name": "ALLSKY", "unit": "kW-hr/m^2/day", "long_name": "Insolation"})[0])

    def test_kelvin_and_si_flux_use_the_same_physics(self):
        self.assertEqual(infer_profile({"name": "T", "unit": "K", "long_name": "air temperature"}).delta_per_decade, 0.3)
        p = infer_profile({"name": "pr", "unit": "kg m-2 s-1", "long_name": "precipitation flux"})
        self.assertAlmostEqual(p.delta_per_decade, 0.2 / 86400)


class TestInfer(unittest.TestCase):
    def test_known_class_gives_physical_delta_and_reasons(self):
        p = infer_profile(T2M)
        self.assertEqual((p.id, p.delta_per_decade, p.review, p.flags), ("auto.temperatura.t2m", 0.3, "automatico", ()))
        self.assertIn("units = 'C'", p.decisions[0])

    def test_unknown_class_says_delta_automatico(self):
        p = infer_profile({"name": "ALLSKY", "unit": "kW-hr/m^2/day", "long_name": "Insolation"})
        self.assertIsNone(p.delta_per_decade)
        self.assertIn("DELTA_AUTOMATICO", p.flags)

    def test_many_zero_years_drop_the_ols_vote(self):
        rng = np.random.default_rng(0)
        v = np.where(rng.random((240, 3, 3)) < 0.7, 0.0, rng.gamma(1.0, 1.0, (240, 3, 3)))
        v[:, 0, :] = 0.0                                                   # a desert row: every year is zero
        time = [f"{2001 + k // 12}-{k % 12 + 1:02d}-01" for k in range(240)]
        p = infer_profile(PREC, v, time)
        self.assertEqual(p.methods, ("MK-VC", "TFPW-WS"))
        self.assertIn("CEROS_FRECUENTES", p.flags)

    def test_values_at_the_bounds_are_flagged(self):
        v = np.zeros((120, 2, 2))
        time = [f"{2001 + k // 12}-{k % 12 + 1:02d}-01" for k in range(120)]
        self.assertIn("ACOTADA", infer_profile(PREC, v, time).flags)


class TestRunAuto(unittest.TestCase):
    def test_auto_profile_and_card_land_in_the_manifest(self):
        res = run_layer(cube_with(T2M), profile="auto", place=DGO)
        m = res.manifest
        self.assertEqual((m["params"]["delta_per_decade"], m["params"]["delta_source"]), (0.3, "profile"))
        self.assertEqual((m["entity"]["id"], m["entity"]["status"], m["entity"]["kind"]), ("earth-durango", "real", "region_cell"))
        self.assertEqual(len(m["entity"]["source"]["input_sha256"]), 64)
        self.assertEqual(m["profile_spec"]["id"], "auto.temperatura.t2m")
        self.assertIn("sigma_median", m["profile_spec"]["measured"])
        self.assertTrue(m["profile_spec"]["decisions"][-1].startswith("Tras correr"))
        self.assertEqual(m["profile"], "earth")                              # legacy string kept

    def test_card_without_a_place_is_the_query_box(self):
        e = run_layer(cube_with(T2M), profile="auto").manifest["entity"]
        self.assertTrue(e["id"].startswith("earth-bbox-"))
        self.assertEqual(e["geometry"]["type"], "bbox")

    def test_explicit_config_delta_wins_and_says_so(self):
        res = run_layer(cube_with(T2M), Config(delta_per_decade=0.5), profile="auto")
        self.assertEqual((res.manifest["params"]["delta_per_decade"], res.manifest["params"]["delta_source"]), (0.5, "config"))

    def test_same_verdicts_as_plain_config_with_the_same_delta(self):
        a = run_layer(cube_with(T2M), profile="auto")
        b = run_layer(cube_with(T2M), Config(delta_per_decade=0.3))
        self.assertTrue(np.array_equal(a.verdict, b.verdict))

    def test_two_method_profile_requires_both(self):
        from hori.identity import infer_profile as ip
        p = ip(T2M)
        two = type(p)(**{**p.__dict__, "methods": ("MK-VC", "TFPW-WS")})
        res = run_layer(cube_with(T2M), profile=two)
        self.assertEqual(res.manifest["methods"], ["MK-VC", "TFPW-WS"])
        self.assertIn("NOT calibrated", res.manifest["calibration"]["note"])
        self.assertTrue((res.nsig_methods <= 2).all())

    def test_misleading_pairs_are_refused(self):
        real = auto_entity({"dataset": {"kind": "observation"}}, [24.0], [-104.0])
        with self.assertRaises(IdentityError):                               # real entity, simulated data
            run_layer(cube_with(T2M, simulated=True), entity=real, profile="auto")
        sim = Entity("persona-sim-01", "region", "earth", {"es": "S", "en": "S"}, "simulada")
        with self.assertRaises(IdentityError):                               # simulated entity, real data
            run_layer(cube_with(T2M), entity=sim, profile="auto")
        mars = Entity("mars-x", "planet_region", "mars", {"es": "M", "en": "M"}, "real")
        with self.assertRaises(IdentityError):                               # wrong body
            run_layer(cube_with(T2M), entity=mars, profile="auto")
        with self.assertRaises(IdentityError):                               # hand-written profile ids are gone
            run_layer(cube_with(T2M), profile="tierra.temperatura")
        with self.assertRaises(IdentityError):                               # entity without a profile
            run_layer(cube_with(T2M), entity=real)

    def test_simulated_data_gets_a_simulated_card(self):
        e = run_layer(cube_with(T2M, simulated=True), profile="auto").manifest["entity"]
        self.assertEqual(e["status"], "simulada")

    def test_without_identity_nothing_new_is_required(self):
        res = run_layer(cube_with(T2M), Config())
        self.assertNotIn("profile_spec", res.manifest)
        self.assertEqual(res.manifest["params"]["delta_source"], "sigma")


class TestReproducible(unittest.TestCase):
    def test_same_input_gives_byte_identical_bundle(self):
        old = os.environ.get("SOURCE_DATE_EPOCH")
        os.environ["SOURCE_DATE_EPOCH"] = "1794700000"
        try:
            with tempfile.TemporaryDirectory() as d:
                a = write_bundle(run_layer(cube_with(T2M), profile="auto", place=DGO), Path(d) / "a")
                b = write_bundle(run_layer(cube_with(T2M), profile="auto", place=DGO), Path(d) / "b")
                self.assertEqual(tree_sha(a), tree_sha(b))
        finally:
            if old is None:
                os.environ.pop("SOURCE_DATE_EPOCH", None)
            else:
                os.environ["SOURCE_DATE_EPOCH"] = old

    def test_input_hash_changes_with_the_data(self):
        a, b = cube_with(T2M, seed=1), cube_with(T2M, seed=2)
        self.assertNotEqual(run_layer(a).manifest["build"]["input_sha256"], run_layer(b).manifest["build"]["input_sha256"])


if __name__ == "__main__":
    unittest.main()
