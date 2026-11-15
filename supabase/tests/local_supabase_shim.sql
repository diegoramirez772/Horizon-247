-- Imita lo mínimo de Supabase en un Postgres local para probar las migraciones:
-- roles anon/authenticated/service_role, auth.uid() y el esquema extensions.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create extension pgcrypto with schema extensions;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
