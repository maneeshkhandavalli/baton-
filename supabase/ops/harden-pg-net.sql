-- OPTIONAL pg_net privilege hardening (Task 01B). OPERATOR SCRIPT, NOT A MIGRATION.
--
-- Finding (pg_net 0.20.4 in supabase/postgres 17.12.0.000, verified by supabase/ops/tests/run.sh):
--   * net.http_request_queue and net._http_response are owned by supabase_admin and granted ALL to PUBLIC;
--   * schema net is usable by PUBLIC, anon, authenticated, service_role, postgres, supabase_functions_admin;
--   * net.http_post / http_get are SECURITY INVOKER with the default (PUBLIC) EXECUTE;
--   * pg_net's background worker runs as `postgres` (pg_net.username), which is NOT a superuser and reaches
--     the queue only through those PUBLIC grants.
--   So any role that can run SQL can read queued request headers, and `postgres` (the SQL editor role)
--   cannot revoke the grants: they were made by supabase_admin ("no privileges could be revoked").
--
-- Baton does not depend on this script: its scheduler queues only short-lived signed headers, never the
-- secret (schedule-pipeline-worker.sql). Apply it only where the table owner can run it (supabase_admin:
-- local images, self-hosting, or Supabase support for a hosted project). Run as `postgres` it changes
-- nothing and says so.
--
-- It first grants what pg_net's worker and trusted callers need EXPLICITLY, then removes PUBLIC/anon/
-- authenticated. Supabase re-applies its grants when pg_net is (re)created or upgraded (event trigger
-- issue_pg_net_access), so re-run it after any pg_net change.

do $$
declare
  v_owner boolean := pg_has_role(current_user, (select tableowner from pg_tables where schemaname = 'net' and tablename = 'http_request_queue'), 'USAGE')
                     or (select rolsuper from pg_roles where rolname = current_user);
  r text;
begin
  if not v_owner then
    raise notice 'harden-pg-net: % does not own net.http_request_queue; nothing changed (ask the owner, e.g. Supabase support)', current_user;
    return;
  end if;

  -- What must keep working: pg_net's worker (postgres) and the trusted callers.
  foreach r in array array['postgres', 'service_role', 'supabase_functions_admin'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant usage on schema net to %I', r);
      execute format('grant select, insert, update, delete on net.http_request_queue, net._http_response to %I', r);
      execute format('grant usage, select on all sequences in schema net to %I', r);
      execute format('grant execute on all functions in schema net to %I', r);
    end if;
  end loop;

  -- What must not: anyone else.
  revoke all on net.http_request_queue, net._http_response from public, anon, authenticated;
  revoke all on all sequences in schema net from public, anon, authenticated;
  revoke execute on all functions in schema net from public, anon, authenticated;
  revoke usage on schema net from public, anon, authenticated;
  raise notice 'harden-pg-net: applied';
end $$;

-- Report (any role): who can read the queue now.
select r as role,
       has_table_privilege(r, 'net.http_request_queue', 'SELECT') as can_read_queue,
       has_function_privilege(r, 'net.http_post(text,jsonb,jsonb,jsonb,integer)', 'EXECUTE') as can_http_post
  from unnest(array['anon', 'authenticated', 'service_role', 'postgres']) r;
