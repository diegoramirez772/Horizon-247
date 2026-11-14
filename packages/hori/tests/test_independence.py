"""HORI must stay extractable: it may not import ZON or web code. Runs with plain Python or pytest."""
import ast, pathlib

SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "hori"
FORBIDDEN = {"zon", "web", "apps"}


def _imports(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                yield a.name.split(".")[0]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            yield node.module.split(".")[0]


def test_hori_does_not_import_zon_or_web():
    bad = []
    for py in SRC.rglob("*.py"):
        for mod in _imports(py):
            if mod in FORBIDDEN:
                bad.append((str(py.relative_to(SRC)), mod))
    assert not bad, f"HORI must not import: {bad}"


if __name__ == "__main__":
    test_hori_does_not_import_zon_or_web()
    print("OK: hori is independent of zon/web")
