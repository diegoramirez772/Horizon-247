# Contributing to HORIZON 247

Thanks for wanting to help. HORIZON 247 is open source under the **Apache License 2.0** (see [LICENSE](LICENSE)).
Contributions to the official repository are credited and licensed under the same terms (Apache-2.0 §5).

## Ways to help

- **Report a problem** — open an issue with what you did, what you expected and what happened
  (screenshot or the URL of the view: the web keeps its state in the address).
- **Check the science** — open an issue with the place, variable and years, and what you expected.
  Disagreements with evidence are the most valuable issues.
- **Code** — pick an issue labelled `good first issue` or propose one before a large change.
- **Translations and plain-language texts** — every sentence the app shows exists in Spanish and
  English, in three reading levels.

## How to submit a change

1. Fork the official repository.
2. Create a branch: `tu-nombre/lo-que-cambia`.
3. Make the change with its tests, then run the checks below.
4. Commit with sign-off (Developer Certificate of Origin): `git commit -s -m "…"`.
   By signing off you confirm you have the right to contribute it under the Apache License 2.0.
5. Open a pull request against `main` explaining *what* and *why*. A team member reviews it.

## Checks before a pull request

```bash
# Python (HORI + ZON)
python -m pip install -e './packages/hori[dev]' -e './packages/zon[dev]'
python packages/hori/tests/test_independence.py
python -m pytest packages/hori/tests packages/zon/tests -q

# Web
cd apps/web && npm ci
npm run lint:texts      # forbidden words / tone of the public texts
npx tsc --noEmit        # types
npx vitest run          # tests
```

CI runs the same checks on every pull request.

## Rules that are not negotiable

- **Honesty of data.** Real, estimated, simulated and example values are always labelled as such.
  Nothing generated (3D scenes, simulated vitals) is presented as observed.
- **No advice, no alarms.** HORIZON reports evidence of change; it does not tell people what to do.
- **No secrets in the repo.** Tokens and keys go in environment variables (`.env.local`), never in code.
  Only the Supabase *publishable* key may appear in the web, and the database's RLS decides what it can do.
- **HORI stays independent.** `packages/hori` depends only on NumPy and never imports ZON or the web
  (`test_independence.py` enforces it). The data contract in `contract/` changes only additively.
- **Licences of dependencies:** prefer MIT, BSD or Apache-2.0; add each new one to [NOTICE](NOTICE).
- **Privacy.** Reports from people keep coordinates rounded to ~1 km and never a name or phone.

## Team workflow (AETHRA)

| Area | Folders |
|---|---|
| HORI — the model | `packages/hori`, `contract` |
| ZON — the runtime and the database | `packages/zon`, `supabase` |
| Web | `apps/web` |

One branch per person, merged to `main` through a reviewed pull request.
