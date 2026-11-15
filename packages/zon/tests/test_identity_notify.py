"""Verifiable identity (Ed25519, RFC 8032) and notices with escalation and continuous watching."""
import hashlib
import hmac
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np

from zon.monitors import Monitor, MonitorError, MonitorStore
from zon.notify import EscalationPolicy, FileSink, WebhookSink, notify_and_escalate, watch
from zon.signing import TrustRegistry, attest, canonical, public_key, sign, verify
from zon.swarm import SwarmStore


class TestSigning(unittest.TestCase):
    def test_rfc8032_test_vector_1(self):
        sk = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
        self.assertEqual(public_key(sk).hex(), "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        sig = sign(sk, b"")
        self.assertEqual(sig.hex()[:32], "e5564300c360ac729086e2cc806e828a")
        self.assertTrue(verify(public_key(sk), b"", sig))
        self.assertFalse(verify(public_key(sk), b"tampered", sig))


class TestVerifiedReporters(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.sk = bytes(range(32))
        self.trust = TrustRegistry()
        self.trust.add("uni-1", public_key(self.sk), "Universidad (prueba)", "institucion")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def rep(self, who, att=None, t="2011-05-01T10:00"):
        return {"reporter": {"id": who, "type": "cientifico"}, "lat": 24, "lon": -104, "time": t, "text": "río seco",
                **({"attestation": att} if att else {})}

    def test_role_counts_only_with_a_valid_signed_attestation(self):
        sw = SwarmStore(self.tmp, trust=self.trust)
        good = attest(self.sk, "uni-1", "u-4", "cientifico", "2027-01-01")
        self.assertTrue(sw.add_report(self.rep("u-4", good))["reporter"]["verified"])
        self.assertFalse(sw.add_report(self.rep("u-5", good))["reporter"]["verified"])                    # someone else's
        expired = attest(self.sk, "uni-1", "u-6", "cientifico", "2010-01-01")
        self.assertFalse(sw.add_report(self.rep("u-6", expired))["reporter"]["verified"])
        forged = attest(bytes(32), "uni-1", "u-7", "cientifico", "2027-01-01")                            # not the trusted key
        r = sw.add_report(self.rep("u-7", forged))
        self.assertEqual((r["reporter"]["verified"], r["reporter"]["verification"]), (False, "firma inválida"))
        self.assertFalse(sw.add_report(self.rep("u-8", {"key_id": "nadie", "statement": {}, "signature": "00"}))["reporter"]["verified"])

    def test_device_signed_observations(self):
        ms = MonitorStore(self.tmp / "m")
        dev = bytes([7] * 32)
        reg = TrustRegistry()
        reg.add("dev-1", public_key(dev), "estación (prueba)", "dispositivo")
        ms.add_monitor(Monitor("mon-s", {"id": "earth-s", "status": "real"}, {"name": "T", "unit": "C"}, 12, params={"require_signature": True}))
        t, v = [f"2000-{m:02d}" for m in range(1, 13)], list(np.arange(12.0))
        with self.assertRaises(MonitorError):
            ms.ingest("mon-s", t, v, trust=reg)                                                          # unsigned: refused
        stmt = {"monitor": "mon-s", "times": t, "values": [float(x) for x in v]}
        ms.ingest("mon-s", t, v, signed={"key_id": "dev-1", "signature": sign(dev, canonical(stmt)).hex()}, trust=reg)
        log = ms.audit_records()
        self.assertTrue(any(r["action"] == "observaciones" and r["data"]["firma"].startswith("firma válida") for r in log))
        self.assertTrue(any(r["action"] == "observaciones_rechazadas" for r in log))


class TestNotify(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.now = ["2026-11-15T10:00:00Z"]
        self.ms = MonitorStore(self.tmp / "m", clock=lambda: self.now[0])
        self.ms.add_monitor(Monitor("mon-a", {"id": "human-sim", "status": "simulada"}, {"name": "hr", "unit": "bpm"}, 24))
        x = 5 * np.sin(2 * np.pi * np.arange(400) / 24) + np.random.default_rng(1).standard_normal(400)
        x[380] += 30
        self.ms.ingest("mon-a", [f"2026-01-01T{k:05d}" for k in range(400)], x)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_send_once_then_escalate_when_not_acknowledged(self):
        inbox = FileSink(self.tmp / "bandeja.jsonl")
        pol = EscalationPolicy([["carolina"], ["diego"]], {"alta": 30, "media": 30, "leve": 30})
        first = notify_and_escalate(self.ms, [inbox], pol, "2026-11-15T10:05:00Z")
        self.assertTrue(first and all(m["kind"] == "aviso_enviado" and m["to"] == ["carolina"] for m in first))
        self.assertTrue(all("[SIMULADO]" in m["subject"] for m in first))
        self.assertEqual(notify_and_escalate(self.ms, [inbox], pol, "2026-11-15T10:10:00Z"), [])          # nothing new, not overdue
        ack = first[0]["alert"]
        self.ms.transition(ack, "reconocida", actor="carolina")
        late = notify_and_escalate(self.ms, [inbox], pol, "2026-11-15T11:00:00Z")
        self.assertTrue(late and all(m["kind"] == "escalada" and m["to"] == ["diego"] for m in late))
        self.assertNotIn(ack, {m["alert"] for m in late})                                                # acknowledged: no escalation
        self.assertEqual(notify_and_escalate(self.ms, [inbox], pol, "2026-11-15T12:00:00Z"), [])          # once per level

    def test_webhook_is_hmac_signed_and_a_broken_channel_does_not_stop_others(self):
        got = {}

        class Resp:
            status = 204
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def opener(req, timeout):
            got["body"], got["sig"] = req.data, req.headers["X-horizon-signature"]
            return Resp()

        class Broken:
            def send(self, msg): raise OSError("down")
        sent = notify_and_escalate(self.ms, [Broken(), WebhookSink("http://x", b"k", opener=opener)], EscalationPolicy([["a"]]))
        self.assertTrue(sent)
        self.assertEqual(got["sig"], hmac.new(b"k", got["body"], hashlib.sha256).hexdigest())

    def test_watch_loop_ingests_only_new_data(self):
        calls = []

        def src(store):
            last = (store.observations("mon-a")[0] or [None])[-1]
            calls.append(last)
            return ("mon-a", ["2026-01-01T00400"], [0.0]) if len(calls) == 1 else ("mon-a", [], [])
        log = watch(self.ms, [src], [FileSink(self.tmp / "b.jsonl")], EscalationPolicy([["a"]]), every_s=0, max_ticks=2,
                    clock=lambda: "2026-11-15T10:00:00Z", sleep=lambda s: None)
        self.assertEqual([t["ingested"] for t in log], [{"mon-a": 1}, {}])
        self.assertEqual(calls, ["2026-01-01T00399", "2026-01-01T00400"])


if __name__ == "__main__":
    unittest.main()
