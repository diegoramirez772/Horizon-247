# HORIZON 247 — web

Static web app. **Stack is the owner's choice** (William). Hard requirements:
* Reads **bundles** only, as described in `../../contract/SPEC.md` (types in `../../contract/types.ts`).
* Draws the map on a `<canvas>` (equirectangular; no tiles).
* Spanish and English; technical and plain-language registers (`contract/SPEC.md` sections 5 and 8.5).
* Never writes "no change" without showing delta; never "proof", "cause" or "predicts"; no advice.
* Simulated data is always labeled.
* No secrets; no imports of Python code.

Bundles go in `public/bundles/` (see `.gitignore`: only `index.json` and `.gitkeep` are committed by default).
