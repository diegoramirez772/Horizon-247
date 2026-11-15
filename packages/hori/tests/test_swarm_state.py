"""Swarm scoring rules and the unified entity state (six answers, one priority list, template explanations)."""
import unittest

from hori.api import classify_report, entity_state, swarm_signals


def rep(i, who, text, t="2011-05-01T10:00", lat=24.0, lon=-104.6, ev=(), **w):
    return {"id": f"r{i}", "reporter": {"id": who, "type": w.get("type", "persona"), "verified": w.get("verified", False)},
            "lat": lat, "lon": lon, "time": t, "text": text, "evidence": [{"type": k, "sha256": h} for k, h in ev]}


class TestSwarm(unittest.TestCase):
    def test_keywords_are_words_not_substrings(self):
        self.assertEqual(classify_report("Hace mucho frío")[0], ["temperatura"])        # «frío» is not «río»
        self.assertEqual(classify_report("El río se secó"), (["agua"], {"agua": "bajo"}))
        self.assertEqual(classify_report("blablá")[0], ["otro"])

    def test_one_reporter_counts_once_and_reused_evidence_counts_once(self):
        a = swarm_signals([rep(1, "u1", "río seco"), rep(2, "u1", "río seco otra vez"), rep(3, "u1", "río muy seco")])[0]
        self.assertEqual((a["independent_reporters"], a["level"]), (1, "reporte_aislado"))
        b = swarm_signals([rep(1, "u1", "río seco", ev=[("foto", "h1")]), rep(2, "u2", "río seco", ev=[("foto", "h1")])])[0]
        self.assertEqual(b["evidence_items"], 1)
        self.assertIn("evidencia_reutilizada_por_varios", b["flags"])

    def test_claimed_role_without_verification_weighs_like_a_person(self):
        s = swarm_signals([rep(1, "u1", "río seco", type="cientifico")])[0]
        self.assertEqual(s["score"], 1.0)
        s = swarm_signals([rep(1, "u1", "río seco", type="cientifico", verified=True)])[0]
        self.assertEqual(s["score"], 2.0)

    def test_ladder_and_instrument_needs_same_direction(self):
        reps = [rep(i, f"u{i}", "el río está seco", t=f"2011-05-0{i}T10:00", ev=[("foto", f"h{i}")]) for i in range(1, 4)]
        self.assertEqual(swarm_signals(reps)[0]["level"], "senal_con_evidencia")
        yes = lambda *a: {"seen": True, "direction": "bajo", "detail": "x"}
        opposite = lambda *a: {"seen": True, "direction": "alto", "detail": "x"}
        self.assertEqual(swarm_signals(reps, instrument=yes)[0]["level"], "corroborada_por_instrumento")
        self.assertEqual(swarm_signals(reps, instrument=opposite)[0]["level"], "senal_con_evidencia")
        far = reps + [rep(9, "u9", "río seco", lat=30.0, lon=-100.0)]
        self.assertEqual(len(swarm_signals(far)), 2)                                    # far away = another cluster

    def test_a_burst_cannot_climb_on_its_own(self):
        reps = [rep(i, f"u{i}", "río seco", t=f"2011-05-01T10:0{i}") for i in range(6)]
        s = swarm_signals(reps)[0]
        self.assertIn("rafaga", s["flags"])
        self.assertEqual(s["level"], "reporte_aislado")


class TestState(unittest.TestCase):
    ENT = {"id": "earth-x", "type": "region", "body": "earth", "name": {"es": "X", "en": "X"}, "status": "real", "source": {"name": "s"}}

    def test_priority_rules_and_six_answers(self):
        an = [{"type": "racha", "t_start": "2011-05", "t_end": "2011-06", "peak_z": 5.0, "severity": "leve", "variable": "T2M"},
              {"type": "punto", "t_start": "2011-06", "t_end": "2011-06", "peak_z": -4.0, "severity": "leve", "variable": "PREC"},
              {"type": "congelado", "t_start": "2011-04", "t_end": "2011-04", "severity": "media", "variable": "PREC", "n_flagged": 14},
              {"type": "punto", "t_start": "1999-01", "t_end": "1999-01", "peak_z": 9.0, "severity": "media", "variable": "T2M"}]
        tr = [{"variable": "T2M", "unit": "C", "verdict": "PROBADO", "effect": 0.5, "ci": [0.3, 0.7], "mde": 0.2, "delta": 0.3, "years_more": 0},
              {"variable": "PREC", "unit": "mm", "verdict": "NO_CONCLUYENTE", "effect": 0.0, "ci": [-0.1, 0.1], "mde": 0.4, "delta": 0.2, "years_more": 25}]
        st = entity_state(self.ENT, trends=tr, anomalies=an, recent_from="2011-01")
        kinds = [(i["priority"], i["kind"]) for i in st["priority"]]
        self.assertEqual(kinds[0], ("P0", "conjunto"))                                   # two variables at once
        self.assertIn(("P1", "anomalia"), kinds)                                         # the stuck sensor
        self.assertEqual([i for i in st["priority"] if i.get("t_start") == "1999-01"][0]["priority"], "P4")   # old = informative
        self.assertEqual(st["status"], "atencion")
        self.assertTrue(any("25 años" in u for u in st["unknowns"]))
        for k in ("entity", "identity", "status", "changes", "attention", "follow_up"):
            self.assertIn(k, st)
        text = " ".join(i["text_es"] for i in st["priority"]).lower()
        for banned in ("recomend", "debe ", "deberia", "peligro inminente", "causa de"):
            self.assertNotIn(banned, text)                                               # H17: no advice, no causes

    def test_nothing_means_sin_novedad(self):
        self.assertEqual(entity_state(self.ENT)["status"], "sin_novedad")


if __name__ == "__main__":
    unittest.main()
