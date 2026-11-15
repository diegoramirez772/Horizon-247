# HORIZON 247 — web

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4. **Static export** (no server): the app only reads **bundles** (`../../contract/SPEC.md`). The web never computes a verdict; everything comes from HORI.

## Run

```bash
cd apps/web
npm install
npm run bundle:sim   # simulated bundles (labelled SIMULADO): 24 and 45 years, windows, Durango
npm run dev          # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run bundle:sim` | Writes simulated layers to `public/bundles/` (1° grid). `-- --deg 2` or `-- --deg 0.5` change the grid. Real entries in `index.json` are kept. |
| `npm run check` | Text lint + types + ESLint + tests. Run it before every PR. |
| `npm run build` | Static site in `out/` (also runs the contract sync and the text lint). |
| `npm run test` | Unit tests (`tests/`): colour contrast per theme, CSS ⇄ canvas tokens, forbidden words, contract loader, URL state. |

Useful URLs (the whole state lives in the URL, so a link reopens the exact view):

- `/?l=<layer id>&sel=c:<cell>&reg=experto&lang=en` — a layer, a selected area, Expert register, English.
- `/?sel=r:mx-dgo` — the named region Durango (from `regions.json`).
- `&t=anual&y=2010` — year by year (descriptive, no verdict) · `&t=acumulada&w=1994` — accumulated evidence.

**Note on `index.json`:** it is committed as `[]`. `bundle:sim` adds simulated entries to it locally — do not commit that change; real entries come from ZON/HORI.

## What the app is

A conversational Earth-system monitor (Diego's brief: "como ChatGPT"): one centred conversation; the map and the
evidence open in a side panel that splits the screen (never covers the conversation), can widen or go full screen.

- **Start screen:** the question, the box (text or voice), and a carousel of what HORIZON can do (auto-advances, stops on hover/focus).
- **Assistant (no LLM, SANTUARIO H17):** deterministic ES/EN intent parser (`src/core/assistant`). It changes the view
  (fly to a place, filter verdicts, 24 ↔ 45 years, year by year, accumulated evidence) and answers with the contract's
  sentences; every number comes from the bundle. Limits: no advice, no causes; «No era eso» undoes.
- **Map:** 3D globe (orthographic, drawn per pixel on canvas) or flat map; verdict textures, hover label, filters,
  play-through of years, region outline (`bbox`, additive proposal).
- **Sencillo / Experto:** Sencillo = three plain ideas, sentences, explained evidence. Experto = contract codes, metric
  selector (verdict, effect, MDE, years needed), technical hover + readout line, full evidence table + CSV.

## Layout

```
src/app/              layout.tsx (fonts, theme before paint) · page.tsx · globals.css (tokens, light default + dark)
src/contract/         types.ts — AUTO-SYNCED from /contract/types.ts (npm run contract:sync). Do not edit.
src/core/contract/    loader.ts (index, manifest, arrays, windows, regions + bbox, context) · extra.ts
src/core/assistant/   patterns.ts (input words) · parse.ts (intents) · compose.ts (answer cards) · run.ts · conversation.ts
src/core/map/         GlobeView.ts (3D) · MapView.ts (flat) · palette.ts (data colours, tested) · textures.ts · world.ts
src/core/i18n/        texts.ts (verdict sentences verbatim from SPEC §5 and §8.5)
src/core/format/      numbers, template values, trend line
src/core/state/       store.ts (single state ⇄ URL)
src/components/       HorizonApp (layout) · Chat (start screen, conversation, composer) · MapPanel · MapCanvas ·
                      Legend · Evidence · SeriesChart · ui (Segmented, Tabs, Mark, Emblem, Logo) · hooks · useBundles · useSpeech
scripts/              make-sim-bundle.mjs · lint-texts.mjs · sync-contract.mjs
tests/                vitest: palette/contrast, texts, contract + URL state, assistant golden questions (40+)
```

## Rules (SANTUARIO, doc 03 and doc 04 of the UX package)

- Neutral interface (black/white accent); **colour only for data**, one scale per theme with ≥ 3:1 against ocean and land (tested).
- Texture = verdict, colour = sign and magnitude, **never colour alone**; the legend always carries the sentence.
- Never «no hay cambio» without δ; never «prueba», «causa», «predice», advice or medical language (`npm run lint:texts`).
- Simulated data is always labelled: a «Datos simulados» tag on every data answer and on the map title, plus a note under the box (the full-width strip was removed at William's request; Diego to confirm, criterion A7).
- No CDN or external font at run time: Geist is self-hosted (`geist` package, SIL OFL 1.1); the land outline is bundled (`world-atlas`, Natural Earth, public domain).
- Sencillo / Experto change the text and how much is shown; **numbers, verdict, texture and place never change**.

## Pending (see the development plan)

S3 Contraste as its own view, S6 Evidencia page, accessible list of areas, Mars and Person profiles, real bundles.
Asked from Diego (additive): `variable.color_more`, `variable.short_label`, `delta.f32`, `regions[].bbox` — the web already
reads them when present.
