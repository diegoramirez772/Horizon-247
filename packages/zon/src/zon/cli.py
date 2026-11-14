"""CLI:  python -m zon build <layer-id>   (see layers/*.yaml)"""
import argparse


def main() -> None:
    ap = argparse.ArgumentParser(prog="zon")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="fetch -> normalize -> HORI -> bundle")
    b.add_argument("layer")
    args = ap.parse_args()
    raise NotImplementedError(f"build {args.layer}")
