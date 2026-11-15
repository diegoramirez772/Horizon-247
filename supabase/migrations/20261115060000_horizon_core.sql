-- HORIZON 247 · base de datos v0.1 (implementa el diseño "Base de datos y red enjambre v2"
-- y la "Revisión de arquitectura de datos v2", más 3 tablas que pide la web).
-- PostgreSQL 15+ (Supabase). Sin PostGIS aquí: la geometría va como GeoJSON + CRS y
-- la migración 0300 agrega columnas PostGIS si la extensión existe.
--
-- Reglas que este archivo hace cumplir:
--  * Toda fila privada tiene workspace_id y las FKs entre tablas de equipo son compuestas
--    (workspace_id, id): no se pueden unir filas de equipos distintos.
--  * Lo usado por un análisis o enviado a revisión es inmutable (triggers en 0200).
--  * Una sola forma de valor por observación, intervalos no invertidos, sin NaN.
--  * Los arreglos masivos (mapas, series) NO van en tablas: van en artifacts.

create extension if not exists pgcrypto;

-- ============ Identidad y equipos (4) ============

create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null check (length(display_name) between 1 and 120),
  status        text not null default 'active' check (status in ('active','disabled','anonymized')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.profiles is 'Identidad interna. Sin contraseñas ni credenciales; independiente del proveedor de Auth.';

create table public.external_identities (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete restrict,
  issuer      text not null,          -- p. ej. 'supabase'
  subject     text not null,          -- p. ej. auth.users.id
  verified_at timestamptz not null default now(),
  unique (issuer, subject)
);

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 120),
  status     text not null default 'active' check (status in ('active','archived')),
  -- Recibe comentarios y respuestas anónimas de la web pública (propuestas 1 y 3 de William).
  accepts_public_input boolean not null default false,
  settings   jsonb not null default '{}'::jsonb check (pg_column_size(settings) <= 8192),
  created_at timestamptz not null default now()
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  profile_id   uuid not null references public.profiles(id) on delete restrict,
  role         text not null check (role in ('owner','admin','reviewer','contributor','viewer')),
  status       text not null default 'active' check (status in ('active','invited','removed')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);

-- ============ Catálogo científico (4) ============

create table public.sources (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  provider     text not null,
  url          text,
  kind         text not null check (kind in ('official','community','simulated')),
  attribution  text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.dataset_versions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  source_id        uuid not null,
  version          text not null,
  kind             text not null check (kind in ('observation','analysis','reanalysis','reconstruction','simulated','community')),
  time_start       timestamptz,
  time_end         timestamptz,
  spatial_coverage jsonb,
  licence          text not null,
  manifest_sha256  text check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  provenance       jsonb not null default '{}'::jsonb,
  published_at     timestamptz,           -- fecha de publicación/versión de la fuente, si existe
  downloaded_at    timestamptz,
  sealed_at        timestamptz,           -- sellada = inmutable (usada por análisis o exportación)
  created_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, source_id, version),
  foreign key (workspace_id, source_id) references public.sources(workspace_id, id),
  check (time_end is null or time_start is null or time_end >= time_start)
);

create table public.variables (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete restrict,
  key            text not null check (key ~ '^[a-z0-9_.-]{1,64}$'),
  value_type     text not null check (value_type in ('numeric','text','boolean','category')),
  canonical_unit text,
  rules          jsonb not null default '{}'::jsonb,
  rules_version  int not null default 1 check (rules_version >= 1),
  created_at     timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, key),
  check (value_type <> 'numeric' or canonical_unit is not null)
);

create table public.entities (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete restrict,
  external_key    text,                  -- p. ej. 'mx-dgo'; NO es la PK interna
  kind            text not null,         -- region_cell, region, person_sim, ...
  reference_name  text not null,
  current_version int,
  created_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, external_key)
);

-- ============ Versiones de entidad y monitor (v2) ============

create table public.entity_versions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  entity_id       uuid not null,
  number          int not null check (number >= 1),
  body            text not null check (body in ('earth','mars','other')),
  crs             text not null,                       -- 'EPSG:4326', 'IAU:49900', ...
  geometry        jsonb,                               -- GeoJSON en ese CRS
  nature          text not null check (nature in ('real','simulated','declared')),
  relations       jsonb not null default '[]'::jsonb,
  provenance      jsonb not null default '{}'::jsonb,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (entity_id, number),
  foreign key (workspace_id, entity_id) references public.entities(workspace_id, id)
);

create table public.monitors (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete restrict,
  owner_profile_id uuid not null references public.profiles(id),
  name             text not null,
  status           text not null default 'active' check (status in ('active','paused','archived')),
  current_version  int,
  created_at       timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.monitor_versions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null,
  monitor_id        uuid not null,
  number            int not null check (number >= 1),
  entity_version_id uuid not null,
  sources           jsonb not null default '[]'::jsonb,
  config            jsonb not null,
  schedule          jsonb,
  author_profile_id uuid not null references public.profiles(id),
  config_sha256     text not null check (config_sha256 ~ '^[0-9a-f]{64}$'),
  status            text not null default 'draft' check (status in ('draft','active','retired')),
  activated_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (workspace_id, id),
  unique (monitor_id, number),
  foreign key (workspace_id, monitor_id) references public.monitors(workspace_id, id),
  foreign key (workspace_id, entity_version_id) references public.entity_versions(workspace_id, id)
);

create table public.monitor_variables (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  monitor_version_id uuid not null,
  variable_id        uuid not null,
  threshold          double precision check (threshold is null or threshold <> 'NaN'),
  unit               text,
  rules              jsonb not null default '{}'::jsonb,
  unique (workspace_id, id),
  unique (monitor_version_id, variable_id),
  foreign key (workspace_id, monitor_version_id) references public.monitor_versions(workspace_id, id),
  foreign key (workspace_id, variable_id) references public.variables(workspace_id, id)
);

-- ============ Artefactos (2) ============

create table public.artifacts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  backend      text not null default 'supabase-storage',
  bucket       text not null,
  object_key   text not null,
  sha256       text check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes        bigint check (bytes is null or bytes >= 0),
  mime         text,
  format       text,
  licence      text,
  status       text not null default 'pending' check (status in ('pending','ready','quarantined','deleted')),
  created_at   timestamptz not null default now(),
  ready_at     timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, backend, bucket, object_key),
  check (status <> 'ready' or (sha256 is not null and bytes is not null and ready_at is not null))
);
comment on table public.artifacts is 'Índice de objetos (bundles, cubos, fotos). Sin URLs firmadas persistentes; un objeto ready no se sobrescribe.';

-- ============ Monitoreo y análisis (5) ============

create table public.analysis_runs (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete restrict,
  monitor_version_id    uuid,
  adhoc_snapshot        jsonb,
  run_kind              text not null check (run_kind in ('layer','grid','regional','timeline','multisource')),
  mode                  text not null default 'operational' check (mode in ('operational','replay_current_dataset','replay_historical_archive')),
  status                text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled')),
  idempotency_key       text not null,
  config                jsonb not null,               -- Config COMPLETA de HORI, no solo manifest.params
  profile_spec          jsonb,
  windows               jsonb,
  code_versions         jsonb not null,               -- hori, zon, python, numpy, hash de código
  scientific_fingerprint text not null check (scientific_fingerprint ~ '^[0-9a-f]{64}$'),
  fdr_family            text not null,                -- 'grid:<capa>' o 'regions:<lista>'
  current_attempt       int not null default 0,
  created_at            timestamptz not null default now(),
  finished_at           timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, monitor_version_id) references public.monitor_versions(workspace_id, id),
  check ((monitor_version_id is null) <> (adhoc_snapshot is null))
);

create table public.run_attempts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  run_id         uuid not null,
  number         int not null check (number >= 1),
  worker         text not null,
  fencing_token  bigint not null,
  lease_until    timestamptz not null,
  heartbeat_at   timestamptz not null default now(),
  status         text not null default 'running' check (status in ('running','succeeded','failed','expired','superseded')),
  error          text,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  unique (workspace_id, id),
  unique (run_id, number),
  foreign key (workspace_id, run_id) references public.analysis_runs(workspace_id, id)
);
create sequence public.fencing_token_seq;

create table public.run_inputs (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  run_id             uuid not null,
  dataset_version_id uuid,
  artifact_id        uuid,
  variable_id        uuid,
  role               text not null,
  unique (workspace_id, id),
  foreign key (workspace_id, run_id) references public.analysis_runs(workspace_id, id),
  foreign key (workspace_id, dataset_version_id) references public.dataset_versions(workspace_id, id),
  foreign key (workspace_id, artifact_id) references public.artifacts(workspace_id, id),
  foreign key (workspace_id, variable_id) references public.variables(workspace_id, id),
  check (dataset_version_id is not null or artifact_id is not null)
);

create table public.run_artifacts (
  workspace_id uuid not null,
  run_id       uuid not null,
  artifact_id  uuid not null,
  role         text not null,     -- manifest, array, series, window, build_info, cube
  rel_path     text not null,
  primary key (run_id, role, rel_path),
  foreign key (workspace_id, run_id) references public.analysis_runs(workspace_id, id),
  foreign key (workspace_id, artifact_id) references public.artifacts(workspace_id, id)
);

create table public.findings (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  run_id              uuid not null,
  finding_kind        text not null check (finding_kind in ('atomic','derived')),
  variable_id         uuid,
  scope               text not null check (scope in ('cell','region','grid','entity')),
  scope_ref           text not null,          -- índice de celda, id de región, ...
  window_start        int,
  window_end          int,
  fdr_family          text not null,
  rule                text not null,          -- p. ej. 'consenso-3-bh-q0.10'
  effect              double precision check (effect is null or effect <> 'NaN'),
  ci_lo               double precision check (ci_lo is null or ci_lo <> 'NaN'),
  ci_hi               double precision check (ci_hi is null or ci_hi <> 'NaN'),
  unit                text,
  verdict             smallint check (verdict between 0 and 4),   -- null si el tipo no es de tendencia
  mde                 double precision check (mde is null or mde <> 'NaN'),
  delta               double precision check (delta is null or delta <> 'NaN'),
  p_cons              double precision check (p_cons is null or (p_cons >= 0 and p_cons <= 1)),
  q_value             double precision check (q_value is null or (q_value >= 0 and q_value <= 1)),
  flags               int not null default 0 check (flags >= 0),
  locator             jsonb,                  -- dónde está en el bundle (archivo + índice)
  diagnostics         jsonb check (diagnostics is null or pg_column_size(diagnostics) <= 16384),
  diagnostics_version int,
  created_at          timestamptz not null default now(),
  unique (workspace_id, id),
  unique nulls not distinct (run_id, scope, scope_ref, variable_id, window_start, window_end, rule),
  foreign key (workspace_id, run_id) references public.analysis_runs(workspace_id, id),
  foreign key (workspace_id, variable_id) references public.variables(workspace_id, id),
  check (ci_lo is null or ci_hi is null or ci_lo <= ci_hi),
  check (window_end is null or window_start is null or window_end >= window_start)
);

create table public.finding_inputs (
  workspace_id      uuid not null,
  derived_id        uuid not null,
  input_id          uuid not null,
  role              text not null,
  rule              text,
  dependency        jsonb,          -- p. ej. fuentes que comparten observaciones
  primary key (derived_id, input_id, role),
  foreign key (workspace_id, derived_id) references public.findings(workspace_id, id),
  foreign key (workspace_id, input_id) references public.findings(workspace_id, id),
  check (derived_id <> input_id)
);

create table public.monitor_events (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null,
  monitor_id       uuid not null,
  seq              bigint not null check (seq >= 1),
  event_kind       text not null check (event_kind in ('scientific','operational')),
  transition       text not null,     -- NUEVO, SE_DEBILITO, CRUZO, CAMBIO_SIGNO, EMERGENCIA, FALLO, CAMBIO_METODO...
  transition_key   text not null,     -- evita duplicados al reintentar
  prev_run_id      uuid,
  run_id           uuid,
  prev_finding_id  uuid,
  finding_id       uuid,
  scope            text,
  priority         smallint not null default 0,
  rule             text,
  reason           text,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (monitor_id, seq),
  unique (monitor_id, transition_key),
  foreign key (workspace_id, monitor_id) references public.monitors(workspace_id, id),
  foreign key (workspace_id, run_id) references public.analysis_runs(workspace_id, id),
  foreign key (workspace_id, prev_run_id) references public.analysis_runs(workspace_id, id),
  foreign key (workspace_id, finding_id) references public.findings(workspace_id, id),
  foreign key (workspace_id, prev_finding_id) references public.findings(workspace_id, id)
);
comment on table public.monitor_events is 'Cambio de evidencia, no alerta de peligro (SANTUARIO). Los fallos técnicos son operational.';

create table public.outbox_messages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null,
  event_id        uuid not null,
  destination     text not null,
  delivery_key    text not null,     -- el destinatario deduplica por esta clave (entrega al menos una vez)
  payload         jsonb not null check (pg_column_size(payload) <= 65536),
  payload_version int not null default 1,
  status          text not null default 'pending' check (status in ('pending','in_flight','delivered','dead_letter')),
  attempts        int not null default 0 check (attempts >= 0),
  max_attempts    int not null default 10,
  next_attempt_at timestamptz not null default now(),
  lease_until     timestamptz,
  last_error      text,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (workspace_id, id),
  unique (event_id, destination),
  unique (delivery_key),
  foreign key (workspace_id, event_id) references public.monitor_events(workspace_id, id)
);

-- ============ Red enjambre (6 + 2 de v2) ============

create table public.producers (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces(id) on delete restrict,
  kind                   text not null check (kind in ('person','sensor','system')),
  responsible_profile_id uuid not null references public.profiles(id),
  source_id              uuid,
  model                  text,
  calibration            jsonb,
  credential_ref         text,     -- referencia a un secreto externo; NUNCA el secreto
  status                 text not null default 'active' check (status in ('active','revoked')),
  created_at             timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, source_id) references public.sources(workspace_id, id)
);

create table public.observation_batches (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  producer_id        uuid not null,
  dataset_version_id uuid,
  idempotency_key    text not null,
  content_sha256     text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  coverage           jsonb,
  schema_info        jsonb not null default '{}'::jsonb,   -- esquema, unidades, calibración
  bulk_artifact_id   uuid,
  status             text not null default 'open' check (status in ('open','sealed')),
  received_at        timestamptz not null default now(),
  sealed_at          timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, producer_id, idempotency_key),
  foreign key (workspace_id, producer_id) references public.producers(workspace_id, id),
  foreign key (workspace_id, dataset_version_id) references public.dataset_versions(workspace_id, id),
  foreign key (workspace_id, bulk_artifact_id) references public.artifacts(workspace_id, id),
  check (status <> 'sealed' or (content_sha256 is not null and sealed_at is not null))
);

create table public.observations (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null,
  batch_id             uuid not null,
  producer_id          uuid not null,
  variable_id          uuid not null,
  value_numeric        double precision check (value_numeric is null or value_numeric not in ('NaN','Infinity','-Infinity')),
  value_text           text,
  value_bool           boolean,
  missing_reason       text,
  unit_original        text,
  unit_canonical       text,
  uncertainty          jsonb,
  observed_start       timestamptz not null,
  observed_end         timestamptz,
  location             jsonb,            -- GeoJSON Point
  crs                  text,
  location_precision_m double precision check (location_precision_m is null or location_precision_m >= 0),
  method               text,
  calibration          jsonb,
  external_key         text,
  supersedes_id        uuid,
  received_at          timestamptz not null default now(),
  processed_at         timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, producer_id, external_key),
  foreign key (workspace_id, batch_id) references public.observation_batches(workspace_id, id),
  foreign key (workspace_id, producer_id) references public.producers(workspace_id, id),
  foreign key (workspace_id, variable_id) references public.variables(workspace_id, id),
  foreign key (workspace_id, supersedes_id) references public.observations(workspace_id, id),
  -- exactamente una forma de valor, o ninguna con motivo de faltante
  check ((value_numeric is not null)::int + (value_text is not null)::int + (value_bool is not null)::int
         = case when missing_reason is null then 1 else 0 end),
  check (observed_end is null or observed_end >= observed_start),
  check (location is null or crs is not null)
);

create table public.reports (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  producer_id         uuid not null,
  author_profile_id   uuid not null references public.profiles(id),
  entity_id           uuid,
  editorial_status    text not null default 'draft'
                        check (editorial_status in ('draft','submitted','under_review','accepted','rejected','withdrawn','superseded')),
  current_revision_id uuid,
  idempotency_key     text not null,
  duplicate_of        uuid,
  row_version         int not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, producer_id, idempotency_key),
  foreign key (workspace_id, producer_id) references public.producers(workspace_id, id),
  foreign key (workspace_id, entity_id) references public.entities(workspace_id, id),
  foreign key (workspace_id, duplicate_of) references public.reports(workspace_id, id),
  check (duplicate_of is null or duplicate_of <> id)
);

create table public.report_revisions (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null,
  report_id            uuid not null,
  number               int not null check (number >= 1),
  author_profile_id    uuid not null references public.profiles(id),
  description          text not null check (length(description) <= 10000),
  phenomenon           text,
  location             jsonb,
  crs                  text,
  location_precision_m double precision check (location_precision_m is null or location_precision_m >= 0),
  observed_start       timestamptz,
  observed_end         timestamptz,
  licence              text not null,
  consent              jsonb not null,
  change_reason        text,
  content_sha256       text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at           timestamptz not null default now(),
  unique (workspace_id, id),
  unique (report_id, id),
  unique (report_id, number),
  foreign key (workspace_id, report_id) references public.reports(workspace_id, id),
  check (observed_end is null or observed_start is null or observed_end >= observed_start),
  check (location is null or crs is not null)
);

-- La revisión actual pertenece a SU reporte (FK compuesta con el id del reporte).
alter table public.reports
  add constraint reports_current_revision_fk
  foreign key (id, current_revision_id) references public.report_revisions(report_id, id)
  deferrable initially deferred;

create table public.report_evidence (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  revision_id  uuid not null,
  artifact_id  uuid not null,
  role         text not null,
  attribution  text,
  unique (revision_id, artifact_id, role),
  foreign key (workspace_id, revision_id) references public.report_revisions(workspace_id, id),
  foreign key (workspace_id, artifact_id) references public.artifacts(workspace_id, id)
);

create table public.report_observations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  revision_id    uuid not null,
  observation_id uuid,
  batch_id       uuid,
  locator        jsonb,            -- rango dentro de un lote masivo (versión de archivo + rango)
  role           text not null,
  foreign key (workspace_id, revision_id) references public.report_revisions(workspace_id, id),
  foreign key (workspace_id, observation_id) references public.observations(workspace_id, id),
  foreign key (workspace_id, batch_id) references public.observation_batches(workspace_id, id),
  check ((observation_id is not null) <> (batch_id is not null))
);

create table public.reviews (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null,
  revision_id         uuid not null,
  reviewer_profile_id uuid references public.profiles(id),
  reviewer_process    text,
  process_version     text,
  decision            text not null check (decision in ('accept','reject','needs_changes')),
  protocol            text not null,       -- protocolo de revisión identificado
  criteria            jsonb not null default '{}'::jsonb,
  checks              jsonb not null default '{}'::jsonb,
  reason              text,
  created_at          timestamptz not null default now(),
  foreign key (workspace_id, revision_id) references public.report_revisions(workspace_id, id),
  check ((reviewer_profile_id is not null) <> (reviewer_process is not null)),
  check (reviewer_process is null or process_version is not null)
);

-- ============ Publicación y auditoría (3) ============

create table public.audit_events (
  id              bigint generated always as identity primary key,
  workspace_id    uuid references public.workspaces(id),
  actor_profile_id uuid references public.profiles(id),
  action          text not null,
  object_type     text not null,
  object_id       text,
  correlation_id  text,
  summary         jsonb check (summary is null or pg_column_size(summary) <= 8192),
  at              timestamptz not null default now()
);

create table public.exports (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete restrict,
  destination          text not null,
  format               text not null,
  format_version       text not null,
  licence              text not null,
  manifest_artifact_id uuid,
  status               text not null default 'draft'
                         check (status in ('draft','sealed','sent','accepted_by_third_party','failed','withdrawn')),
  created_at           timestamptz not null default now(),
  sealed_at            timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, manifest_artifact_id) references public.artifacts(workspace_id, id),
  check (status = 'draft' or sealed_at is not null)
);

create table public.export_items (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null,
  export_id          uuid not null,
  member_kind        text not null check (member_kind in ('report_revision','observation','observation_batch')),
  report_revision_id uuid,
  observation_id     uuid,
  batch_id           uuid,
  origin_id          text not null,      -- id de instalación + id de objeto
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  foreign key (workspace_id, export_id) references public.exports(workspace_id, id),
  foreign key (workspace_id, report_revision_id) references public.report_revisions(workspace_id, id),
  foreign key (workspace_id, observation_id) references public.observations(workspace_id, id),
  foreign key (workspace_id, batch_id) references public.observation_batches(workspace_id, id),
  check (case member_kind
           when 'report_revision'   then report_revision_id is not null and observation_id is null and batch_id is null
           when 'observation'       then observation_id is not null and report_revision_id is null and batch_id is null
           when 'observation_batch' then batch_id is not null and report_revision_id is null and observation_id is null
         end)
);

-- ============ Web pública (propuestas de William aprobadas por Diego) ============

-- Propuesta 2: fichas de contexto de Carolina (contract SPEC 8.4). Se publican solo revisadas y con fuente.
create table public.context_cards (
  id           text not null,                 -- 'ctx-001'
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  region       text not null,                 -- 'mx-dgo'
  level        text not null check (level in ('OBSERVACION','ASOCIACION','RIESGO_POTENCIAL','ACCION')),
  text_es      text not null check (length(text_es) <= 2000),
  text_en      text not null check (length(text_en) <= 2000),
  source_title text,
  source_url   text check (source_url is null or source_url ~ '^https?://'),
  source_year  int check (source_year is null or source_year between 1800 and 2100),
  status       text not null default 'borrador' check (status in ('borrador','revisado')),
  owner        text,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, id),
  -- ACCION está desactivado (SANTUARIO); una ficha revisada necesita fuente.
  check (status = 'borrador' or (level <> 'ACCION' and source_title is not null and source_url is not null and source_year is not null))
);

-- Propuesta 1: respuestas de la prueba de comprensión (B2/B3). Anónimas, sin datos personales.
create table public.comprehension_responses (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  test_id      text not null check (length(test_id) <= 64),
  question_id  text not null check (length(question_id) <= 64),
  answer       jsonb not null check (pg_column_size(answer) <= 2048),
  register     text check (register in ('sencillo','experto','tecnico')),
  lang         text check (lang in ('es','en')),
  session_hash text check (session_hash is null or session_hash ~ '^[0-9a-f]{16,64}$'),
  created_at   timestamptz not null default now()
);

-- Propuesta 3: comentarios y "reportar un error" desde la web. Anónimos y solo de escritura.
create table public.feedback (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  kind         text not null check (kind in ('error','comentario')),
  message      text not null check (length(message) between 1 and 2000),
  page_state   text check (length(page_state) <= 1000),   -- URL de la vista (la web guarda su estado en la URL)
  layer_id     text check (length(layer_id) <= 128),
  lang         text check (lang in ('es','en')),
  created_at   timestamptz not null default now()
);
-- Propuesta 4 (capas y resultados de HORI) = analysis_runs + findings + artifacts de arriba.
-- Propuesta 5 (otra cosa) = sin tabla hasta que haya un caso concreto.

-- ============ Índices según las consultas prioritarias ============
create index on public.memberships (profile_id) where status = 'active';
create index on public.monitors (workspace_id, status, created_at, id);
create index on public.analysis_runs (workspace_id, status, created_at, id);
create index on public.analysis_runs (scientific_fingerprint);
create index on public.run_attempts (run_id, status);
create index on public.findings (workspace_id, run_id);
create index on public.findings (workspace_id, scope, scope_ref);
create index on public.monitor_events (workspace_id, monitor_id, seq);
create index on public.outbox_messages (status, next_attempt_at) where status in ('pending','in_flight');
create index on public.observations (workspace_id, variable_id, observed_start, id);
create index on public.observations (batch_id);
create index on public.reports (workspace_id, editorial_status, updated_at, id);
create index on public.reports (workspace_id, editorial_status) where editorial_status in ('submitted','under_review');
create index on public.report_revisions (report_id, number);
create index on public.reviews (revision_id);
create index on public.audit_events (workspace_id, at);
create index on public.context_cards (region) where status = 'revisado';
