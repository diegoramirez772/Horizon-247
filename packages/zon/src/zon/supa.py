"""ZON -> Supabase (proyecto `horizon-247`, plan free): only the LIGHT part goes to the database (README D13).

    python -m zon db-push --bundles apps/web/public/bundles            # SQL to the project (token in the environment)
    python -m zon db-push --bundles apps/web/public/bundles --sql out.sql   # only write the SQL

What goes up, per exported bundle: its source, dataset version, variable, entity, one analysis run (with the manifest
as an artifact row: path + SHA-256, never the arrays), the grid summary as a finding, and the cell findings only for
regional boxes (72 cells for Durango). From home.json: each place, its monitor and its regional finding.
Maps, series and windows stay in files. Everything is idempotent: ids are UUIDv5 of stable keys and every insert is
`on conflict do nothing`, so pushing twice changes nothing and a new bundle version becomes a NEW run (the schema
keeps findings immutable).

Transport: Supabase Management API with SUPABASE_ACCESS_TOKEN (or the file in HORIZON_SUPABASE_TOKEN_FILE /
~/.config/horizon/supabase.env). The token is never printed.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import urllib.request
import uuid
from pathlib import Path

import numpy as np

PROJECT_REF = "lrxumkndviytplegtxna"
_NS = uuid.UUID("6f1c2d0e-2470-4a1e-9e2b-247247247247")
WORKSPACE_SLUG = "aethra-horizon247"
RULE = "consenso-3-bh-q0.10"
_DATASET_KINDS = {"observation", "analysis", "reanalysis", "reconstruction", "simulated", "community"}


def uid(*key: object) -> str:
    return str(uuid.uuid5(_NS, ":".join(str(k) for k in key)))


def lit(v) -> str:
    """Python value -> SQL literal (NaN/inf/None -> NULL, dict/list -> jsonb)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, (float, np.floating)):
        return repr(float(v)) if math.isfinite(v) else "null"
    if isinstance(v, (dict, list)):
        return lit(json.dumps(v, ensure_ascii=False, allow_nan=False, default=_json_default)) + "::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def _json_default(o):
    if isinstance(o, np.generic):
        return o.item()
    raise TypeError(type(o))


def _clean(v):
    """JSON payloads may not carry NaN (the schema forbids it)."""
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def insert(table: str, row: dict, conflict: str = "do nothing") -> str:
    cols = ", ".join(row)
    vals = ", ".join(lit(_clean(v)) for v in row.values())
    return f"insert into public.{table} ({cols}) values ({vals}) on conflict {conflict};"


def _sha_hex(x) -> str | None:
    return x if isinstance(x, str) and len(x) == 64 and all(c in "0123456789abcdef" for c in x) else None


class _Push:
    def __init__(self) -> None:
        self.sql: list[str] = []
        self.ws = uid("workspace", WORKSPACE_SLUG)
        self.counts: dict[str, int] = {}
        self._seen: set[str] = set()

    def add(self, table: str, row: dict, **kw) -> None:
        key = f"{table}:{row.get('id', json.dumps(row, default=str, sort_keys=True))}"
        if key in self._seen:
            return
        self._seen.add(key)
        self.sql.append(insert(table, row, **kw))
        self.counts[table] = self.counts.get(table, 0) + 1

    # ------------------------------------------------------------- catalog
    def source(self, ds: dict, simulated: bool) -> str:
        provider = ds.get("provider") or ds.get("name") or "desconocido"
        sid = uid("source", provider)
        self.add("sources", {"id": sid, "workspace_id": self.ws, "provider": provider, "url": ds.get("url"),
                             "kind": "simulated" if simulated else "official", "attribution": ds.get("name")})
        return sid

    def dataset(self, sid: str, ds: dict, window: dict, simulated: bool, bundle_id: str) -> str:
        sha = _sha_hex(ds.get("sha256"))
        version = f"{str(ds.get('version') or 's/v')[:60]} · {sha[:12] if sha else bundle_id}"
        did = uid("dataset", sid, version)
        kind = "simulated" if simulated else (ds.get("kind") if ds.get("kind") in _DATASET_KINDS else "reanalysis")
        # Earth windows are calendar years; Mars uses Mars Years (MY24…), which are not timestamps.
        earth = isinstance(window.get("start"), int) and window["start"] >= 1800
        self.add("dataset_versions", {
            "id": did, "workspace_id": self.ws, "source_id": sid, "version": version, "kind": kind,
            "time_start": f"{window['start']}-01-01T00:00:00Z" if earth else None,
            "time_end": f"{window['end']}-12-31T23:59:59Z" if earth else None,
            "licence": ds.get("licence") or "ver fuente", "manifest_sha256": sha,
            "provenance": {"name": ds.get("name"), "doi": ds.get("doi"), "url": ds.get("url"), "window": window},
        })
        return did

    def variable(self, var: dict) -> str:
        key = str(var.get("name", "x")).lower()
        vid = uid("variable", key)
        self.add("variables", {"id": vid, "workspace_id": self.ws, "key": key, "value_type": "numeric",
                               "canonical_unit": var.get("unit") or "1",
                               "rules": {"unit_per_decade": var.get("unit_per_decade"), "long_name": var.get("long_name")}})
        return vid

    def entity(self, key: str, kind: str, name: str) -> str:
        eid = uid("entity", key)
        self.add("entities", {"id": eid, "workspace_id": self.ws, "external_key": key, "kind": kind,
                              "reference_name": name[:200]})
        return eid

    def artifact(self, path: str, meta: dict) -> str | None:
        sha = _sha_hex(meta.get("sha256"))
        if not sha:
            return None
        aid = uid("artifact", path, sha)
        self.add("artifacts", {"id": aid, "workspace_id": self.ws, "backend": "static-web", "bucket": "public/bundles",
                               "object_key": path, "sha256": sha, "bytes": int(meta.get("bytes", 0)),
                               "mime": "application/json", "format": "horizon-bundle-manifest",
                               "licence": None, "status": "ready", "ready_at": "now()"})
        return aid


def _profile(m: dict) -> str:
    kind = (m.get("entity") or {}).get("kind", "")
    if (m.get("grid") or {}).get("nlat", 0) * (m.get("grid") or {}).get("nlon", 0) > 1000:
        return "grid"
    return "regional" if kind == "region_cell" else "layer"


def _read(dirp: Path, m: dict, name: str) -> np.ndarray | None:
    a = (m.get("arrays") or {}).get(name)
    f = dirp / (a.get("file", f"{name}.f32") if isinstance(a, dict) else f"{name}.f32")
    if not f.exists():
        f = dirp / f"{name}.u8"
    if not f.exists():
        return None
    return np.fromfile(f, dtype="<f4" if f.suffix == ".f32" else np.uint8)


def _layer(p: _Push, root: Path, entry: dict, cell_limit: int) -> None:
    d = root / entry["path"]
    m = json.loads((d / "manifest.json").read_text())
    honesty = m.get("honesty") or {}
    simulated = bool(honesty.get("simulated"))
    ds, win, var = m.get("dataset") or {}, m.get("window") or {}, m.get("variable") or {}
    sid = p.source(ds, simulated)
    did = p.dataset(sid, ds, win, simulated, m["id"])
    vid = p.variable(var)
    kind = _profile(m)
    title = (m.get("title") or entry.get("title") or {}).get("es") or m["id"]
    ent_key = f"{m.get('profile', 'earth')}:{entry['path'].split('/')[-1]}"
    p.entity(ent_key, (m.get("entity") or {}).get("kind", "grid"), title)
    man_sha = (entry.get("files") or {}).get("manifest.json", {}).get("sha256") or hashlib.sha256((d / "manifest.json").read_bytes()).hexdigest()
    run = uid("run", m["id"], man_sha)
    build = m.get("build") or {}
    p.add("analysis_runs", {
        "id": run, "workspace_id": p.ws, "monitor_version_id": None,
        "adhoc_snapshot": {"bundle": entry["path"], "entity": ent_key, "title": m.get("title"), "honesty": honesty},
        "run_kind": kind, "mode": "operational", "status": "succeeded", "idempotency_key": f"{m['id']}@{man_sha[:16]}",
        "config": {"params": m.get("params"), "methods": m.get("methods"), "window": win, "grid": m.get("grid")},
        "windows": [win], "code_versions": build, "scientific_fingerprint": man_sha,
        "fdr_family": f"grid:{m['id']}", "current_attempt": 1, "finished_at": build.get("created_at"),
    })
    p.add("run_inputs", {"id": uid("run_input", run, did), "workspace_id": p.ws, "run_id": run,
                         "dataset_version_id": did, "variable_id": vid, "role": "dataset"})
    aid = p.artifact(f"{entry['path']}/manifest.json", {"sha256": man_sha, "bytes": (entry.get("files") or {}).get("manifest.json", {}).get("bytes", (d / "manifest.json").stat().st_size)})
    if aid:
        p.add("run_artifacts", {"workspace_id": p.ws, "run_id": run, "artifact_id": aid, "role": "manifest",
                                "rel_path": "manifest.json"})
    unit = var.get("unit_per_decade") or var.get("unit")
    p.add("findings", {
        "id": uid("finding", run, "grid"), "workspace_id": p.ws, "run_id": run, "finding_kind": "derived",
        "variable_id": vid, "scope": "grid", "scope_ref": "all", "window_start": win.get("start"),
        "window_end": win.get("end"), "fdr_family": f"grid:{m['id']}", "rule": RULE, "unit": unit,
        "locator": {"bundle": entry["path"]}, "diagnostics": {"summary": m.get("summary"), "calibration": m.get("calibration")},
        "diagnostics_version": 1,
    })
    g = m.get("grid") or {}
    n = int(g.get("nlat", 0)) * int(g.get("nlon", 0))
    if kind != "regional" or not 0 < n <= cell_limit:
        return
    arr = {k: _read(d, m, k) for k in ("verdict", "effect", "ci_lo", "ci_hi", "mde", "p_cons", "q_cons", "flags")}
    if arr["verdict"] is None or arr["effect"] is None:
        return
    delta = (m.get("params") or {}).get("delta_per_decade")
    for i in range(n):
        v = int(arr["verdict"][i])
        if v == 0:
            continue
        lat = g["lat0"] + (i // g["nlon"]) * g["dlat"]
        lon = g["lon0"] + (i % g["nlon"]) * g["dlon"]
        f = lambda k: (float(arr[k][i]) if arr[k] is not None else None)  # noqa: E731
        lo, hi = f("ci_lo"), f("ci_hi")
        if lo is not None and hi is not None and math.isfinite(lo) and math.isfinite(hi) and lo > hi:
            lo, hi = hi, lo
        prob = lambda x: x if x is not None and math.isfinite(x) and 0 <= x <= 1 else None  # noqa: E731
        p.add("findings", {
            "id": uid("finding", run, "cell", i), "workspace_id": p.ws, "run_id": run, "finding_kind": "atomic",
            "variable_id": vid, "scope": "cell", "scope_ref": str(i), "window_start": win.get("start"),
            "window_end": win.get("end"), "fdr_family": f"grid:{m['id']}", "rule": RULE, "effect": f("effect"),
            "ci_lo": lo, "ci_hi": hi, "unit": unit, "verdict": v, "mde": f("mde"), "delta": delta,
            "p_cons": prob(f("p_cons")), "q_value": prob(f("q_cons")), "flags": int(arr["flags"][i]) if arr["flags"] is not None else 0,
            "locator": {"bundle": entry["path"], "index": i, "lat": round(lat, 4), "lon": round(lon, 4)},
        })


def _home(p: _Push, home: dict) -> None:
    owner = uid("profile", "zon")
    p.add("profiles", {"id": owner, "display_name": "ZON (sistema)"})
    p.add("memberships", {"workspace_id": p.ws, "profile_id": owner, "role": "owner"})
    for e in home.get("entities", []):
        ent = e["entity"]
        eid = p.entity(ent["id"], ent.get("kind") or ent.get("type") or "region", ent["name"]["es"])
        snap = {k: ent.get(k) for k in ("id", "type", "body", "name", "status", "source", "kind")}
        evid = uid("entity_version", ent["id"], 1)
        p.add("entity_versions", {
            "id": evid, "workspace_id": p.ws, "entity_id": eid, "number": 1, "body": ent.get("body", "earth"),
            "crs": "EPSG:4326", "geometry": None, "nature": "real" if ent.get("status") == "real" else "declared",
            "provenance": ent.get("source") or {}, "snapshot_sha256": hashlib.sha256(json.dumps(snap, sort_keys=True).encode()).hexdigest(),
        })
        p.sql.append(f"update public.entities set current_version = 1 where id = {lit(eid)} and current_version is null;")
        for mon in e.get("monitors", []):
            var, fd = mon.get("variable") or {}, mon.get("finding") or {}
            vid = p.variable(var)
            mid = uid("monitor", mon["id"])
            p.add("monitors", {"id": mid, "workspace_id": p.ws, "owner_profile_id": owner,
                               "name": f"{ent['name']['es']} · {(var.get('label') or {}).get('es', var.get('name'))}"})
            cfg = {"variable": var.get("name"), "delta": fd.get("delta"), "window": fd.get("window"), "rule": RULE}
            mvid = uid("monitor_version", mon["id"], 1)
            p.add("monitor_versions", {
                "id": mvid, "workspace_id": p.ws, "monitor_id": mid, "number": 1, "entity_version_id": evid,
                "sources": [ent.get("source") or {}], "config": cfg, "author_profile_id": owner,
                "config_sha256": hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest(),
            })
            # Variables can only be attached while the version is a draft (schema guard), then it is activated.
            p.sql.append(
                f"insert into public.monitor_variables (id, workspace_id, monitor_version_id, variable_id, threshold, unit) "
                f"select {lit(uid('monitor_var', mon['id'], var.get('name')))}, {lit(p.ws)}, {lit(mvid)}, {lit(vid)}, "
                f"{lit(fd.get('delta'))}, {lit(var.get('unit_per_decade'))} where exists (select 1 from public.monitor_versions "
                f"where id = {lit(mvid)} and status = 'draft') on conflict do nothing;")
            p.sql.append(f"update public.monitor_versions set status = 'active', activated_at = now() where id = {lit(mvid)} and status = 'draft';")
            p.sql.append(f"update public.monitors set current_version = 1 where id = {lit(mid)} and current_version is null;")
            win = fd.get("window") or {}
            fp = hashlib.sha256(json.dumps(_clean(fd), sort_keys=True).encode()).hexdigest()
            run = uid("run", mon["id"], fp)
            p.add("analysis_runs", {
                "id": run, "workspace_id": p.ws, "monitor_version_id": mvid, "adhoc_snapshot": None,
                "run_kind": "regional", "status": "succeeded", "idempotency_key": f"{mon['id']}@{fp[:16]}",
                "config": cfg, "windows": [win], "code_versions": {"source": "zon home"}, "scientific_fingerprint": fp,
                "fdr_family": f"regions:{mon['id']}", "current_attempt": 1, "finished_at": "now()",
            })
            ci = fd.get("ci") or [None, None]
            p.add("findings", {
                "id": uid("finding", run, "entity"), "workspace_id": p.ws, "run_id": run, "finding_kind": "atomic",
                "variable_id": vid, "scope": "entity", "scope_ref": ent["id"], "window_start": win.get("start"),
                "window_end": win.get("end"), "fdr_family": f"regions:{mon['id']}", "rule": RULE,
                "effect": fd.get("effect"), "ci_lo": ci[0], "ci_hi": ci[1], "unit": var.get("unit_per_decade"),
                "verdict": fd.get("verdict"), "mde": fd.get("mde"), "delta": fd.get("delta"), "p_cons": fd.get("p"),
                "q_value": fd.get("q"), "flags": int(fd.get("flags") or 0),
                "diagnostics": {k: fd.get(k) for k in ("n", "n_sig", "sigma", "r1", "break_year", "years_more", "ebh")},
                "diagnostics_version": 1,
            })


def build_sql(bundles: str | Path, cell_limit: int = 500) -> tuple[str, dict[str, int]]:
    """Pure: exported bundles directory (index.json + home.json) -> one transaction of idempotent SQL."""
    root = Path(bundles)
    p = _Push()
    p.add("workspaces", {"id": p.ws, "name": "AETHRA · HORIZON 247", "accepts_public_input": True},
          conflict="(id) do update set accepts_public_input = excluded.accepts_public_input")
    index = json.loads((root / "index.json").read_text())
    for entry in index:
        if (entry.get("kind") or "layer") == "layer":
            _layer(p, root, entry, cell_limit)
    if (root / "home.json").exists():
        _home(p, json.loads((root / "home.json").read_text()))
    sql = "begin;\n" + "\n".join(s.replace("'now()'", "now()") for s in p.sql) + "\ncommit;\n"
    return sql, p.counts


def _token() -> str | None:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if t:
        return t.strip()
    for f in (os.environ.get("HORIZON_SUPABASE_TOKEN_FILE"), str(Path.home() / ".config/horizon/supabase.env")):
        if f and Path(f).exists():
            for line in Path(f).read_text().splitlines():
                line = line.strip()
                if line.startswith("SUPABASE_ACCESS_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"')
                if line.startswith("sbp_"):
                    return line
    return None


def run_query(sql: str, project: str = PROJECT_REF, token: str | None = None):
    token = token or _token()
    if not token:
        raise SystemExit("falta SUPABASE_ACCESS_TOKEN (o ~/.config/horizon/supabase.env)")
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{project}/database/query",
                                 data=json.dumps({"query": sql}).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": "zon-db-push"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Supabase {e.code}: {e.read().decode(errors='replace')[:800]}") from None


def push(bundles: str | Path, project: str = PROJECT_REF, sql_out: str | None = None, cell_limit: int = 500) -> dict:
    sql, counts = build_sql(bundles, cell_limit=cell_limit)
    if sql_out:
        Path(sql_out).write_text(sql)
        return {"sql": sql_out, "bytes": len(sql), "rows": counts}
    run_query(sql, project)
    after = run_query("select (select count(*) from public.analysis_runs) runs, (select count(*) from public.findings) findings, "
                      "(select count(*) from public.monitors) monitors, (select count(*) from public.entities) entities, "
                      "pg_size_pretty(pg_database_size(current_database())) db_size", project)
    return {"project": project, "sent_rows": counts, "in_db": after[0] if after else None}
