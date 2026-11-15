-- HORIZON 247 · red enjambre pública (15-nov). La web no tiene cuentas: una persona entra con una sesión ANÓNIMA de
-- Supabase (auth.uid() existe, sin correo ni nombre) y aporta reportes a un equipo aparte, «AETHRA · Red pública»,
-- marcado con settings.public_swarm = true. Nunca entra al equipo de la ciencia (hallazgos, corridas, monitores):
-- solo ve los reportes de la red pública, que de todos modos se muestran como «fuente no verificada».
--
-- El reporte sigue el camino normal: submit_report_revision (licencia + consentimiento obligatorios, hash del
-- contenido, auditoría) y queda «submitted» hasta que un revisor del equipo lo decida (decide_review).

create or replace function horizon_private.is_public_swarm(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (w.settings ->> 'public_swarm')::boolean and w.accepts_public_input and w.status = 'active'
                   from public.workspaces w where w.id = ws), false)
$$;

-- Unirse a la red pública: perfil (si falta) + membresía de colaborador + un productor «person». Devuelve el productor.
create or replace function public.join_public_swarm(p_workspace_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  pid uuid;
  prod uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'HORIZON: inicia sesión primero' using errcode = 'HZ403';
  end if;
  if not horizon_private.is_public_swarm(p_workspace_id) then
    raise exception 'HORIZON: este equipo no es la red pública' using errcode = 'HZ403';
  end if;
  pid := public.ensure_profile('Persona de la red');
  insert into public.memberships (workspace_id, profile_id, role)
  values (p_workspace_id, pid, 'contributor')
  on conflict (workspace_id, profile_id) do nothing;
  select p.id into prod from public.producers p
   where p.workspace_id = p_workspace_id and p.responsible_profile_id = pid and p.kind = 'person' and p.status = 'active'
   limit 1;
  if prod is null then
    insert into public.producers (workspace_id, kind, responsible_profile_id, model)
    values (p_workspace_id, 'person', pid, 'web')
    returning id into prod;
  end if;
  return prod;
end $$;

revoke execute on function public.join_public_swarm(uuid) from public, anon;
grant execute on function public.join_public_swarm(uuid) to authenticated;
revoke execute on function horizon_private.is_public_swarm(uuid) from public, anon;
grant execute on function horizon_private.is_public_swarm(uuid) to authenticated, service_role;
