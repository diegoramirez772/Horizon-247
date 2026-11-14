# HORIZON 247

**Universal Monitoring & Entity Intelligence** — *Identify. Observe. Detect.*

> Status: **private, pre-release.** Built by team **AETHRA** for NASA Space Apps Challenge 2026
> ("Be an Earth System Trend Detective!"). Not open source yet — see `LICENSE`.

HORIZON 247 tells you, with real NASA data, whether a change in the Earth system is **real or noise**:
what is changing, where, by how much, and — when it cannot tell yet — how many more years of data it would need.

## Three layers, one contract

```
ZON (runtime)  ──cube──►  HORI (model)  ──bundle──►  Web
fetch, normalize,          decides: trend tests,       reads the bundle,
store, provenance          FDR, detectability,         draws, explains
                           verdict
```

* **HORI** (`packages/hori`) — non-generative model. Pure, deterministic functions. **Depends on NumPy only. It does not know ZON or the web.**
* **ZON** (`packages/zon`) — runtime: connectors, normalization, storage, provenance, bundle builder. Uses HORI through its public API.
* **Web** (`apps/web`) — static web app. Reads bundles through the contract. It does not know HORI or ZON.
* **Contract** (`contract/`) — the only thing the three share: the **cube** (ZON → HORI) and the **bundle** (HORI → web).

## Layout
```
contract/        language-neutral spec: SPEC.md (bundle), CUBE.md (cube), types.ts
packages/hori/   model (own pyproject, tests, docs, LICENSE) — extractable
packages/zon/    runtime (own pyproject, tests, layer configs)
apps/web/        web app (own README, own toolchain)
sim/             calibration simulations (evidence for the method)
content/ design/ brand/ pitch/   team material (non-code)
docs/            project docs;  data/  raw downloads (git-ignored)
```
See `docs/MODULARITY.md` for how to extract a package.

## Data honesty
Real data and simulated data are always labeled. Every result carries its dataset, version, resolution and parameters.
