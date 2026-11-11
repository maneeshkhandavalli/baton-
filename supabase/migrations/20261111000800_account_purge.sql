-- Account deletion (§12.9), account-derived name snapshots (D26) and handover purge (§12.6, D27).

-- ── Blockers (getAccountDeletionBlockers) ────────────────────────────────────

create function public.get_account_deletion_blockers()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'title', h.title, 'deleted', h.deleted_at is not null)
                            order by h.created_at), '[]'::jsonb)
    from public.handovers h
   where h.created_by = auth.uid()
$$;

-- ── anonymise_account_snapshots (§12.9 item 6) ───────────────────────────────

create function public._anonymise_content(p_content jsonb, p_profile_id uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_content -> 'evidence') is distinct from 'array' then p_content else
    jsonb_set(
      p_content
      || (case when (p_content -> 'inferredConfirmation' ->> 'byProfileId') = p_profile_id::text
               then jsonb_build_object('inferredConfirmation', jsonb_set(p_content -> 'inferredConfirmation', '{byLabel}', '"Former member"'))
               else '{}'::jsonb end)
      || (case when (p_content -> 'conflictResolution' ->> 'byProfileId') = p_profile_id::text
               then jsonb_build_object('conflictResolution', jsonb_set(p_content -> 'conflictResolution', '{byLabel}', '"Former member"'))
               else '{}'::jsonb end),
      '{evidence}',
      coalesce((select jsonb_agg(case when e ->> 'authorProfileId' = p_profile_id::text
                                      then jsonb_set(e, '{authorLabel}', '"Former member"') else e end order by ord)
                  from jsonb_array_elements(p_content -> 'evidence') with ordinality as t (e, ord)), '[]'::jsonb))
  end
$$;

-- N2: INTERNAL. Granted to no role; called only by delete_account_data in the same transaction, after the
-- profile has been anonymised and marked deleted. It refuses any profile that is not being deleted. The
-- publication_points guard accepts the flag only when nothing but these label paths changes.
create function public.anonymise_account_snapshots(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answers int;
  v_quotes int;
  v_rows int;
begin
  if not exists (select 1 from public.profiles where id = p_profile_id and deleted_at is not null
                   and display_name = 'Former member')
     or exists (select 1 from public.handover_members where profile_id = p_profile_id and removed_at is null)
     or not public._flag('baton.account_deletion') then
    raise exception 'snapshots are anonymised only during account deletion' using errcode = 'BTPF0';
  end if;
  perform set_config('baton.account_anonymisation', 'on', true);
  update public.gap_answers set answerer_label = 'Former member'
   where answered_by_profile_id = p_profile_id and answerer_label <> 'Former member';
  get diagnostics v_answers = row_count;
  update public.evidence_quotes q set author_label = 'Former member'
   where q.kind = 'testimony' and q.author_label is distinct from 'Former member'
     and (q.stated_by_profile_id = p_profile_id
          or q.gap_answer_id in (select a.id from public.gap_answers a where a.answered_by_profile_id = p_profile_id));
  get diagnostics v_quotes = row_count;
  update public.publication_points pp set content = public._anonymise_content(pp.content, p_profile_id)
   where public._anonymise_content(pp.content, p_profile_id) is distinct from pp.content;
  get diagnostics v_rows = row_count;
  perform set_config('baton.account_anonymisation', 'off', true);
  return jsonb_build_object('gapAnswers', v_answers, 'testimony', v_quotes, 'publicationRows', v_rows);
end $$;

-- ── Account deletion request check (§12.9 item 3, D25) ──────────────────────
-- service_role, server-only. Run BEFORE any recovery-manifest write, purge or delete_account_data call.
-- The server checks the request itself, independently of the UI (deleteAccountInput):
--   * p_confirmation is exactly the typed word 'DELETE' (case-sensitive)            → else validation_failed;
--   * p_purge_handover_ids names each handover once                                 → else validation_failed;
--   * each listed id is a handover the actor created                                → else not_found;
--   * every handover the actor still created is listed (transferred ones are not)   → else precondition_failed.
-- Returns the ids to purge, in a stable order.

create function public.check_account_deletion(p_actor_profile_id uuid, p_confirmation text, p_purge_handover_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_ids uuid[] := coalesce(p_purge_handover_ids, '{}');
begin
  if p_confirmation is null or p_confirmation <> 'DELETE' then
    raise exception 'type DELETE to confirm' using errcode = 'BTVF0';
  end if;
  if array_position(v_ids, null) is not null
     or (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'list each handover once' using errcode = 'BTVF0';
  end if;
  if exists (select 1 from unnest(v_ids) x
              where not exists (select 1 from public.handovers h where h.id = x and h.created_by = v_actor)) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if exists (select 1 from public.handovers h where h.created_by = v_actor and not (h.id = any (v_ids))) then
    raise exception 'transfer or delete every handover you created first' using errcode = 'BTPF0';
  end if;
  return jsonb_build_object('purgeHandoverIds',
                            coalesce((select jsonb_agg(x order by x) from unnest(v_ids) x), '[]'::jsonb));
end $$;

-- ── Account deletion, database part (§12.9 item 4) ───────────────────────────
-- service_role. The caller (main) first checks the request (check_account_deletion), purges any handovers
-- the user confirmed, writing the recovery manifest entry before each purge, then calls this, then
-- soft-deletes the auth user through the Admin API (deleteUser(id, true)) — that last step is UNVERIFIED
-- on Supabase (assumption 9). The typed confirmation is checked again here (D25).

create function public.delete_account_data(p_profile_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_memberships int;
  v_tokens int;
  v_snapshots jsonb;
begin
  perform public._require_actor(p_profile_id); -- H1: only the verified account owner's own deletion
  if p_confirmation is null or p_confirmation <> 'DELETE' then
    raise exception 'type DELETE to confirm' using errcode = 'BTVF0'; -- D25, independent of the UI
  end if;
  -- Parent-row writer: lock every handover the person belongs to, FOR UPDATE, first, in id order.
  perform 1 from public.handovers h
   where h.id in (select m.handover_id from public.handover_members m where m.profile_id = p_profile_id)
   order by h.id for update;

  if exists (select 1 from public.handovers where created_by = p_profile_id) then
    raise exception 'transfer or delete every handover you created first' using errcode = 'BTPF0';
  end if;

  update public.handovers h set pending_creator_member_id = null, creator_transfer_offered_at = null
   where h.pending_creator_member_id in (select m.id from public.handover_members m where m.profile_id = p_profile_id);
  update public.handover_members set removed_at = now() where profile_id = p_profile_id and removed_at is null;
  get diagnostics v_memberships = row_count;
  update public.access_tokens set revoked_at = now() where created_by = p_profile_id and revoked_at is null;
  get diagnostics v_tokens = row_count;
  update public.profiles set display_name = 'Former member', avatar_url = null, deleted_at = now() where id = p_profile_id;
  perform set_config('baton.account_deletion', 'on', true);
  v_snapshots := public.anonymise_account_snapshots(p_profile_id);
  perform set_config('baton.account_deletion', 'off', true);

  -- Counts only; neither the email address nor the original name (§12.9 item 4).
  perform public._audit(null, null, null, 'account.deleted', 'profile', p_profile_id, null,
                        jsonb_build_object('memberships', v_memberships, 'tokensRevoked', v_tokens) || v_snapshots);
  return jsonb_build_object('memberships', v_memberships, 'tokensRevoked', v_tokens) || v_snapshots;
end $$;

-- ── purge_handover (§12.6, §12.8 recovery replay) ────────────────────────────
-- service_role. The caller writes the handover_purge recovery-manifest entry FIRST (fail closed, main's
-- lib/recovery). Purges if the handover exists, otherwise does nothing (idempotent replay). Allowed for:
--   * the retention sweep (p_actor_profile_id NULL) once the 30-day grace period has passed;
--   * the creator confirming an immediate purge during account deletion;
--   * a replay by the (not yet provisioned, D27) restore role.
-- Storage objects under raw/{handover_id}/ are removed by the caller.

create function public.purge_handover(p_event_id uuid, p_handover_id uuid, p_actor_profile_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers;
  v_replay boolean := session_user = 'baton_restore';
begin
  select * into v_h from public.handovers where id = p_handover_id for update;
  if not found then
    return false;
  end if;
  if not v_replay then
    if p_actor_profile_id is null then
      if v_h.deleted_at is null or v_h.deleted_at > now() - interval '30 days' then
        raise exception 'handover is not due for purge' using errcode = 'BTPF0';
      end if;
    elsif p_actor_profile_id is distinct from v_h.created_by then
      raise exception 'only the creator can purge a handover' using errcode = 'BTFB0';
    end if;
  end if;

  perform set_config('baton.purge', 'on', true);
  delete from public.handovers where id = p_handover_id; -- cascades; audit rows keep handover_id = NULL (D17)
  perform set_config('baton.purge', 'off', true);

  perform public._audit(null, case when v_replay then null else p_actor_profile_id end, null,
                        case when v_replay then 'restore.purge_replayed' else 'handover.purged' end,
                        'handover', p_handover_id, null, jsonb_build_object('eventId', p_event_id));
  return true;
end $$;

-- NOTE (gap): D17 keeps audit rows for 90 days after a purge, with handover_id set to NULL. Once nulled,
-- the schema no longer records when a row's handover was purged, so no sweep can apply "+90 days"
-- correctly. A purge timestamp on audit_logs (contract change, §13.3) is needed before that sweep exists.
