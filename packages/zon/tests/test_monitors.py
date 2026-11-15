"""Functions 1 and 5: persistent monitors, alerts with lifecycle, audit chain; on a SIMULATED astronaut with known truth."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from hori.api import Entity
from zon.monitors import Monitor, MonitorError, MonitorStore
from zon.sim.astronaut import simulate_astronaut


def clock():
    return "2026-11-15T00:00:00Z"


class TestMonitors(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.store = MonitorStore(self.tmp, clock=clock)
        self.a = simulate_astronaut()
        ent = Entity("human-astro-sim-01", "person", "human", {"es": "Astronauta simulado 01", "en": "Simulated astronaut 01"},
                     "simulada", source={"name": "generador determinista"}).to_dict()
        self.mon = Monitor("mon-astro-hr", ent, {"name": "hr_bpm", "unit": "bpm"}, self.a["period"])
        self.hr = self.a["signals"]["hr_bpm"]["values"]

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_truth_is_recovered_and_alerts_are_marked_simulated(self):
        self.store.add_monitor(self.mon)
        self.store.ingest("mon-astro-hr", self.a["times"], self.hr)
        al = self.store.alerts("mon-astro-hr")
        starts = {x["evidence"]["t_start"][:13] for x in al}
        for t in self.a["truth"]:
            if t["signal"] == "hr_bpm":
                self.assertTrue(any(self.a["times"][t["start"]][:13] <= s <= self.a["times"][t["end"]][:13] for s in starts), t)
        self.assertTrue(all(x["simulated"] and x["origin"] == "HORI" and x["state"] == "abierta" for x in al))
        self.assertTrue(all("no prueba" in x["note"]["es"] for x in al))

    def test_ingesting_in_two_chunks_gives_the_same_alerts_without_duplicates(self):
        self.store.add_monitor(self.mon)
        cut = 2500
        self.store.ingest("mon-astro-hr", self.a["times"][:cut], self.hr[:cut])
        first = {x["id"] for x in self.store.alerts()}
        self.store.ingest("mon-astro-hr", self.a["times"][cut:], self.hr[cut:])
        ids = [x["id"] for x in self.store.alerts()]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(first <= set(ids))
        with self.assertRaises(MonitorError):
            self.store.ingest("mon-astro-hr", self.a["times"][:10], self.hr[:10])        # not after the last one

    def test_lifecycle_rules_and_owner(self):
        self.store.add_monitor(self.mon)
        self.store.ingest("mon-astro-hr", self.a["times"], self.hr)
        aid = self.store.alerts()[0]["id"]
        self.store.transition(aid, "reconocida", actor="carolina", note="la reviso")
        with self.assertRaises(MonitorError):
            self.store.transition(aid, "abierta", actor="carolina")                       # cannot go back
        with self.assertRaises(MonitorError):
            self.store.transition(aid, "derivada", actor="sistema")                       # a person owns the change
        self.store.transition(aid, "derivada", actor="carolina", note="a Diego")
        done = self.store.transition(aid, "cerrada", actor="diego", note="falsa alarma del sensor")
        self.assertEqual([h["to"] for h in done["history"]], ["reconocida", "derivada", "cerrada"])
        with self.assertRaises(MonitorError):
            self.store.transition(aid, "reconocida", actor="diego")                       # closed is final

    def test_audit_chain_detects_tampering(self):
        self.store.add_monitor(self.mon)
        self.store.ingest("mon-astro-hr", self.a["times"], self.hr)
        self.store.transition(self.store.alerts()[0]["id"], "reconocida", actor="carolina")
        ok, n = self.store.verify_audit()
        self.assertTrue(ok and n >= 4)
        p = self.tmp / "audit.jsonl"
        lines = p.read_text().splitlines()
        rec = json.loads(lines[1])
        rec["actor"] = "otra-persona"
        lines[1] = json.dumps(rec, ensure_ascii=False)
        p.write_text("\n".join(lines) + "\n")
        self.assertFalse(self.store.verify_audit()[0])


if __name__ == "__main__":
    unittest.main()
