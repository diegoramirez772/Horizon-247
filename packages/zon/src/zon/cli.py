"""CLI:
    python -m zon build-power --bbox S W N E --param T2M --start 2001 --end 2024 --region durango --out data
    python -m zon update-planet --param T2M --start 1981 --out data       # Z3: new month? recompute + events
    python -m zon export-web --src data/bundles --out apps/web/public/bundles   # Z7: static files + index.json
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
    args = ap.parse_args()
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
