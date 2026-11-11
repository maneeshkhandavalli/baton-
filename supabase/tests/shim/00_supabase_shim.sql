-- LOCAL TEST SHIM ONLY. Never applied to a Supabase project.
--
-- Emulates the small part of the Supabase platform that Baton's migrations depend on, so they can
-- be tested against vanilla PostgreSQL 15 in Docker:
--   * roles anon, authenticated (NOBYPASSRLS) and service_role (BYPASSRLS), as on Supabase;
--   * schema auth with auth.users and auth.uid()/auth.jwt() reading request.jwt.claims (PostgREST);
--   * schema extensions (citext lives there on Supabase);
--   * schema storage with buckets/objects and storage.foldername().
--
-- Behaviour that this shim CANNOT prove (verify on a real Supabase dev project): PostgREST role
-- switching, GoTrue magic links, Storage signed URLs and RLS on storage.objects, default
-- privileges that Supabase grants on new objects, and anything about backups/PITR (D27).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- Supabase grants these to the authenticator connection; here the test superuser switches directly.
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}',
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Minimal Storage schema (structure mirrors Supabase's storage.buckets / storage.objects).
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Mimic Supabase: API roles get broad default privileges on new public tables, so the migrations
-- MUST revoke them explicitly. Testing with these defaults proves the revocations work.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create extension if not exists dblink; -- concurrency tests drive several real sessions through dblink
