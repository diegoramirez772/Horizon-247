-- HORIZON 247 · geometría terrestre con PostGIS (solo si la extensión existe; en Supabase existe).
-- Solo cuerpo 'earth' con CRS EPSG:4326 se convierte; Marte y otros cuerpos NO usan distancias terrestres.
do $mig$
begin
  if not exists (select 1 from pg_available_extensions where name = 'postgis') then
    raise notice 'HORIZON: PostGIS no disponible; se omite la geometría (GeoJSON sigue guardado).';
    return;
  end if;
  create extension if not exists postgis with schema extensions;

  alter table public.entity_versions  add column geom extensions.geometry(Geometry, 4326);
  alter table public.observations     add column geom extensions.geometry(Point, 4326);
  alter table public.report_revisions add column geom extensions.geometry(Geometry, 4326);

  create or replace function horizon_private.fill_geom() returns trigger language plpgsql set search_path = '' as $f$
  declare g jsonb; c text; is_earth boolean := true;
  begin
    if tg_table_name = 'entity_versions' then
      g := new.geometry; c := new.crs; is_earth := new.body = 'earth';
    else
      g := new.location; c := new.crs;
    end if;
    if g is not null and is_earth and c = 'EPSG:4326' then
      new.geom := extensions.st_setsrid(extensions.st_geomfromgeojson(g::text), 4326);
    end if;
    return new;
  end $f$;

  -- Las tablas inmutables solo reciben INSERT, así que basta con BEFORE INSERT.
  create trigger entity_versions_geom  before insert on public.entity_versions  for each row execute function horizon_private.fill_geom();
  create trigger observations_geom     before insert on public.observations     for each row execute function horizon_private.fill_geom();
  create trigger report_revisions_geom before insert on public.report_revisions for each row execute function horizon_private.fill_geom();

  create index entity_versions_geom_gist  on public.entity_versions  using gist (geom);
  create index observations_geom_gist     on public.observations     using gist (geom);
  create index report_revisions_geom_gist on public.report_revisions using gist (geom);
end
$mig$;
