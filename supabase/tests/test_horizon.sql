-- Pruebas de los criterios del diseño v2 (sección 7) y de las reglas de la web.
-- Corren como postgres (semilla) y cambian de rol para probar RLS como lo haría Supabase.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema test;
grant usage on schema test to anon, authenticated, service_role;
create table test.results (n serial, name text, ok boolean);
grant insert, select on test.results to anon, authenticated, service_role;
grant usage on sequence test.results_n_seq to anon, authenticated, service_role;

create function test.ok(cond boolean, name text) returns void language plpgsql as $$
begin
  insert into test.results(name, ok) values (name, coalesce(cond, false));
  if not coalesce(cond, false) then raise exception 'FALLÓ: %', name; end if;
  raise notice 'ok  %', name;
end $$;
-- Ejecuta sql y exige que falle con ese SQLSTATE.
create function test.fails(sql text, code text, name text) returns void language plpgsql as $$
begin
  execute sql;
  perform test.ok(false, name || ' (no falló)');
exception when others then
  if sqlstate = code then perform test.ok(true, name);
  else raise exception 'FALLÓ: % → esperaba %, salió % (%)', name, code, sqlstate, sqlerrm; end if;
end $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- ---------------- Semilla (como postgres) ----------------
insert into public.profiles (id, display_name) values
 ('00000000-0000-0000-0000-0000000000a1', 'Ana (equipo A, contributor)'),
 ('00000000-0000-0000-0000-0000000000a2', 'Raúl (equipo A, reviewer)'),
 ('00000000-0000-0000-0000-0000000000a3', 'Olga (equipo A, owner)'),
 ('00000000-0000-0000-0000-0000000000b1', 'Beto (equipo B, owner)');
insert into public.external_identities (profile_id, issuer, subject)
select id, 'supabase', ('10000000-0000-0000-0000-' || right(id::text, 12))::text from public.profiles;
insert into public.workspaces (id, name, accepts_public_input) values
 ('00000000-0000-0000-0000-00000000000a', 'Equipo A', true),
 ('00000000-0000-0000-0000-00000000000b', 'Equipo B', false);
insert into public.memberships values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'contributor', 'active', now()),
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'reviewer', 'active', now()),
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'owner', 'active', now()),
 ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'owner', 'active', now());
insert into public.sources (id, workspace_id, provider, kind) values
 ('00000000-0000-0000-0000-0000000005a0', '00000000-0000-0000-0000-00000000000a', 'NASA GISS', 'official'),
 ('00000000-0000-0000-0000-0000000005b0', '00000000-0000-0000-0000-00000000000b', 'privado de B', 'community');
insert into public.variables (id, workspace_id, key, value_type, canonical_unit) values
 ('00000000-0000-0000-0000-0000000007a0', '00000000-0000-0000-0000-00000000000a', 'tempanomaly', 'numeric', '°C');
insert into public.analysis_runs (id, workspace_id, adhoc_snapshot, run_kind, idempotency_key, config, code_versions, scientific_fingerprint, fdr_family) values
 ('00000000-0000-0000-0000-0000000009a1', '00000000-0000-0000-0000-00000000000a', '{"layer":"temp"}', 'layer', 'run-1', '{"alpha":0.05}', '{"hori":"0.1.0"}', repeat('a', 64), 'grid:temp'),
 ('00000000-0000-0000-0000-0000000009a2', '00000000-0000-0000-0000-00000000000a', '{"layer":"temp"}', 'layer', 'run-2', '{"alpha":0.05}', '{"hori":"0.1.0"}', repeat('b', 64), 'grid:temp'),
 ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-00000000000b', '{"layer":"x"}', 'layer', 'run-b', '{}', '{}', repeat('c', 64), 'grid:x');
insert into public.entities (id, workspace_id, external_key, kind, reference_name) values
 ('00000000-0000-0000-0000-000000000ea0', '00000000-0000-0000-0000-00000000000a', 'mx-dgo', 'region', 'Durango');
insert into public.entity_versions (id, workspace_id, entity_id, number, body, crs, geometry, nature, snapshot_sha256) values
 ('00000000-0000-0000-0000-000000000ea1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000ea0', 1, 'earth', 'EPSG:4326',
  '{"type":"Polygon","coordinates":[[[-107.2,22.3],[-102.5,22.3],[-102.5,26.8],[-107.2,26.8],[-107.2,22.3]]]}', 'real', repeat('d', 64));
insert into public.monitors (id, workspace_id, owner_profile_id, name) values
 ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'Durango temperatura')
;
insert into public.artifacts (id, workspace_id, bucket, object_key, sha256, bytes, status, ready_at) values
 ('00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-00000000000a', 'bundles', 'temp/manifest.json', repeat('e', 64), 1234, 'ready', now()),
 ('00000000-0000-0000-0000-0000000aa002', '00000000-0000-0000-0000-00000000000a', 'bundles', 'temp/pending.f32', null, null, 'pending', null),
 ('00000000-0000-0000-0000-0000000aa003', '00000000-0000-0000-0000-00000000000a', 'exports', 'exp-1/manifest.json', repeat('f', 64), 99, 'ready', now());
insert into public.context_cards (id, workspace_id, region, level, text_es, text_en, source_title, source_url, source_year, status) values
 ('ctx-001', '00000000-0000-0000-0000-00000000000a', 'mx-dgo', 'OBSERVACION', 'Texto revisado', 'Reviewed text', 'Fuente', 'https://example.org', 2024, 'revisado'),
 ('ctx-002', '00000000-0000-0000-0000-00000000000a', 'mx-dgo', 'ASOCIACION', 'Borrador', 'Draft', null, null, null, 'borrador');

create table test.vars (k text primary key, v text);
grant all on test.vars to anon, authenticated, service_role;

-- =============== 1. Aislamiento entre equipos ===============
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a1', false);
select test.ok((select count(*) from public.sources) = 1, 'A solo ve sus fuentes, no las de B');
select test.ok((select count(*) from public.analysis_runs where workspace_id = '00000000-0000-0000-0000-00000000000b') = 0, 'A no ve ejecuciones de B');
select test.fails($$insert into public.sources (workspace_id, provider, kind) values ('00000000-0000-0000-0000-00000000000b','x','community')$$, '42501', 'A no puede escribir en B');
select test.fails($$insert into public.findings (workspace_id, run_id, finding_kind, scope, scope_ref, fdr_family, rule) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000009a1','atomic','cell','1','grid:temp','r')$$, '42501', 'Un usuario no escribe hallazgos directo (solo workers)');
reset role;
select test.fails($$insert into public.findings (workspace_id, run_id, finding_kind, scope, scope_ref, fdr_family, rule) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000009b1','atomic','cell','1','grid:x','r')$$, '23503', 'FK compuesta: un hallazgo de A no puede colgar de una ejecución de B');

-- =============== 2. Reportes: idempotencia, revisión y versiones ===============
-- Ana registra su productor (persona)
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a1', false);
insert into public.producers (id, workspace_id, kind, responsible_profile_id) values
 ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-00000000000a', 'person', '00000000-0000-0000-0000-0000000000a1');
insert into test.vars select 'r1', report_id::text || '|' || revision_id::text || '|' || row_version
  from public.submit_report_revision('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001a1', 'k-1',
       '{"description":"Calle inundada","licence":"CC-BY-4.0","consent":{"publicar":true},"observed_start":"2026-07-01T18:00:00Z","location":{"type":"Point","coordinates":[-104.66,24.02]},"crs":"EPSG:4326"}');
select test.ok((select report_id::text || '|' || revision_id::text || '|' || row_version
   from public.submit_report_revision('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001a1', 'k-1',
       '{"description":"Calle inundada","licence":"CC-BY-4.0","consent":{"publicar":true},"observed_start":"2026-07-01T18:00:00Z","location":{"type":"Point","coordinates":[-104.66,24.02]},"crs":"EPSG:4326"}'))
   = (select v from test.vars where k = 'r1'), 'Mismo envío repetido = mismo reporte y revisión (idempotente)');
select test.fails($$select * from public.submit_report_revision('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001a1', 'k-1', '{"description":"OTRA cosa","licence":"CC-BY-4.0","consent":{}}')$$, 'HZ409', 'Misma clave con otro contenido = conflicto');
select test.fails($$select * from public.submit_report_revision('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001a1', 'k-2', '{"description":"sin licencia","consent":{}}')$$, 'HZ422', 'Sin licencia no se acepta');
-- La autora no puede aprobarse (aunque fuera revisora; aquí además no tiene rol)
select test.fails($$select public.decide_review(split_part((select v from test.vars where k='r1'),'|',2)::uuid, 'accept', 'p1', 2)$$, 'HZ403', 'La autora no revisa su propio reporte');

-- Raúl (revisor) acepta
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a2', false);
select test.fails($$select public.decide_review(split_part((select v from test.vars where k='r1'),'|',2)::uuid, 'accept', 'p1', 1)$$, 'HZ412', 'Versión esperada vieja = conflicto');
select public.decide_review(split_part((select v from test.vars where k='r1'),'|',2)::uuid, 'accept', 'protocolo-v0', 2);
select test.ok((select editorial_status from public.reports where id = split_part((select v from test.vars where k='r1'),'|',1)::uuid) = 'accepted', 'El revisor acepta la revisión vigente');

-- Ana edita: nueva revisión, la aprobación anterior NO se hereda
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a1', false);
insert into test.vars select 'r1b', revision_id::text || '|' || row_version
  from public.submit_report_revision('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001a1', 'k-1',
       '{"description":"Calle inundada, 30 cm","licence":"CC-BY-4.0","consent":{"publicar":true},"change_reason":"medí el agua"}',
       split_part((select v from test.vars where k='r1'),'|',1)::uuid, 3);
select test.ok((select editorial_status from public.reports where id = split_part((select v from test.vars where k='r1'),'|',1)::uuid) = 'submitted', 'Editar crea revisión 2 y vuelve a "submitted"');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a2', false);
select test.fails($$select public.decide_review(split_part((select v from test.vars where k='r1'),'|',2)::uuid, 'accept', 'p1', 4)$$, 'HZ409', 'No se puede aprobar una revisión ya reemplazada');
reset role;
select test.fails($$update public.report_revisions set description = 'cambiado' where number = 1$$, 'HZ403', 'Una revisión enviada es inmutable');
select test.fails($$update public.audit_events set action = 'x'$$, 'HZ403', 'La auditoría solo agrega');
select test.ok((select count(*) from public.audit_events where action in ('submit_revision','review')) = 3, 'Cada envío y revisión quedó auditado');

-- =============== 3. Workers: lease, fencing, resultado + evento + outbox ===============
set role service_role;
insert into test.vars select 'a1', attempt_number || '|' || fencing_token from public.claim_run_attempt('00000000-0000-0000-0000-0000000009a1', 'worker-1', 300);
select test.fails($$select * from public.claim_run_attempt('00000000-0000-0000-0000-0000000009a1', 'worker-2', 300)$$, 'HZ409', 'Con lease vivo, otro worker no toma la ejecución');
reset role;
update public.run_attempts set lease_until = now() - interval '1 second' where run_id = '00000000-0000-0000-0000-0000000009a1';  -- el worker 1 se colgó
set role service_role;
insert into test.vars select 'a2', attempt_number || '|' || fencing_token from public.claim_run_attempt('00000000-0000-0000-0000-0000000009a1', 'worker-2', 300);
select test.fails($$select public.finalize_run('00000000-0000-0000-0000-0000000009a1', 1, split_part((select v from test.vars where k='a1'),'|',2)::bigint, '[]', '[]')$$, 'HZ423', 'El worker vencido no puede publicar (fencing)');
select test.fails($$select public.finalize_run('00000000-0000-0000-0000-0000000009a1', 2, split_part((select v from test.vars where k='a2'),'|',2)::bigint, '[]', '[{"artifact_id":"00000000-0000-0000-0000-0000000aa002","role":"array","rel_path":"x.f32"}]')$$, 'HZ422', 'No se publica con artefactos sin verificar');
select test.ok(public.finalize_run('00000000-0000-0000-0000-0000000009a1', 2, split_part((select v from test.vars where k='a2'),'|',2)::bigint,
  '[{"scope":"region","scope_ref":"mx-dgo","rule":"consenso-3-bh","variable_id":"00000000-0000-0000-0000-0000000007a0","window_start":1980,"window_end":2024,"effect":0.30,"ci_lo":0.23,"ci_hi":0.37,"unit":"°C/década","verdict":1,"mde":0.12,"q_value":0.001,"p_cons":0.0004}]',
  '[{"artifact_id":"00000000-0000-0000-0000-0000000aa001","role":"manifest","rel_path":"manifest.json"}]',
  '00000000-0000-0000-0000-0000000000c0',
  '[{"event_kind":"scientific","transition":"NUEVO","transition_key":"mx-dgo:temp:1980-2024:PROBADO","scope":"region","scope_ref":"mx-dgo","reason":"primer análisis"}]',
  array['web','correo']) = 1, 'Publica hallazgo + 1 evento en la misma transacción');
select test.ok((select count(*) from public.outbox_messages) = 2, 'El evento dejó un mensaje de outbox por destino');
select test.fails($$select public.finalize_run('00000000-0000-0000-0000-0000000009a1', 2, split_part((select v from test.vars where k='a2'),'|',2)::bigint, '[]', '[]')$$, 'HZ423', 'Publicar dos veces la misma ejecución no se permite');
-- otra ejecución que reporta la MISMA transición no duplica el evento
insert into test.vars select 'b1', attempt_number || '|' || fencing_token from public.claim_run_attempt('00000000-0000-0000-0000-0000000009a2', 'worker-3', 300);
select test.ok(public.finalize_run('00000000-0000-0000-0000-0000000009a2', 1, split_part((select v from test.vars where k='b1'),'|',2)::bigint, '[]', '[]',
  '00000000-0000-0000-0000-0000000000c0', '[{"event_kind":"scientific","transition":"NUEVO","transition_key":"mx-dgo:temp:1980-2024:PROBADO"}]', array['web']) = 0,
  'Reintento con la misma transición no duplica el evento');
-- outbox: al menos una vez
select test.ok((select count(*) from public.claim_outbox('web')) = 1, 'El repartidor toma el mensaje pendiente');
select test.ok((select count(*) from public.claim_outbox('web')) = 0, 'Mientras está en vuelo nadie más lo toma');
select public.settle_outbox((select id from public.outbox_messages where destination = 'web'), false, 'timeout');
select test.ok((select status from public.outbox_messages where destination = 'web') = 'pending', 'Si falla, vuelve a pendiente para reintentar');
reset role;
select test.fails($$update public.findings set effect = 9$$, 'HZ403', 'Un hallazgo publicado no se reescribe');
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a1', false);
select test.fails($$select * from public.claim_run_attempt('00000000-0000-0000-0000-0000000009a2', 'yo', 10)$$, '42501', 'Un usuario normal no puede actuar como worker');
reset role;

-- =============== 4. Sensor sin reporte se exporta ===============
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a1', false);
insert into public.producers (id, workspace_id, kind, responsible_profile_id, model) values
 ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-00000000000a', 'sensor', '00000000-0000-0000-0000-0000000000a1', 'termómetro X');
insert into public.observation_batches (id, workspace_id, producer_id, idempotency_key) values
 ('00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000001a2', 'lote-1');
insert into public.observations (workspace_id, batch_id, producer_id, variable_id, value_numeric, unit_original, unit_canonical, observed_start, external_key)
select '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-0000000001a2',
       '00000000-0000-0000-0000-0000000007a0', 20 + g * 0.1, '°C', '°C', '2026-11-14T00:00:00Z'::timestamptz + make_interval(hours => g), 'm-' || g
from generate_series(1, 24) g;
select test.fails($$insert into public.observations (workspace_id, batch_id, producer_id, variable_id, value_numeric, value_text, observed_start) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000bb001','00000000-0000-0000-0000-0000000001a2','00000000-0000-0000-0000-0000000007a0', 1, 'uno', now())$$, '23514', 'Una observación tiene una sola forma de valor');
select test.fails($$insert into public.observations (workspace_id, batch_id, producer_id, variable_id, value_numeric, observed_start, observed_end) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000bb001','00000000-0000-0000-0000-0000000001a2','00000000-0000-0000-0000-0000000007a0', 1, now(), now() - interval '1 hour')$$, '23514', 'Intervalo de tiempo invertido se rechaza');
select public.seal_observation_batch('00000000-0000-0000-0000-0000000bb001', repeat('1', 64));
select public.seal_observation_batch('00000000-0000-0000-0000-0000000bb001', repeat('1', 64));
select test.ok(true, 'Sellar el lote dos veces con el mismo hash es idempotente');
select test.fails($$insert into public.observations (workspace_id, batch_id, producer_id, variable_id, value_numeric, observed_start) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000bb001','00000000-0000-0000-0000-0000000001a2','00000000-0000-0000-0000-0000000007a0', 1, now())$$, 'HZ403', 'Un lote sellado ya no recibe mediciones');
update public.observations set value_numeric = 0;
select test.ok((select count(*) from public.observations where value_numeric = 0) = 0, 'Un usuario no puede editar observaciones (RLS)');
reset role;
select test.fails($$update public.observations set value_numeric = 0$$, 'HZ403', 'Ni el dueño de la base edita observaciones (trigger)');
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a1', false);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a3', false);   -- Olga, owner
insert into public.exports (id, workspace_id, destination, format, format_version, licence, manifest_artifact_id) values
 ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-00000000000a', 'publico', 'horizon-export', '0.1', 'CC-BY-4.0', '00000000-0000-0000-0000-0000000aa003');
insert into public.export_items (workspace_id, export_id, member_kind, batch_id, origin_id, sha256) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000ee001', 'observation_batch', '00000000-0000-0000-0000-0000000bb001', 'hz-local:lote-1', repeat('1', 64));
select public.seal_export('00000000-0000-0000-0000-0000000ee001');
select test.ok((select status from public.exports where id = '00000000-0000-0000-0000-0000000ee001') = 'sealed', 'Un sensor sin ningún reporte se exporta con procedencia y licencia');
select test.fails($$insert into public.export_items (workspace_id, export_id, member_kind, batch_id, origin_id, sha256) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000ee001','observation_batch','00000000-0000-0000-0000-0000000bb001','dup', repeat('2',64))$$, 'HZ403', 'Una exportación sellada no cambia');
-- una revisión que no está aceptada no sale
insert into public.exports (id, workspace_id, destination, format, format_version, licence, manifest_artifact_id) values
 ('00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-00000000000a', 'publico', 'horizon-export', '0.1', 'CC-BY-4.0', '00000000-0000-0000-0000-0000000aa003');
insert into public.export_items (workspace_id, export_id, member_kind, report_revision_id, origin_id, sha256) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000ee002', 'report_revision', split_part((select v from test.vars where k='r1b'),'|',1)::uuid, 'hz-local:r1', repeat('3', 64));
select test.fails($$select public.seal_export('00000000-0000-0000-0000-0000000ee002')$$, 'HZ422', 'Una revisión sin aceptar no se publica');
reset role;

-- =============== 5. Versiones: cambiar la definición no reescribe lo anterior ===============
insert into public.monitor_versions (id, workspace_id, monitor_id, number, entity_version_id, config, author_profile_id, config_sha256)
values ('00000000-0000-0000-0000-0000000dd001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c0', 1,
        '00000000-0000-0000-0000-000000000ea1', '{"delta_sigma_per_decade":2}', '00000000-0000-0000-0000-0000000000a3', repeat('4', 64));
insert into public.monitor_variables (workspace_id, monitor_version_id, variable_id) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000dd001', '00000000-0000-0000-0000-0000000007a0');
update public.monitor_versions set status = 'active' where id = '00000000-0000-0000-0000-0000000dd001';
select test.fails($$update public.monitor_versions set config = '{"delta_sigma_per_decade":1}' where id = '00000000-0000-0000-0000-0000000dd001'$$, 'HZ403', 'Cambiar δ en una versión activa no se permite: se crea otra versión');
select test.fails($$delete from public.monitor_variables where monitor_version_id = '00000000-0000-0000-0000-0000000dd001'$$, 'HZ403', 'Las variables de una versión activa no cambian');
select test.fails($$update public.entity_versions set crs = 'x'$$, 'HZ403', 'Una versión de entidad es inmutable');
select test.fails($$update public.artifacts set object_key = 'otro' where id = '00000000-0000-0000-0000-0000000aa001'$$, 'HZ403', 'Un artefacto listo no se sobrescribe');

-- =============== 6. Grafo multifuente sin ciclos ===============
insert into public.findings (id, workspace_id, run_id, finding_kind, scope, scope_ref, fdr_family, rule) values
 ('00000000-0000-0000-0000-0000000ff001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000009a2', 'atomic',  'region', 'mx-dgo', 'regions', 'fuente-1'),
 ('00000000-0000-0000-0000-0000000ff002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000009a2', 'derived', 'region', 'mx-dgo', 'regions', 'combinado');
insert into public.finding_inputs (workspace_id, derived_id, input_id, role) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000ff002', '00000000-0000-0000-0000-0000000ff001', 'fuente');
select test.fails($$insert into public.finding_inputs (workspace_id, derived_id, input_id, role) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000ff001','00000000-0000-0000-0000-0000000ff002','fuente')$$, 'HZ422', 'El grafo de hallazgos no admite ciclos');

-- =============== 7. Web pública (anon) ===============
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select test.ok((select count(*) from public.context_cards) = 1, 'La web solo ve fichas revisadas y con fuente');
insert into public.feedback (workspace_id, kind, message, page_state, lang) values ('00000000-0000-0000-0000-00000000000a', 'error', 'El mapa no carga', '/?l=temp', 'es');
insert into public.comprehension_responses (workspace_id, test_id, question_id, answer, register, lang) values ('00000000-0000-0000-0000-00000000000a', 'B2', 'q1', '{"opcion":"b"}', 'sencillo', 'es');
select test.ok(true, 'La web puede mandar comentarios y respuestas sin cuenta');
select test.fails($$insert into public.feedback (workspace_id, kind, message) values ('00000000-0000-0000-0000-00000000000b', 'comentario', 'hola')$$, '42501', 'Solo a equipos que aceptan comentarios públicos');
select test.fails($$select count(*) from public.feedback$$, '42501', 'La web no puede leer los comentarios de nadie');
select test.fails($$select count(*) from public.reports$$, '42501', 'La web no ve reportes ni nada privado');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-0000000000a2', false);
select test.ok((select count(*) from public.feedback) = 1, 'El revisor del equipo sí lee los comentarios');
reset role;

-- =============== 8. Alta de usuarios ===============
set role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', false);
select test.ok(public.ensure_profile('Nueva') = public.ensure_profile('Nueva'), 'ensure_profile crea el perfil una sola vez');
select test.ok((select count(*) from public.workspaces) = 0, 'Una cuenta nueva no ve equipos ajenos');
select public.create_workspace('Mi equipo');
select test.ok((select count(*) from public.workspaces) = 1, 'Quien crea un equipo queda como owner y lo ve');
reset role;
set role anon;
select test.fails($$select public.ensure_profile('x')$$, '42501', 'Sin sesión no se crean perfiles');
reset role;

select format('%s pruebas, %s fallas', count(*), count(*) filter (where not ok)) as resultado from test.results;
