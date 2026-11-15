"""CLI:
    python -m zon build-power --bbox S W N E --param T2M --start 2001 --end 2024 --region durango --out data
    python -m zon update-planet --param T2M --start 1981 --out data       # Z3: new month? recompute + events
    python -m zon export-web --src data/bundles --out apps/web/public/bundles   # Z7: static files + index.json
    python -m zon watch --config watch.json --once                               # vigilancia: datos nuevos -> alertas -> avisos
    python -m zon home --place Durango Chihuahua --var T2M PRECTOTCORR --out apps/web/public/bundles   # «Mis monitores»
    python -m zon db-push --bundles apps/web/public/bundles      # lo ligero a Supabase (catálogo, corridas, hallazgos, monitores)
"""
import argparse
import sys


def main() -> None:
    ap = argparse.ArgumentParser(prog="zon")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("build-power", help="NASA POWER box -> cube -> HORI -> bundle (no account needed)")
    p.add_argument("--bbox", type=float, nargs=4, metavar=("S", "W", "N", "E"), required=True)
    p.add_argument("--param", required=True)
    p.add_argument("--start", type=int, required=True)
    p.add_argument("--end", type=int, required=True)
    p.add_argument("--fetch-params", nargs="+", help="request these parameters together (reuses the cache)")
    p.add_argument("--region", default="region")
    p.add_argument("--out", default="data")
    p.add_argument("--offline", action="store_true", help="use only the cache")
    p.add_argument("--title-es")
    p.add_argument("--title-en")
    p.add_argument("--delta-per-decade", type=float, help="effect of interest in physical units per decade")
    u = sub.add_parser("update-planet", help="Z3: look for a new month in the POWER store; if any, recompute the planet and emit events")
    u.add_argument("--param", required=True)
    u.add_argument("--start", type=int, default=1981)
    u.add_argument("--out", default="data")
    u.add_argument("--force", action="store_true", help="recompute even if the last month is the same")
    w = sub.add_parser("export-web", help="Z7: copy computed bundles as static files + index.json (with SHA-256) for the web")
    w.add_argument("--src", default="data/bundles")
    w.add_argument("--out", default="apps/web/public/bundles")
    w.add_argument("--include", nargs="*", help="only bundle paths starting with these prefixes")
    wt = sub.add_parser("watch", help="continuous watching: new data -> detectors -> alerts -> notices/escalation")
    wt.add_argument("--config", required=True, help='JSON: {"store": dir, "inbox": file, "webhooks": [{"url","secret"}], '
                    '"levels": [[..],[..]], "ack_minutes": {..}, "sources": [{"monitor","place","var","start"}]}')
    wt.add_argument("--every", type=float, default=3600)
    wt.add_argument("--once", action="store_true", help="one pass (for cron or a systemd timer)")
    am = sub.add_parser("anomaly-map", help="where on the planet the LAST month is unusual (parallel, from the POWER chunks)")
    am.add_argument("--param", required=True)
    am.add_argument("--out", default="data")
    am.add_argument("--workers", type=int, default=2)
    am.add_argument("--online", action="store_true", help="read the store from the network instead of the cache")
    sv = sub.add_parser("serve", help="ZON API: HTTP + JSON + live events (SSE)")
    sv.add_argument("--root", default="data/zon")
    sv.add_argument("--port", type=int, default=8247)
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--bundles", default="data/bundles")
    sv.add_argument("--workers", type=int, default=1, help="processes serving the same port (pre-fork); use the number of cores")
    ky = sub.add_parser("key", help="create an API key (shown once)")
    ky.add_argument("--root", default="data/zon")
    ky.add_argument("--name", required=True)
    ky.add_argument("--role", choices=["lector", "operador", "admin"], required=True)
    ky.add_argument("--orgs", nargs="+", default=["publica"])
    hm = sub.add_parser("home", help="«Mis monitores»: regional finding + time machine + recent anomalies + state per place (home.json)")
    hm.add_argument("--place", nargs="+", required=True, help="any place name in the local index (Natural Earth / GeoNames)")
    hm.add_argument("--var", nargs="+", default=["T2M"])
    hm.add_argument("--start", type=int, default=1981)
    hm.add_argument("--end", type=int, default=2026, help="last year to read; the trend uses complete years only")
    hm.add_argument("--places-dir", default="data/places")
    hm.add_argument("--out", default="apps/web/public/bundles")
    hm.add_argument("--online", action="store_true", help="read the store from the network instead of the cache")
    dp = sub.add_parser("db-push", help="light rows to Supabase: catalog, runs, selected findings, monitors (never arrays)")
    dp.add_argument("--bundles", default="apps/web/public/bundles", help="exported web bundles (index.json + home.json)")
    dp.add_argument("--project", default=None, help="Supabase project ref (default: horizon-247)")
    dp.add_argument("--sql", default=None, help="only write the SQL to this file; send nothing")
    dp.add_argument("--cell-limit", type=int, default=500, help="cell findings only for regional boxes up to this many cells")
    args = ap.parse_args()
    if args.cmd == "db-push":
        import json
        from .supa import PROJECT_REF, push
        print(json.dumps(push(args.bundles, args.project or PROJECT_REF, args.sql, args.cell_limit), indent=1, ensure_ascii=False))
        return
    if args.cmd == "home":
        from .fetch.power_zarr import PowerZarr
        from .home import build_home
        from .places import PlaceIndex
        d = args.places_dir.rstrip("/") + "/"
        idx = PlaceIndex.from_natural_earth(d + "ne_10m_admin_0_countries.shp", d + "ne_10m_admin_1_states_provinces.shp")
        doc = build_home(args.place, args.var, args.start, args.end, index=idx, store=PowerZarr(offline=not args.online), out_dir=args.out)
        for e in doc["entities"]:
            print(e["entity"]["name"]["es"], "·", e["state"]["status"], "·", (e["state"]["headline"] or {}).get("es"))
        print(f"home.json -> {args.out} ({len(doc['events'])} eventos)")
        return
    if args.cmd == "anomaly-map":
        import json
        from .anomaly_map import anomaly_map
        from .fetch.power_zarr import PowerZarr
        print(json.dumps(anomaly_map(args.param, args.out, store=PowerZarr(offline=not args.online), workers=args.workers,
                                     progress=lambda i: print(f"\r  {i} trozos", end="", file=sys.stderr)), ensure_ascii=False, indent=1))
        return
    if args.cmd == "serve":
        from .server import serve
        serve(args.root, args.port, args.host, args.bundles, workers=args.workers)
        return
    if args.cmd == "key":
        from . import auth, db
        print(auth.create_key(db.connect(args.root), args.name, args.role, args.orgs))
        return
    if args.cmd == "watch":
        import json
        from pathlib import Path
        from .monitors import MonitorStore
        from .notify import EscalationPolicy, FileSink, WebhookSink, fauna_source, power_place_source, watch
        from .places import PlaceIndex
        c = json.loads(Path(args.config).read_text(encoding="utf-8"))
        idx = PlaceIndex.from_natural_earth(c.get("admin0"), c.get("admin1"))
        sinks = [FileSink(c.get("inbox", Path(c["store"]) / "bandeja.jsonl"))] + \
                [WebhookSink(w["url"], w["secret"].encode()) for w in c.get("webhooks", [])]
        pol = EscalationPolicy(c["levels"], c.get("ack_minutes", {"alta": 30, "media": 240, "leve": None}))
        # a source is a POWER place series or, with "fauna": {"box": [...], "group": "aves"}, an animal reporting rate
        srcs = [fauna_source(s["monitor"], s["fauna"]["box"], s["fauna"]["group"], start=s["fauna"].get("start", "2012-01-01"))
                if "fauna" in s else power_place_source(s["monitor"], s["place"], s["var"], s.get("start", 1981), index=idx)
                for s in c.get("sources", [])]
        mstore = MonitorStore(c["store"])
        for s in c.get("sources", []):
            if "fauna" in s and s["monitor"] not in mstore.monitors():
                from .notify import fauna_monitor
                mstore.add_monitor(fauna_monitor(s["monitor"], s["fauna"]["box"], s["fauna"]["group"]))
        for t in watch(mstore, srcs, sinks, pol, every_s=args.every, once=args.once):
            print(json.dumps(t, ensure_ascii=False))
        return
    if args.cmd == "export-web":
        import json
        from .serve import export_for_web
        print(json.dumps(export_for_web(args.src, args.out, include=args.include), indent=1))
        return
    if args.cmd == "update-planet":
        import json
        from pathlib import Path
        from .update import update_planet
        r = update_planet(args.param, Path(args.out) / "bundles", start=args.start, force=args.force,
                          progress=lambda i: print(f"\r  {i} blocks", end="", file=sys.stderr))
        print(json.dumps(r, ensure_ascii=False, indent=1))
        return
    progress = lambda i, n: print(f"\r  {i}/{n} cells", end="", file=sys.stderr)
    from hori.api import Config
    from .build import build_power_layer
    cfg = Config(delta_per_decade=args.delta_per_decade)
    bundle, res = build_power_layer(args.bbox, args.param, args.start, args.end, args.out, region=args.region,
                                    offline=args.offline, title_es=args.title_es, title_en=args.title_en, config=cfg,
                                    fetch_params=args.fetch_params, progress=progress, profile="auto")
    print(file=sys.stderr)
    s = res.manifest["summary"]
    print(f"bundle: {bundle}\nverdicts: " + ", ".join(f"{k}={v}" for k, v in s.items()))


if __name__ == "__main__":
    main()
