-- Account deletion: end every session of the deleted account, on every device (audit 3.9a gap 2, S7, F17).
--
-- Why: the server ended only the deleting browser's session (signOut scope "local"). Whether the Auth server's
-- soft delete also drops refresh tokens is not something this app can verify, so the server now removes them
-- itself, after the data is gone and the auth user is soft-deleted (lib/actions/core/account.ts):
--   * revoke_deleted_account_sessions(p_actor_profile_id): deletes the account's rows in auth.refresh_tokens and
--     auth.sessions, so no other device can refresh its session. An access token already issued stays valid
--     only until it expires (the Auth server's JWT lifetime); every Baton function also refuses a deleted profile
--     (_require_actor), so such a token cannot read or change anything.
--   * It acts ONLY on a profile that is already marked deleted (delete_account_data set deleted_at): it can never
--     sign out a live account. Granted to service_role only, like delete_own_account.
--   * Tables that do not exist (a plain Postgres test database) are skipped; counts only are audited.
-- Additive and idempotent: create or replace; no table, column, policy or existing grant changes.
-- D27 participant erasure stays disabled: purge_handover and erase_participant remain granted to no role.
-- Rollback: drop function public.revoke_deleted_account_sessions(uuid);

create or replace function public.revoke_deleted_account_sessions(p_actor_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tokens int := 0;
  v_sessions int := 0;
begin
  if p_actor_profile_id is null
     or not exists (select 1 from public.profiles where id = p_actor_profile_id and deleted_at is not null) then
    raise exception 'sessions are revoked here only for a deleted account' using errcode = 'BTPF0';
  end if;

  -- Supabase: auth.refresh_tokens.user_id is varchar, auth.sessions.user_id is uuid (refresh tokens of a session
  -- also go with it by cascade). Each is compared in its own type so the user_id indexes are used.
  if to_regclass('auth.refresh_tokens') is not null then
    execute 'delete from auth.refresh_tokens where user_id = $1' using p_actor_profile_id::text;
    get diagnostics v_tokens = row_count;
  end if;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_actor_profile_id;
    get diagnostics v_sessions = row_count;
  end if;

  perform public._audit(null, null, null, 'account.sessions_revoked', 'profile', p_actor_profile_id, null,
                        jsonb_build_object('sessions', v_sessions, 'refreshTokens', v_tokens));
  return jsonb_build_object('sessions', v_sessions, 'refreshTokens', v_tokens);
end $$;

revoke execute on function public.revoke_deleted_account_sessions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.revoke_deleted_account_sessions(uuid) to service_role;
