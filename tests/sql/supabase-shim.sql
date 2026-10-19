-- ===========================================================================
-- Supabase shim for the local SQL test harness
-- ---------------------------------------------------------------------------
-- The migrations target a Supabase project, which already provides an `auth`
-- schema, a `storage` schema and the anon/authenticated/service_role roles.
-- PGlite is plain Postgres, so this file creates just enough of that surface
-- for the migrations to run and for RLS to be exercised the same way PostgREST
-- exercises it.
--
-- This file is TEST SCAFFOLDING. It is never applied to a real project — the
-- real platform supplies all of it. Keep it minimal and faithful: if a shimmed
-- object behaves differently from Supabase's, tests will quietly lie.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Roles
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Mirrors Supabase: the service role bypasses RLS.
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- auth schema
-- --------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- A stand-in for auth.users. Only the columns the migrations reference exist.
create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  phone         text,
  created_at    timestamptz not null default now()
);

-- auth.uid() reads the request's JWT claims, exactly as Supabase's does. Tests
-- set the claim with  set local request.jwt.claims = '{"sub":"<uuid>"}'.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  );
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- storage schema
-- --------------------------------------------------------------------------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null unique,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id),
  name        text,
  owner       uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

alter table storage.objects enable row level security;

-- Splits an object path into its segments, as Supabase's does.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- The `extensions` schema Supabase installs contrib modules into.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
