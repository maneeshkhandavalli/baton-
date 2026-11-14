-- Baton Round 4 hosted apply: 20261114100100_account_deletion.sql, verbatim, in ONE transaction, on baton-dev (xnwppnzvrpthukxjfojj) only.
-- Run through run-hosted.sh r4apply. The guard aborts (nothing applied) unless the history is exactly baton-dev's
-- post-Phase-D state (36 rows, newest 20261113300900) and the new functions do not exist yet.
begin;

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 36
     or (select max(version) from supabase_migrations.schema_migrations) <> '20261113300900'
     or to_regprocedure('public.delete_own_account(uuid,text,uuid[])') is not null
     or to_regprocedure('public.account_has_password(uuid)') is not null
     or to_regprocedure('public.purge_handover(uuid,uuid,uuid)') is null
     or to_regprocedure('public.delete_account_data(uuid,text)') is null
  then
    raise exception 'REFUSED: not baton-dev at the expected migration state; nothing was changed';
  end if;
end $$;

-- ===== 20261114100100_account_deletion.sql (verbatim) =====
-- Account deletion goes live (§12.9, D25), with D27 deliberately narrowed (decision 2026-11-14).
--
-- Why: deleteAccount was fail-closed because purging a handover the user created needed the external recovery
-- manifest (D27), which was never built. Without a purge, anyone who ever created a handover (even a
-- soft-deleted one) could never delete their account. The product owner chose to ship deletion now and accept
-- the documented risk: restoring an OLDER database backup would bring purged data back. The audit trail keeps
-- 'handover.purged' and 'account.deleted' rows (ids and counts only), so a deletion can be re-applied by hand.
--
-- What changes (additive; no table, column, policy or existing grant changes):
--   * delete_own_account: ONE transaction for the verified actor's own deletion:
--       check_account_deletion (typed DELETE; each listed handover created by the actor; every created handover
--       listed) → purge_handover for each listed handover, as that creator → delete_account_data (memberships
--       removed, tokens revoked, profile anonymised to "Former member", snapshots relabelled, audit row).
--     Any failure rolls everything back. Granted to service_role only, like delete_account_data.
--   * purge_handover and erase_participant stay granted to NO role. The actor-less retention path of
--     purge_handover stays unreachable from the application.
--   * account_has_password: read-only, for the Account page (the auth user object does not expose it).
-- Rollback: drop function public.delete_own_account(uuid, text, uuid[]); drop function public.account_has_password(uuid);
-- Storage objects (raw/{handover_id}/…) and the auth user (soft delete) are removed by the server around this
-- call (lib/actions/core/account.ts).

create function public.delete_own_account(p_actor_profile_id uuid, p_confirmation text, p_purge_handover_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id); -- verified, live, matches any session subject
  v_ids uuid[];
  v_id uuid;
  v_purged int := 0;
  v_data jsonb;
begin
  -- A busy handover (a worker holding a job row) aborts the deletion instead of hanging; the user retries.
  perform set_config('lock_timeout', '10s', true);

  select coalesce(array_agg(x::uuid order by x::uuid), '{}')
    into v_ids
    from jsonb_array_elements_text(public.check_account_deletion(v_actor, p_confirmation, p_purge_handover_ids) -> 'purgeHandoverIds') x;

  foreach v_id in array v_ids loop
    -- purge_handover re-checks the actor and that this actor created the handover.
    if public.purge_handover(gen_random_uuid(), v_id, v_actor) then
      v_purged := v_purged + 1;
    end if;
  end loop;

  v_data := public.delete_account_data(v_actor, p_confirmation);
  return jsonb_build_object('purgedHandovers', v_purged) || v_data;
end $$;

-- Read-only: whether the verified actor's auth user has a password (for "Sign-in methods").
create function public.account_has_password(p_actor_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
begin
  return exists (select 1 from auth.users u where u.id = v_actor and u.encrypted_password is not null and u.encrypted_password <> '');
end $$;

revoke execute on function public.delete_own_account(uuid, text, uuid[]) from public, anon, authenticated, service_role;
revoke execute on function public.account_has_password(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_own_account(uuid, text, uuid[]) to service_role;
grant execute on function public.account_has_password(uuid) to service_role;
-- ===== end of migration =====

insert into supabase_migrations.schema_migrations (version, name) values ('20261114100100', 'account_deletion');

commit;

notify pgrst, 'reload schema';
