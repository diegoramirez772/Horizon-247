# Modularity rules

Goal: be able to take **HORI** (the model) out of this repo, or publish/keep private any piece, without breaking the rest.

1. **HORI imports nothing from ZON or the web.** It depends on NumPy only. A test enforces it
   (`packages/hori/tests/test_independence.py`).
2. **ZON uses HORI only through `hori.api`** (public, stable). No deep imports.
3. **The web only reads bundles** described by `contract/`. It never imports Python code.
4. **The contract is the only shared thing** and changes only additively.
5. **Each package has its own** `pyproject.toml` / toolchain, `README`, `LICENSE`, tests and docs,
   so it can live on its own.
6. **Nothing private goes in the public history.** If something may need to stay private, keep it outside
   this repo (or in a separate private repo) from the start: public git history cannot be recalled.

## Extracting a package (keeps its history)
```
make extract PKG=hori        # creates branch export/hori
git clone . ../hori-standalone -b export/hori
```
Each package's `LICENSE` can then be changed independently.
