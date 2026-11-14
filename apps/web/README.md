# HORIZON 247 — web

Next.js (App Router) · React · TypeScript · Tailwind CSS. **Static export** (no server): the app reads **bundles** only.

## Run
```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```
**First install (William):** `npm install` creates `package-lock.json` — **commit it** to freeze versions (it could not be generated when the project was scaffolded). The build output goes to `out/` (`next build`); `npm start` is not used with a static export.

`npm run contract:sync` copies `/contract/types.ts` into `src/contract/types.ts` (runs automatically before `dev` and `build`). **Do not edit that file by hand.**

## Rules (also in `/SANTUARIO` of the knowledge base)
* Reads bundles as described in `../../contract/SPEC.md`; types in `src/contract/types.ts`.
* Draws the map on a `<canvas>` (equirectangular; no tiles).
* Spanish and English; technical and plain-language registers (`SPEC.md` sections 5 and 8.5). **Do not invent verdict texts.**
* Never write "no change" without showing delta; never "proof", "cause" or "predicts"; no advice to anyone.
* Simulated data is always labeled. No secrets. No imports of Python code.
* *Compare / Impact / Understand* are internal names: they do not appear in the UI.

## Bundles
Put bundles in `public/bundles/` (`index.json` lists them). Only `index.json` and `.gitkeep` are committed by default (see root `.gitignore`).

## Next.js version note
This project uses a recent Next.js with changes from older versions. Read the docs shipped in `node_modules/next/dist/docs/` before relying on memory (`AGENTS.md`).
