-- HORIZON 247 · operaciones atómicas (el diseño exige que estas no sean CRUD sueltos).
-- Cada función corre en UNA transacción. Códigos de error propios:
--   HZ403 prohibido · HZ404 no existe · HZ409 conflicto/duplicado · HZ412 versión esperada no coincide
--   HZ422 dato inválido · HZ423 intento vencido o reemplazado (fencing)

create or replace function horizon_private.sha256_jsonb(j jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(j::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function horizon_private.audit(ws uuid, actor uuid, action text, otype text, oid text, summary jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (workspace_id, actor_profile_id, action, object_type, object_id, summary)
  values (ws, actor, action, otype, oid, summary)
$$;

-- =====================================================================
-- Red enjambre: enviar una revisión de reporte (crea el reporte si es nuevo)
-- Misma clave + mismo contenido = mismo resultado; misma clave + otro contenido = conflicto.
-- Editar crea una revisión nueva y la aprobación anterior NO se hereda (vuelve a submitted).
-- =====================================================================
create or replace function public.submit_report_revision(
  p_workspace_id uuid, p_producer_id uuid, p_idempotency_key text, p_content jsonb,
  p_report_id uuid default null, p_expected_row_version int default null)
returns table (report_id uuid, revision_id uuid, revision_number int, row_version int)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := horizon_private.current_profile_id();
  h text := horizon_private.sha256_jsonb(p_content);
  r public.reports%rowtype;
  n int;
  rev_id uuid;
begin
  if me is null or not horizon_private.has_role(p_workspace_id, array['owner','admin','reviewer','contributor']) then
    raise exception 'HORIZON: no puedes aportar en este equipo' using errcode = 'HZ403';
  end if;
  if not exists (select 1 from public.producers p where p.id = p_producer_id and p.workspace_id = p_workspace_id
                 and p.status = 'active' and p.responsible_profile_id = me) then
    raise exception 'HORIZON: el productor no es tuyo o no está activo' using errcode = 'HZ403';
  end if;
  if coalesce(p_content ->> 'licence', '') = '' or p_content -> 'consent' is null then
    raise exception 'HORIZON: falta licencia o consentimiento' using errcode = 'HZ422';
  end if;

  if p_report_id is null then
    select * into r from public.reports x
     where x.workspace_id = p_workspace_id and x.producer_id = p_producer_id and x.idempotency_key = p_idempotency_key
     for update;
    if found then
      if (select rv.content_sha256 from public.report_revisions rv where rv.id = r.current_revision_id) = h then
        return query select r.id, r.current_revision_id,
          (select rv.number from public.report_revisions rv where rv.id = r.current_revision_id), r.row_version;
        return;
      end if;
      raise exception 'HORIZON: la clave % ya se usó con otro contenido', p_idempotency_key using errcode = 'HZ409';
    end if;
    insert into public.reports (workspace_id, producer_id, author_profile_id, idempotency_key, editorial_status, entity_id)
    values (p_workspace_id, p_producer_id, me, p_idempotency_key, 'submitted', (p_content ->> 'entity_id')::uuid)
    returning * into r;
    n := 1;
  else
    select * into r from public.reports x where x.id = p_report_id and x.workspace_id = p_workspace_id for update;
    if not found then raise exception 'HORIZON: reporte no encontrado' using errcode = 'HZ404'; end if;
    if r.author_profile_id <> me then raise exception 'HORIZON: solo el autor edita su reporte' using errcode = 'HZ403'; end if;
    if p_expected_row_version is null or r.row_version <> p_expected_row_version then
      raise exception 'HORIZON: el reporte cambió (versión % ≠ %)', r.row_version, p_expected_row_version using errcode = 'HZ412';
    end if;
    if r.editorial_status in ('withdrawn','superseded') then
      raise exception 'HORIZON: el reporte está %', r.editorial_status using errcode = 'HZ409';
    end if;
    select coalesce(max(rv.number), 0) + 1 into n from public.report_revisions rv where rv.report_id = r.id;
  end if;

  insert into public.report_revisions (workspace_id, report_id, number, author_profile_id, description, phenomenon,
      location, crs, location_precision_m, observed_start, observed_end, licence, consent, change_reason, content_sha256)
  values (p_workspace_id, r.id, n, me, p_content ->> 'description', p_content ->> 'phenomenon',
      p_content -> 'location', p_content ->> 'crs', (p_content ->> 'location_precision_m')::double precision,
      (p_content ->> 'observed_start')::timestamptz, (p_content ->> 'observed_end')::timestamptz,
      p_content ->> 'licence', p_content -> 'consent', p_content ->> 'change_reason', h)
  returning id into rev_id;

  update public.reports x set current_revision_id = rev_id, editorial_status = 'submitted',
         row_version = x.row_version + 1, updated_at = now()
   where x.id = r.id;

  perform horizon_private.audit(p_workspace_id, me, 'submit_revision', 'report', r.id::text,
                                jsonb_build_object('revision', n, 'sha256', h));
  return query select r.id, rev_id, n, (select x.row_version from public.reports x where x.id = r.id);
end $$;

-- =====================================================================
-- Revisar: solo la revisión vigente, con la versión esperada, y nunca la propia.
-- =====================================================================
create or replace function public.decide_review(
  p_revision_id uuid, p_decision text, p_protocol text, p_expected_row_version int,
  p_criteria jsonb default '{}'::jsonb, p_checks jsonb default '{}'::jsonb, p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := horizon_private.current_profile_id();
  rv public.report_revisions%rowtype;
  r public.reports%rowtype;
  review_id uuid;
begin
  select * into rv from public.report_revisions where id = p_revision_id;
  if not found then raise exception 'HORIZON: revisión no encontrada' using errcode = 'HZ404'; end if;
  if me is null or not horizon_private.has_role(rv.workspace_id, array['owner','admin','reviewer']) then
    raise exception 'HORIZON: no eres revisor de este equipo' using errcode = 'HZ403';
  end if;
  select * into r from public.reports where id = rv.report_id for update;
  if r.current_revision_id <> rv.id then
    raise exception 'HORIZON: esa revisión ya fue reemplazada por otra' using errcode = 'HZ409';
  end if;
  if r.row_version <> p_expected_row_version then
    raise exception 'HORIZON: el reporte cambió (versión % ≠ %)', r.row_version, p_expected_row_version using errcode = 'HZ412';
  end if;
  if r.editorial_status not in ('submitted','under_review') then
    raise exception 'HORIZON: el reporte está % y no se puede revisar', r.editorial_status using errcode = 'HZ409';
  end if;
  if p_decision not in ('accept','reject','needs_changes') then
    raise exception 'HORIZON: decisión inválida' using errcode = 'HZ422';
  end if;

  insert into public.reviews (workspace_id, revision_id, reviewer_profile_id, decision, protocol, criteria, checks, reason)
  values (rv.workspace_id, rv.id, me, p_decision, p_protocol, p_criteria, p_checks, p_reason)
  returning id into review_id;

  update public.reports set
    editorial_status = case p_decision when 'accept' then 'accepted' when 'reject' then 'rejected' else 'under_review' end,
    row_version = row_version + 1, updated_at = now()
  where id = r.id;

  perform horizon_private.audit(rv.workspace_id, me, 'review', 'report_revision', rv.id::text,
                                jsonb_build_object('decision', p_decision, 'protocol', p_protocol));
  return review_id;
end $$;

-- Retirar: no reescribe lo publicado; bloquea nuevas exportaciones.
create or replace function public.withdraw_report(p_report_id uuid, p_expected_row_version int, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := horizon_private.current_profile_id(); r public.reports%rowtype;
begin
  select * into r from public.reports where id = p_report_id for update;
  if not found then raise exception 'HORIZON: reporte no encontrado' using errcode = 'HZ404'; end if;
  if r.author_profile_id <> me and not horizon_private.has_role(r.workspace_id, array['owner','admin']) then
    raise exception 'HORIZON: no puedes retirar este reporte' using errcode = 'HZ403';
  end if;
  if r.row_version <> p_expected_row_version then
    raise exception 'HORIZON: el reporte cambió' using errcode = 'HZ412';
  end if;
  update public.reports set editorial_status = 'withdrawn', row_version = row_version + 1, updated_at = now() where id = r.id;
  perform horizon_private.audit(r.workspace_id, me, 'withdraw', 'report', r.id::text, jsonb_build_object('reason', p_reason));
end $$;

-- Sellar un lote de sensor: después ya no acepta mediciones (no necesita reporte).
create or replace function public.seal_observation_batch(p_batch_id uuid, p_content_sha256 text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := horizon_private.current_profile_id(); b public.observation_batches%rowtype;
begin
  select * into b from public.observation_batches where id = p_batch_id for update;
  if not found then raise exception 'HORIZON: lote no encontrado' using errcode = 'HZ404'; end if;
  if not exists (select 1 from public.producers p where p.id = b.producer_id and p.responsible_profile_id = me)
     and not horizon_private.has_role(b.workspace_id, array['owner','admin']) then
    raise exception 'HORIZON: no puedes sellar este lote' using errcode = 'HZ403';
  end if;
  if b.status = 'sealed' then
    if b.content_sha256 = p_content_sha256 then return; end if;   -- reintento idempotente
    raise exception 'HORIZON: el lote ya se selló con otro hash' using errcode = 'HZ409';
  end if;
  if not exists (select 1 from public.observations o where o.batch_id = b.id) and b.bulk_artifact_id is null then
    raise exception 'HORIZON: un lote vacío no se sella' using errcode = 'HZ422';
  end if;
  update public.observation_batches set status = 'sealed', content_sha256 = p_content_sha256, sealed_at = now() where id = b.id;
  perform horizon_private.audit(b.workspace_id, me, 'seal_batch', 'observation_batch', b.id::text, jsonb_build_object('sha256', p_content_sha256));
end $$;

-- Sellar una exportación: cada miembro debe ser publicable en ese momento.
create or replace function public.seal_export(p_export_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := horizon_private.current_profile_id(); e public.exports%rowtype; bad int;
begin
  select * into e from public.exports where id = p_export_id for update;
  if not found then raise exception 'HORIZON: exportación no encontrada' using errcode = 'HZ404'; end if;
  if not horizon_private.has_role(e.workspace_id, array['owner','admin']) then
    raise exception 'HORIZON: solo owner/admin sellan exportaciones' using errcode = 'HZ403';
  end if;
  if e.status <> 'draft' then raise exception 'HORIZON: ya está %', e.status using errcode = 'HZ409'; end if;
  if not exists (select 1 from public.export_items where export_id = e.id) then
    raise exception 'HORIZON: exportación vacía' using errcode = 'HZ422';
  end if;
  if e.manifest_artifact_id is null or (select status from public.artifacts where id = e.manifest_artifact_id) <> 'ready' then
    raise exception 'HORIZON: el manifiesto de la exportación no está listo' using errcode = 'HZ422';
  end if;
  -- revisiones: deben ser la vigente de un reporte aceptado (retirados o reemplazados no salen)
  select count(*) into bad from public.export_items i
    join public.report_revisions rv on rv.id = i.report_revision_id
    join public.reports r on r.id = rv.report_id
   where i.export_id = e.id and (r.editorial_status <> 'accepted' or r.current_revision_id <> rv.id);
  if bad > 0 then raise exception 'HORIZON: % revisiones no están aceptadas o ya no son vigentes', bad using errcode = 'HZ422'; end if;
  -- mediciones de sensores: lote sellado (no necesitan reporte)
  select count(*) into bad from public.export_items i
    left join public.observations o on o.id = i.observation_id
    join public.observation_batches b on b.id = coalesce(i.batch_id, o.batch_id)
   where i.export_id = e.id and b.status <> 'sealed';
  if bad > 0 then raise exception 'HORIZON: % miembros vienen de lotes sin sellar', bad using errcode = 'HZ422'; end if;
  update public.exports set status = 'sealed', sealed_at = now() where id = e.id;
  perform horizon_private.audit(e.workspace_id, me, 'seal_export', 'export', e.id::text, null);
end $$;

-- =====================================================================
-- Workers (solo service_role): intentos con lease + fencing token.
-- Solo el intento vigente y con lease vivo publica; un worker vencido queda bloqueado.
-- =====================================================================
create or replace function public.claim_run_attempt(p_run_id uuid, p_worker text, p_lease_seconds int default 300)
returns table (attempt_number int, fencing_token bigint, lease_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare run public.analysis_runs%rowtype; cur public.run_attempts%rowtype; n int; tok bigint; until timestamptz;
begin
  select * into run from public.analysis_runs where id = p_run_id for update;
  if not found then raise exception 'HORIZON: ejecución no encontrada' using errcode = 'HZ404'; end if;
  if run.status in ('succeeded','cancelled') then
    raise exception 'HORIZON: la ejecución ya está %', run.status using errcode = 'HZ409';
  end if;
  select * into cur from public.run_attempts a where a.run_id = run.id and a.number = run.current_attempt;
  if found and cur.status = 'running' then
    if cur.lease_until > now() then
      raise exception 'HORIZON: otro worker (%) tiene el lease hasta %', cur.worker, cur.lease_until using errcode = 'HZ409';
    end if;
    update public.run_attempts set status = 'expired', ended_at = now() where id = cur.id;
  end if;
  n := run.current_attempt + 1;
  tok := nextval('public.fencing_token_seq');
  until := now() + make_interval(secs => p_lease_seconds);
  insert into public.run_attempts (workspace_id, run_id, number, worker, fencing_token, lease_until)
  values (run.workspace_id, run.id, n, p_worker, tok, until);
  update public.analysis_runs set current_attempt = n, status = 'running' where id = run.id;
  return query select n, tok, until;
end $$;

create or replace function public.heartbeat_run_attempt(p_run_id uuid, p_attempt int, p_token bigint, p_lease_seconds int default 300)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare a public.run_attempts%rowtype; until timestamptz := now() + make_interval(secs => p_lease_seconds);
begin
  select * into a from public.run_attempts where run_id = p_run_id and number = p_attempt for update;
  if not found or a.fencing_token <> p_token or a.status <> 'running' or a.lease_until <= now()
     or (select current_attempt from public.analysis_runs where id = p_run_id) <> p_attempt then
    raise exception 'HORIZON: intento vencido o reemplazado' using errcode = 'HZ423';
  end if;
  update public.run_attempts set heartbeat_at = now(), lease_until = until where id = a.id;
  return until;
end $$;

-- Publica resultados + eventos + outbox en UNA transacción, tras comprobar que los artefactos están listos.
--  p_findings:  [{finding_kind, variable_id, scope, scope_ref, window_start, window_end, fdr_family, rule, effect,
--                 ci_lo, ci_hi, unit, verdict, mde, delta, p_cons, q_value, flags, locator, diagnostics, diagnostics_version}]
--  p_artifacts: [{artifact_id, role, rel_path}]
--  p_events:    [{event_kind, transition, transition_key, scope, priority, rule, reason, scope_ref}]  (necesita p_monitor_id)
create or replace function public.finalize_run(
  p_run_id uuid, p_attempt int, p_token bigint, p_findings jsonb, p_artifacts jsonb,
  p_monitor_id uuid default null, p_events jsonb default '[]'::jsonb, p_destinations text[] default array[]::text[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  run public.analysis_runs%rowtype; a public.run_attempts%rowtype;
  ev jsonb; seq_next bigint; ev_id uuid; d text; n_events int := 0; not_ready int;
begin
  select * into run from public.analysis_runs where id = p_run_id for update;
  if not found then raise exception 'HORIZON: ejecución no encontrada' using errcode = 'HZ404'; end if;
  select * into a from public.run_attempts where run_id = run.id and number = p_attempt for update;
  if not found or a.fencing_token <> p_token or a.status <> 'running' or a.lease_until <= now()
     or run.current_attempt <> p_attempt or run.status <> 'running' then
    raise exception 'HORIZON: intento vencido o reemplazado; no publica' using errcode = 'HZ423';
  end if;

  -- artefactos: del mismo equipo y verificados (ready = hash y tamaño ya comprobados en Storage)
  select count(*) into not_ready
    from jsonb_to_recordset(coalesce(p_artifacts, '[]'::jsonb)) as x(artifact_id uuid, role text, rel_path text)
    left join public.artifacts art on art.id = x.artifact_id and art.workspace_id = run.workspace_id
   where art.id is null or art.status <> 'ready';
  if not_ready > 0 then raise exception 'HORIZON: % artefactos no están listos o son de otro equipo', not_ready using errcode = 'HZ422'; end if;
  insert into public.run_artifacts (workspace_id, run_id, artifact_id, role, rel_path)
  select run.workspace_id, run.id, x.artifact_id, x.role, x.rel_path
    from jsonb_to_recordset(coalesce(p_artifacts, '[]'::jsonb)) as x(artifact_id uuid, role text, rel_path text);

  insert into public.findings (workspace_id, run_id, finding_kind, variable_id, scope, scope_ref, window_start, window_end,
      fdr_family, rule, effect, ci_lo, ci_hi, unit, verdict, mde, delta, p_cons, q_value, flags, locator, diagnostics, diagnostics_version)
  select run.workspace_id, run.id, coalesce(f.finding_kind, 'atomic'), f.variable_id, f.scope, f.scope_ref, f.window_start, f.window_end,
      coalesce(f.fdr_family, run.fdr_family), f.rule, f.effect, f.ci_lo, f.ci_hi, f.unit, f.verdict, f.mde, f.delta,
      f.p_cons, f.q_value, coalesce(f.flags, 0), f.locator, f.diagnostics, f.diagnostics_version
  from jsonb_to_recordset(coalesce(p_findings, '[]'::jsonb)) as f(
      finding_kind text, variable_id uuid, scope text, scope_ref text, window_start int, window_end int, fdr_family text,
      rule text, effect double precision, ci_lo double precision, ci_hi double precision, unit text, verdict smallint,
      mde double precision, delta double precision, p_cons double precision, q_value double precision, flags int,
      locator jsonb, diagnostics jsonb, diagnostics_version int);

  if jsonb_array_length(coalesce(p_events, '[]'::jsonb)) > 0 then
    if p_monitor_id is null then raise exception 'HORIZON: eventos sin monitor' using errcode = 'HZ422'; end if;
    perform 1 from public.monitors m where m.id = p_monitor_id and m.workspace_id = run.workspace_id for update;
    if not found then raise exception 'HORIZON: monitor de otro equipo o inexistente' using errcode = 'HZ403'; end if;
    for ev in select * from jsonb_array_elements(p_events) loop
      select coalesce(max(seq), 0) + 1 into seq_next from public.monitor_events where monitor_id = p_monitor_id;
      insert into public.monitor_events (workspace_id, monitor_id, seq, event_kind, transition, transition_key, run_id,
          finding_id, scope, priority, rule, reason)
      values (run.workspace_id, p_monitor_id, seq_next, ev ->> 'event_kind', ev ->> 'transition', ev ->> 'transition_key', run.id,
          (select fi.id from public.findings fi where fi.run_id = run.id and fi.scope_ref = ev ->> 'scope_ref' limit 1),
          ev ->> 'scope', coalesce((ev ->> 'priority')::smallint, 0), ev ->> 'rule', ev ->> 'reason')
      on conflict (monitor_id, transition_key) do nothing
      returning id into ev_id;
      if ev_id is not null then
        n_events := n_events + 1;
        foreach d in array p_destinations loop
          insert into public.outbox_messages (workspace_id, event_id, destination, delivery_key, payload)
          values (run.workspace_id, ev_id, d, ev_id::text || ':' || d,
                  jsonb_build_object('event_id', ev_id, 'monitor_id', p_monitor_id, 'seq', seq_next, 'run_id', run.id) || ev);
        end loop;
      end if;
      ev_id := null;
    end loop;
  end if;

  update public.run_attempts set status = 'succeeded', ended_at = now() where id = a.id;
  update public.analysis_runs set status = 'succeeded', finished_at = now() where id = run.id;
  return n_events;
end $$;

create or replace function public.fail_run_attempt(p_run_id uuid, p_attempt int, p_token bigint, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.run_attempts%rowtype;
begin
  select * into a from public.run_attempts where run_id = p_run_id and number = p_attempt for update;
  if not found or a.fencing_token <> p_token or a.status <> 'running' then
    raise exception 'HORIZON: intento vencido o reemplazado' using errcode = 'HZ423';
  end if;
  update public.run_attempts set status = 'failed', error = left(p_error, 4000), ended_at = now() where id = a.id;
  update public.analysis_runs set status = 'failed' where id = p_run_id and current_attempt = p_attempt;
end $$;

-- Outbox: entrega AL MENOS una vez. El destinatario deduplica por delivery_key.
create or replace function public.claim_outbox(p_destination text, p_limit int default 20, p_lease_seconds int default 60)
returns setof public.outbox_messages language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.outbox_messages o set status = 'in_flight', attempts = o.attempts + 1,
         lease_until = now() + make_interval(secs => p_lease_seconds)
   where o.id in (select id from public.outbox_messages
                   where destination = p_destination
                     and (status = 'pending' or (status = 'in_flight' and lease_until < now()))
                     and next_attempt_at <= now()
                   order by created_at, id
                   limit p_limit
                   for update skip locked)
  returning o.*;
end $$;

create or replace function public.settle_outbox(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.outbox_messages set
    status = case when p_ok then 'delivered' when attempts >= max_attempts then 'dead_letter' else 'pending' end,
    delivered_at = case when p_ok then now() end,
    last_error = case when p_ok then null else left(p_error, 2000) end,
    next_attempt_at = case when p_ok then next_attempt_at else now() + make_interval(secs => least(3600, 10 * power(2, attempts)::int)) end,
    lease_until = null
  where id = p_id and status = 'in_flight';
end $$;

-- Permisos de ejecución
revoke execute on function public.submit_report_revision, public.decide_review, public.withdraw_report,
  public.seal_observation_batch, public.seal_export, public.claim_run_attempt, public.heartbeat_run_attempt,
  public.finalize_run, public.fail_run_attempt, public.claim_outbox, public.settle_outbox from public, anon;
grant execute on function public.submit_report_revision, public.decide_review, public.withdraw_report,
  public.seal_observation_batch, public.seal_export to authenticated;
grant execute on function public.claim_run_attempt, public.heartbeat_run_attempt, public.finalize_run,
  public.fail_run_attempt, public.claim_outbox, public.settle_outbox to service_role;
revoke execute on function public.claim_run_attempt, public.heartbeat_run_attempt, public.finalize_run,
  public.fail_run_attempt, public.claim_outbox, public.settle_outbox from authenticated;

-- Alta de usuarios: vincula la cuenta de Supabase con un perfil interno (emisor + sujeto).
create or replace function public.ensure_profile(p_display_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); pid uuid;
begin
  if uid is null then raise exception 'HORIZON: inicia sesión primero' using errcode = 'HZ403'; end if;
  select profile_id into pid from public.external_identities where issuer = 'supabase' and subject = uid::text;
  if pid is not null then return pid; end if;
  insert into public.profiles (display_name) values (left(p_display_name, 120)) returning id into pid;
  insert into public.external_identities (profile_id, issuer, subject) values (pid, 'supabase', uid::text);
  return pid;
end $$;

-- Crear un equipo: quien lo crea queda como owner.
create or replace function public.create_workspace(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := horizon_private.current_profile_id(); ws uuid;
begin
  if me is null then raise exception 'HORIZON: crea tu perfil con ensure_profile' using errcode = 'HZ403'; end if;
  insert into public.workspaces (name) values (p_name) returning id into ws;
  insert into public.memberships (workspace_id, profile_id, role) values (ws, me, 'owner');
  perform horizon_private.audit(ws, me, 'create_workspace', 'workspace', ws::text, null);
  return ws;
end $$;
revoke execute on function public.ensure_profile, public.create_workspace from public, anon;
grant execute on function public.ensure_profile, public.create_workspace to authenticated;

-- Las ayudas internas no se llaman desde fuera.
revoke execute on function horizon_private.audit(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function horizon_private.sha256_jsonb(jsonb) from public, anon, authenticated;
