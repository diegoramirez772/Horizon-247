"""CLI:
    python -m zon build-power --bbox S W N E --param T2M --start 2001 --end 2024 --region durango --out data
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
    args = ap.parse_args()
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
