# Database

HORIZON 247 uses a small Postgres database (Supabase). The website works without it; the database adds what needs to
be shared between people.

## What is stored

- **Catalog**: sources, dataset versions, variables and places.
- **Analyses**: which analyses ran, with their fingerprint, and a *selection* of their findings. The full maps stay in
  files.
- **Monitors**: the places being watched and their latest reading.
- **Context cards**: short, reviewed texts with their source.
- **The swarm**: reports from people, in a separate public team, with their review status.
- **Feedback** from the website.

## Who can see what

Row-level security decides everything:

- **The public** (the website's publishable key) can read reviewed context cards and send feedback.
- **People with an account** can join the public swarm, send reports and read the swarm's reports — never the
  scientific team's data.
- **The team** reads and reviews according to its role.

Secret keys never leave the server side; the browser only ever has the publishable key.

## Setup

Migrations are in `supabase/migrations/`. ZON fills the light records:

```bash
SUPABASE_ACCESS_TOKEN=… python -m zon db-push --bundles apps/web/public/bundles
```
