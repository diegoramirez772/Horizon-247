# Getting started

## The web (2 minutes)

```bash
cd apps/web
npm install
npm run dev        # open http://localhost:3000
```

Real results for the planet, Durango and Mars are already included. To connect the database, copy
`apps/web/.env.example` to `apps/web/.env.local` and fill in the public values.

## The model and the runtime (Python 3.10+)

```bash
python -m venv .venv && source .venv/bin/activate
python -m pip install -e './packages/hori[dev]' -e './packages/zon[dev]'
python -m pytest packages/hori/tests packages/zon/tests -q
```

Analyse a region with NASA POWER (no account needed) and send it to the web:

```bash
python -m zon build-power --bbox 22.5 -107 26.5 -102.5 --param T2M --start 2001 --end 2024 --region durango --out data
python -m zon export-web --src data/bundles --out apps/web/public/bundles
```

## Checks before contributing

```bash
cd apps/web
npm run lint:texts && npx tsc --noEmit && npx vitest run
```

See [CONTRIBUTING.md](../CONTRIBUTING.md).
