-- What GoTrue, PostgREST and KTL's schema expect of a plain Postgres: the
-- API roles that row-level security is written against, the auth schema
-- GoTrue owns, and the extensions schema. Safe to run on every boot.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- PostgREST logs in as this and switches to anon/authenticated per request.
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  -- GoTrue owns the auth schema and runs its own migrations in it, under
  -- the role name those migrations expect.
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
  -- Some of GoTrue's migrations grant to this role; give them something to grant to.
  if not exists (select from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
alter role authenticator set statement_timeout = '15s';
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';

create schema if not exists auth authorization supabase_auth_admin;
grant all on schema auth to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
alter database postgres set search_path = "$user", public, extensions;

-- Defaults for the public schema: the API roles can reach
-- objects there, and row-level security decides what they actually see.
-- Default privileges only, for objects created from here on — never a
-- blanket grant on existing ones, which would undo every later REVOKE
-- (delete_user_account, for one, must stay callable by the server alone).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema if not exists ktl_meta;
create table if not exists ktl_meta.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);
create table if not exists ktl_meta.settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
