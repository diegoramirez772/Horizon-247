# HORIZON 247 — database (Supabase / PostgreSQL)

Implements the team's design **"Base de datos y red enjambre v2"** and **"Revisión de arquitectura de datos v2"**:
the 32 target tables plus 3 tables the web needs. Status: **v0.1, tested on a local PostgreSQL 16; not yet load-tested.**

The static demo does **not** depend on this database (decision D13): bundles are still files.

## Migrations (`migrations/`, apply in order)

| File | What it does |
|---|---|
| `…060000_horizon_core.sql` | 35 tables. Every team table has `workspace_id` and composite FKs `(workspace_id, id)`, so rows of two teams can never be linked. CHECKs: one value form per observation, no NaN, no inverted intervals, sha256 format, `ready` artifacts carry hash and size. |
| `…060100_horizon_security.sql` | Immutability triggers (revisions, findings, entity versions, reviews, audit, sealed batches/exports, active monitor versions, ready artifacts), acyclic finding graph, no self-review. RLS on every table: members read their team; writes by role; anon only reads reviewed context cards and inserts feedback / comprehension answers. |
| `…060200_horizon_operations.sql` | Atomic functions: `submit_report_revision` (idempotent key + content hash), `decide_review` (current revision + expected version), `withdraw_report`, `seal_observation_batch`, `seal_export`, `ensure_profile`, `create_workspace`; workers (service_role only): `claim_run_attempt` / `heartbeat_run_attempt` / `finalize_run` (lease + fencing token; findings + events + outbox in one transaction) / `fail_run_attempt`, `claim_outbox` / `settle_outbox` (at-least-once). |
| `…060300_horizon_postgis.sql` | Adds PostGIS geometry + GiST indexes for Earth (EPSG:4326) only. Skipped if PostGIS is missing. **Not tested locally** (no PostGIS here); runs on Supabase. |

Error codes: `HZ403` forbidden · `HZ404` not found · `HZ409` conflict/duplicate · `HZ412` expected version mismatch · `HZ422` invalid · `HZ423` stale attempt (fencing).

## Tables (35)

- Identity (4): profiles, external_identities, workspaces, memberships
- Catalog (4): sources, dataset_versions, variables, entities
- Monitoring and analysis (5): monitors, monitor_variables, analysis_runs, run_inputs, findings
- Artifacts (2): artifacts, run_artifacts
- Swarm (6): producers, reports, report_revisions, observations, report_evidence, reviews
- Publication and audit (3): audit_events, exports, export_items
- Added in v2 (8): entity_versions, monitor_versions, run_attempts, finding_inputs, monitor_events, outbox_messages, observation_batches, report_observations
- Web (3): context_cards, comprehension_responses, feedback

Large arrays (maps, series, windows) stay in files/Storage; `findings` keeps selected results only.

## Test locally

```bash
bash supabase/tests/run_local.sh     # throwaway PostgreSQL 15+, Supabase-like roles; 52 checks
```

## Live project (15-nov)

Project `horizon-247` (ref `lrxumkndviytplegtxna`, us-east-1, free plan): the 4 migrations are applied. ZON fills the
light part and nothing else (≈230 rows, idempotent; a second push inserts nothing):

```bash
SUPABASE_ACCESS_TOKEN=… python -m zon db-push --bundles apps/web/public/bundles     # or --sql out.sql to only write it
```

Per exported trend bundle: source, dataset version, variable, entity, one `analysis_runs` row, the manifest as an
`artifacts` row (path + SHA-256; arrays stay as files) and the grid summary as a finding; cell findings only for
regional boxes (Durango: 72 + 72). From `home.json`: each place, its monitor (version active) and its finding.

The web (publishable key in `apps/web/.env.local` or the host's env vars, see `.env.example`) reads reviewed `context_cards` (merged with
`context.json`, the DB wins) and sends «¿Algo no cuadra?» to `feedback`. RLS keeps findings/monitors team-only.

## Not done yet (from the design's pending list)

Review protocol, initial phenomena/units, public location policy, contribution licences, retention, rate limits
for anonymous inserts, Storage buckets and policies, an API/adapter layer for other backends, ZON writing runs through `finalize_run` (today `db-push` writes finished runs directly),
federation. The web uses only the **publishable** key; the service_role key never goes in the repo or the browser.
