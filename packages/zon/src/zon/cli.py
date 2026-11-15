"""CLI:  python -m zon build <layer-id>   (see layers/*.yaml)
        python -m zon list
"""
import argparse


def main() -> None:
    ap = argparse.ArgumentParser(prog="zon")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="capas disponibles")
    b = sub.add_parser("build", help="fetch -> normalize -> HORI -> bundle")
    b.add_argument("layer", nargs="+", help="una o más capas, por ejemplo temp_gistemp_2001-2024")
    b.add_argument("--file", help="usar un archivo que ya descargaste (.nc o .nc.gz) en vez de descargarlo")
    b.add_argument("--data-dir", help="carpeta para descargas y cubos (por defecto <repo>/data, ignorada por git)")
    b.add_argument("--out", help="carpeta bundles/ de la web (por defecto apps/web/public/bundles)")
    b.add_argument("--no-windows", action="store_true", help="sin ventanas crecientes (más rápido)")
    b.add_argument("--simulated-test", action="store_true",
                   help="solo para probar: rotula todo como SIMULADO aunque el archivo tenga forma real")
    args = ap.parse_args()

    from . import build as builder
    if args.cmd == "list":
        for k, p in builder.layer_configs().items():
            print(f"{k:32} {p.name}")
        return
    for layer in args.layer:
        builder.build(layer, args.data_dir, args.out, args.file, args.no_windows, args.simulated_test)
