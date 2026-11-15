# ZON — the runtime

ZON is everything around the model: it gets the data, runs HORI, keeps track of where every number came from and
publishes the results.

## What it does

- **Fetches** NASA observations (for example NASA POWER and the NASA Earthdata archives), politely and with a cache, so
  the same request is never made twice.
- **Prepares** them into a common format (a *cube*: a variable over time and space) with full provenance.
- **Runs HORI** on any area: a region, a country, the whole planet, or Mars.
- **Publishes** the results as portable *evidence bundles* (compact files the web reads directly) and as light records in
  the database.
- **Watches places over time** («Mis monitores»): what changed since your last visit, what needs attention and how fresh
  the data is.
- **Receives reports** from people (the swarm) and hands them to HORI as signals — never as proof.

## Main commands

```bash
python -m zon build-power --bbox S W N E --param T2M --start 2001 --end 2024 --region myplace --out data
python -m zon home --place Durango Chihuahua --var T2M PRECTOTCORR --out apps/web/public/bundles
python -m zon export-web --src data/bundles --out apps/web/public/bundles
python -m zon db-push --bundles apps/web/public/bundles      # light records to the database
python -m zon serve                                          # optional API
```

## Principles

- Credentials only in environment variables, never in the repository.
- Every result carries its source, version and a fingerprint of its inputs.
- Only light data goes to the database; large arrays stay in files.
