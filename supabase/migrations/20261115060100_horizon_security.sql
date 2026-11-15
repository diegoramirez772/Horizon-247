-- HORIZON 247 · seguridad: inmutabilidad, RLS por equipo y rol, permisos de la web pública.
-- Los permisos se deducen de la identidad verificada (auth.uid -> external_identities -> memberships),
-- nunca de un campo que mande el cliente.

create schema if not exists horizon_private;
revoke all on schema horizon_private from public;
grant usage on schema horizon_private to anon, authenticated, service_role;

-- ---------- Identidad del que llama ----------
create or replace function horizon_private.current_profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select ei.profile_id
  from public.external_identities ei
  join public.profiles p on p.id = ei.profile_id and p.status = 'active'
  where ei.issuer = 'supabase' and ei.subject = (select auth.uid())::text
$$;

create or replace function horizon_private.has_role(ws uuid, roles text[] default array['owner','admin','reviewer','contributor','viewer'])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.status = 'active' and m.role = any(roles)
      and m.profile_id = horizon_private.current_profile_id()
  )
$$;

create or replace function horizon_private.accepts_public_input(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select w.accepts_public_input from public.workspaces w where w.id = ws and w.status = 'active'), false)
$$;

grant execute on all functions in schema horizon_private to anon, authenticated, service_role;

-- ---------- Inmutabilidad ----------
create or replace function horizon_private.forbid_change() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'HORIZON: % es inmutable (% no permitido); corrige con una versión nueva', tg_table_name, tg_op
    using errcode = 'HZ403';
end $$;

-- Contenido enviado, hallazgos, versiones de entidad, revisiones y auditoría: nunca se editan ni se borran.
create trigger report_revisions_immutable before update or delete on public.report_revisions for each row execute function horizon_private.forbid_change();
create trigger findings_immutable        before update or delete on public.findings        for each row execute function horizon_private.forbid_change();
create trigger entity_versions_immutable before update or delete on public.entity_versions for each row execute function horizon_private.forbid_change();
create trigger reviews_immutable         before update or delete on public.reviews         for each row execute function horizon_private.forbid_change();
create trigger audit_events_append_only  before update or delete on public.audit_events    for each row execute function horizon_private.forbid_change();
create trigger finding_inputs_immutable  before update or delete on public.finding_inputs  for each row execute function horizon_private.forbid_change();

-- Observaciones: solo se puede marcar processed_at; la corrección es una observación nueva con supersedes_id.
create or replace function horizon_private.observations_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'HORIZON: las observaciones no se borran' using errcode = 'HZ403';
  end if;
  if (to_jsonb(new) - 'processed_at') is distinct from (to_jsonb(old) - 'processed_at') then
    raise exception 'HORIZON: una observación es inmutable; registra otra con supersedes_id' using errcode = 'HZ403';
  end if;
  return new;
end $$;
create trigger observations_guard before update or delete on public.observations for each row execute function horizon_private.observations_guard();

-- Solo se agregan observaciones a un lote abierto.
create or replace function horizon_private.observation_batch_open() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select status from public.observation_batches where id = new.batch_id) <> 'open' then
    raise exception 'HORIZON: el lote ya está sellado' using errcode = 'HZ403';
  end if;
  return new;
end $$;
create trigger observations_batch_open before insert on public.observations for each row execute function horizon_private.observation_batch_open();

create or replace function horizon_private.sealed_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if (to_jsonb(old) ->> 'sealed_at') is not null then
      raise exception 'HORIZON: % sellado no se borra', tg_table_name using errcode = 'HZ403';
    end if;
    return old;
  end if;
  if (to_jsonb(old) ->> 'sealed_at') is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'HORIZON: % sellado es inmutable', tg_table_name using errcode = 'HZ403';
  end if;
  return new;
end $$;
create trigger dataset_versions_sealed before update or delete on public.dataset_versions for each row execute function horizon_private.sealed_guard();
create trigger observation_batches_sealed before update or delete on public.observation_batches for each row execute function horizon_private.sealed_guard();

-- Versión de monitor: la definición se congela al activarla; solo cambia su estado.
create or replace function horizon_private.monitor_versions_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'HORIZON: versión activa o retirada no se borra' using errcode = 'HZ403'; end if;
    return old;
  end if;
  if old.status <> 'draft' and (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'HORIZON: la versión % del monitor ya no es borrador; crea una nueva', old.number using errcode = 'HZ403';
  end if;
  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'HORIZON: una versión retirada no se reactiva' using errcode = 'HZ403';
  end if;
  if new.status = 'active' and old.status = 'draft' then new.activated_at := now(); end if;
  return new;
end $$;
create trigger monitor_versions_guard before update or delete on public.monitor_versions for each row execute function horizon_private.monitor_versions_guard();

create or replace function horizon_private.monitor_variables_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_id uuid := coalesce(new.monitor_version_id, old.monitor_version_id);
begin
  if (select status from public.monitor_versions where id = v_id) <> 'draft' then
    raise exception 'HORIZON: las variables de una versión activa no cambian' using errcode = 'HZ403';
  end if;
  return coalesce(new, old);
end $$;
create trigger monitor_variables_guard before insert or update or delete on public.monitor_variables for each row execute function horizon_private.monitor_variables_guard();

-- Artefacto listo: no se sobrescribe; solo puede pasar a cuarentena o borrado.
create or replace function horizon_private.artifacts_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'HORIZON: marca el artefacto como deleted en lugar de borrar la fila' using errcode = 'HZ403';
  end if;
  if old.status in ('ready','quarantined','deleted')
     and (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'HORIZON: artefacto % ya publicado; sube uno nuevo', old.object_key using errcode = 'HZ403';
  end if;
  if old.status = 'deleted' and new.status <> 'deleted' then
    raise exception 'HORIZON: un artefacto borrado no vuelve' using errcode = 'HZ403';
  end if;
  return new;
end $$;
create trigger artifacts_guard before update or delete on public.artifacts for each row execute function horizon_private.artifacts_guard();

-- Exportación sellada: sus miembros no cambian.
create or replace function horizon_private.export_items_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select status from public.exports where id = coalesce(new.export_id, old.export_id)) <> 'draft' then
    raise exception 'HORIZON: la exportación ya está sellada' using errcode = 'HZ403';
  end if;
  return coalesce(new, old);
end $$;
create trigger export_items_guard before insert or update or delete on public.export_items for each row execute function horizon_private.export_items_guard();

-- Grafo de hallazgos sin ciclos.
create or replace function horizon_private.finding_inputs_acyclic() returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    with recursive up(id) as (
      select new.derived_id
      union
      select fi.derived_id from public.finding_inputs fi join up on fi.input_id = up.id
    )
    select 1 from up where id = new.input_id
  ) then
    raise exception 'HORIZON: este vínculo crearía un ciclo entre hallazgos' using errcode = 'HZ422';
  end if;
  return new;
end $$;
create trigger finding_inputs_acyclic before insert on public.finding_inputs for each row execute function horizon_private.finding_inputs_acyclic();

-- El autor no se revisa a sí mismo.
create or replace function horizon_private.reviews_not_self() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reviewer_profile_id is not null and new.reviewer_profile_id =
     (select author_profile_id from public.report_revisions where id = new.revision_id) then
    raise exception 'HORIZON: el autor no puede revisar su propia revisión' using errcode = 'HZ403';
  end if;
  return new;
end $$;
create trigger reviews_not_self before insert on public.reviews for each row execute function horizon_private.reviews_not_self();

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','external_identities','workspaces','memberships','sources','dataset_versions','variables','entities',
    'entity_versions','monitors','monitor_versions','monitor_variables','artifacts','analysis_runs','run_attempts',
    'run_inputs','run_artifacts','findings','finding_inputs','monitor_events','outbox_messages','producers',
    'observation_batches','observations','reports','report_revisions','report_evidence','report_observations',
    'reviews','audit_events','exports','export_items','context_cards','comprehension_responses','feedback']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- La web pública (anon) no ve nada salvo lo que abren las políticas de abajo.
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke update, delete on public.audit_events from authenticated;
revoke update, delete on public.findings, public.reviews, public.report_revisions, public.entity_versions from authenticated;

-- Identidad
create policy profiles_read on public.profiles for select to authenticated using (
  id = horizon_private.current_profile_id()
  or exists (select 1 from public.memberships a join public.memberships b on a.workspace_id = b.workspace_id
             where a.profile_id = profiles.id and b.profile_id = horizon_private.current_profile_id()
               and a.status = 'active' and b.status = 'active'));
create policy external_identities_own on public.external_identities for select to authenticated
  using (profile_id = horizon_private.current_profile_id());
create policy workspaces_members on public.workspaces for select to authenticated using (horizon_private.has_role(id));
create policy memberships_members on public.memberships for select to authenticated using (horizon_private.has_role(workspace_id));
create policy memberships_admin on public.memberships for all to authenticated
  using (horizon_private.has_role(workspace_id, array['owner','admin']))
  with check (horizon_private.has_role(workspace_id, array['owner','admin']));

-- Lectura para cualquier miembro activo del equipo
do $$
declare t text;
begin
  foreach t in array array[
    'sources','dataset_versions','variables','entities','entity_versions','monitors','monitor_versions',
    'monitor_variables','artifacts','analysis_runs','run_attempts','run_inputs','run_artifacts','findings',
    'finding_inputs','monitor_events','producers','observation_batches','observations','reports',
    'report_revisions','report_evidence','report_observations','reviews','exports','export_items','context_cards']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (horizon_private.has_role(workspace_id))',
                   t || '_read', t);
  end loop;
end $$;
create policy audit_admin_read on public.audit_events for select to authenticated
  using (horizon_private.has_role(workspace_id, array['owner','admin']));
create policy outbox_admin_read on public.outbox_messages for select to authenticated
  using (horizon_private.has_role(workspace_id, array['owner','admin']));

-- Escritura directa de catálogo y monitores: owner/admin
do $$
declare t text;
begin
  foreach t in array array['sources','dataset_versions','variables','entities','entity_versions',
                           'monitors','monitor_versions','monitor_variables','exports','export_items']
  loop
    execute format('create policy %I on public.%I for insert to authenticated with check (horizon_private.has_role(workspace_id, array[''owner'',''admin'']))', t || '_admin_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (horizon_private.has_role(workspace_id, array[''owner'',''admin''])) with check (horizon_private.has_role(workspace_id, array[''owner'',''admin'']))', t || '_admin_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (horizon_private.has_role(workspace_id, array[''owner'',''admin'']))', t || '_admin_del', t);
  end loop;
end $$;

-- Subidas y aportes: contributor o más, siempre a nombre propio
create policy artifacts_upload on public.artifacts for insert to authenticated
  with check (status = 'pending' and horizon_private.has_role(workspace_id, array['owner','admin','reviewer','contributor']));
create policy producers_own on public.producers for insert to authenticated
  with check (responsible_profile_id = horizon_private.current_profile_id()
              and horizon_private.has_role(workspace_id, array['owner','admin','reviewer','contributor']));
create policy batches_own on public.observation_batches for insert to authenticated
  with check (status = 'open' and horizon_private.has_role(workspace_id, array['owner','admin','reviewer','contributor'])
              and exists (select 1 from public.producers p where p.id = producer_id and p.status = 'active'
                          and p.responsible_profile_id = horizon_private.current_profile_id()));
create policy observations_own on public.observations for insert to authenticated
  with check (horizon_private.has_role(workspace_id, array['owner','admin','reviewer','contributor'])
              and exists (select 1 from public.producers p where p.id = producer_id and p.status = 'active'
                          and p.responsible_profile_id = horizon_private.current_profile_id()));
-- Reportes, revisiones, reseñas, ejecuciones, hallazgos, eventos y outbox: solo por funciones (0200) o service_role.

-- Fichas de contexto (Carolina): contributor escribe borradores; reviewer/admin las marca revisadas.
create policy context_cards_write on public.context_cards for insert to authenticated
  with check ((status = 'borrador' and horizon_private.has_role(workspace_id, array['owner','admin','reviewer','contributor']))
              or horizon_private.has_role(workspace_id, array['owner','admin','reviewer']));
create policy context_cards_edit on public.context_cards for update to authenticated
  using (horizon_private.has_role(workspace_id, array['owner','admin','reviewer','contributor']))
  with check ((status = 'borrador' and horizon_private.has_role(workspace_id, array['owner','admin','reviewer','contributor']))
              or horizon_private.has_role(workspace_id, array['owner','admin','reviewer']));

-- ---------- Web pública (anon) ----------
grant select on public.context_cards to anon;
create policy context_cards_public on public.context_cards for select to anon, authenticated
  using (status = 'revisado' and level <> 'ACCION');

grant insert on public.comprehension_responses, public.feedback to anon, authenticated;
create policy comprehension_insert on public.comprehension_responses for insert to anon, authenticated
  with check (horizon_private.accepts_public_input(workspace_id));
create policy feedback_insert on public.feedback for insert to anon, authenticated
  with check (horizon_private.accepts_public_input(workspace_id));
create policy comprehension_team_read on public.comprehension_responses for select to authenticated
  using (horizon_private.has_role(workspace_id, array['owner','admin','reviewer']));
create policy feedback_team_read on public.feedback for select to authenticated
  using (horizon_private.has_role(workspace_id, array['owner','admin','reviewer']));
-- Nadie de la web edita ni borra respuestas o comentarios.
revoke update, delete on public.comprehension_responses, public.feedback from authenticated;
