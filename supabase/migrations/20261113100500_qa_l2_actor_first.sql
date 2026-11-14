-- R3-C7 = QA-L2 (hardening only; D27 stays fail-closed). erase_participant and purge_handover validate the
-- actor BEFORE any read or early return:
--   * public._require_actor(p_actor_profile_id) first: a session subject that differs from the actor is
--     refused (BTFB0), a missing or deleted actor is unauthenticated (BTUA0), a client API role is refused
--     even if it were granted by mistake (BTFB0);
--   * erase_participant: the creator check now precedes the idempotency answer (alreadyApplied), so a
--     replayed erasure id is no oracle for anyone but the creator;
--   * purge_handover: the actor-less retention path (p_actor_profile_id NULL) runs only for the sweep caller:
--     no session subject (auth.uid() IS NULL) and not a client API role. A user session is refused (BTFB0).
--   * the restore replay (session_user baton_restore, not provisioned: D27) is unchanged.
-- CREATE OR REPLACE with unchanged signatures: the grants stay exactly as they are (NO application role may
-- execute either function, 20261111001100_grants.sql), and no action calls them. Bodies are otherwise
-- copied unchanged from 20261111000700_privacy.sql and 20261111000800_account_purge.sql.

create or replace function public.erase_participant(
  p_erasure_id uuid, p_handover_id uuid, p_identity_kind text, p_identity_hash bytea, p_identity_pepper_version text,
  p_scope_source_id uuid, p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers;
  v_replay boolean := session_user = 'baton_restore';
  v_exclusion uuid;
  v_e uuid[];
  v_links uuid[];
  v_x uuid[];
  v_p uuid[];
  v_extra uuid[];
  v_point uuid;
  v_flagged uuid[] := '{}';
  v_changed_pubs uuid[] := '{}';
  v_pubs uuid[];
  v_messages int := 0;
  v_quotes int := 0;
  v_acks int := 0;
  v_same_name int := 0;
  v_sources uuid[];
  v_report jsonb;
begin
  -- QA-L2: the actor is validated FIRST (H1): an existing, non-deleted profile and auth user, equal to the
  -- session subject when there is one, and never a client API role. Only the restore replay has no actor.
  if not v_replay then
    perform public._require_actor(p_actor_profile_id);
  end if;
  perform set_config('lock_timeout', '5s', true);
  if p_erasure_id is null or p_identity_hash is null then
    raise exception 'erasure id and identity hash are required' using errcode = 'BTVF0';
  end if;
  if p_identity_kind is null or p_identity_kind not in ('phone', 'name') then
    raise exception 'unknown identity kind' using errcode = 'BTVF0';
  end if;
  if (p_identity_kind = 'name') <> (p_scope_source_id is not null) then
    raise exception 'a name erasure names its one source; a phone erasure names none' using errcode = 'BTVF0';
  end if;

  -- (1) Handover lock first; a soft-deleted handover can still be erased until it is purged.
  select * into v_h from public.handovers where id = p_handover_id for update;
  if not found then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;

  -- QA-L2: the creator check comes BEFORE the idempotency answer, so a replayed erasure id never tells
  -- anyone but the creator that it was applied.
  if not v_replay and (p_actor_profile_id is null or p_actor_profile_id is distinct from v_h.created_by) then
    raise exception 'only the creator can erase a participant' using errcode = 'BTFB0';
  end if;

  -- Step 0: idempotency.
  if exists (select 1 from public.participant_erasures where id = p_erasure_id) then
    return jsonb_build_object('alreadyApplied', true, 'messagesDeleted', 0, 'quotesDeleted', 0, 'pointsErased', 0,
                              'pointsFlaggedForPrivacyReview', 0, 'publicationsRedacted', 0, 'acknowledgementsInvalidated', 0,
                              'sameNameParticipantsElsewhere', 0);
  end if;
  if p_identity_pepper_version is distinct from 'p1' then
    raise exception 'unsupported identity pepper version' using errcode = 'BTVF0';
  end if;

  -- Sources S: every source of H for a phone identity, only the scope source for a name identity.
  if p_identity_kind = 'name' then
    if not exists (select 1 from public.sources where id = p_scope_source_id and handover_id = p_handover_id) then
      raise exception 'source not found' using errcode = 'BTNF0';
    end if;
    v_sources := array[p_scope_source_id];
  else
    select coalesce(array_agg(s.id order by s.id), '{}') into v_sources from public.sources s where s.handover_id = p_handover_id;
  end if;

  -- Scope (computed before any delete; links cascade with their evidence). A phone erasure also covers
  -- quotes whose source was purged (source_id NULL); a name erasure cannot attribute those (§12.8).
  select coalesce(array_agg(q.id order by q.id), '{}') into v_e
    from public.evidence_quotes q
   where q.handover_id = p_handover_id and q.kind = 'source_quote'
     and q.author_identity_kind = p_identity_kind
     and q.author_identity_hash = p_identity_hash and q.author_identity_pepper_version = p_identity_pepper_version
     and (p_identity_kind = 'phone' or q.source_id = p_scope_source_id);
  select coalesce(array_agg(pe.id order by pe.id), '{}') into v_links
    from public.point_evidence pe where pe.evidence_id = any (v_e);
  select coalesce(array_agg(p.id order by p.id), '{}') into v_x
    from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null
     and exists (select 1 from public.point_evidence pe where pe.point_id = p.id and pe.evidence_id = any (v_e))
     and not exists (select 1 from public.point_evidence pe where pe.point_id = p.id and not (pe.evidence_id = any (v_e)));
  select coalesce(array_agg(p.id order by p.id), '{}') into v_p
    from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and not (p.id = any (v_x))
     and exists (select 1 from public.point_evidence pe where pe.point_id = p.id and pe.evidence_id = any (v_e));
  -- Surviving points that use testimony answering a question of an erased point (step 3, last bullet).
  select coalesce(array_agg(distinct pe.point_id order by pe.point_id), '{}') into v_extra
    from public.gap_questions q
    join public.gap_answers a on a.gap_question_id = q.id
    join public.evidence_quotes t on t.gap_answer_id = a.id
    join public.point_evidence pe on pe.evidence_id = t.id
    join public.handover_points sp on sp.id = pe.point_id
   where q.point_id = any (v_x) and sp.erased_at is null and not (sp.id = any (v_x)) and not (sp.id = any (v_p));

  -- (3) Lock order.
  perform 1 from public.handover_points where id = any (v_x || v_p || v_extra) order by id for update;
  perform 1 from public.point_revisions where point_id = any (v_x) order by id for update;
  perform 1 from public.point_evidence where point_id = any (v_x || v_p) order by id for update;
  perform 1 from public.review_actions where point_id = any (v_x || v_p) order by id for update;
  perform 1 from public.gap_questions where point_id = any (v_x) order by id for update;
  perform 1 from public.evidence_quotes where id = any (v_e) order by id for update;
  perform 1 from public.handover_publications where handover_id = p_handover_id order by id for update;
  perform 1 from public.publication_points where handover_id = p_handover_id order by id for update;
  perform 1 from public.acknowledgements where handover_id = p_handover_id order by id for update;

  perform set_config('baton.erasure', 'on', true);

  -- Step 1: the handover-wide exclusion, so later uploads drop the participant at parse time.
  -- (phone: applied to later uploads; name: only detected there and decided per source, §6.8.1)
  insert into public.source_exclusions (handover_id, source_id, requested_by, kind, participant_identity_kind,
                                        participant_identity_hash, participant_identity_pepper_version, requested_via)
  values (p_handover_id, null, case when v_replay then null else p_actor_profile_id end, 'participant', p_identity_kind,
          p_identity_hash, p_identity_pepper_version, 'participant_request')
  on conflict (handover_id, participant_identity_kind, participant_identity_hash, participant_identity_pepper_version)
    where kind = 'participant' and source_id is null
  do nothing;
  select id into v_exclusion from public.source_exclusions
   where handover_id = p_handover_id and kind = 'participant' and source_id is null
     and participant_identity_kind = p_identity_kind
     and participant_identity_hash = p_identity_hash and participant_identity_pepper_version = p_identity_pepper_version;

  -- Step 2: evidence. Notes and metadata of review actions on those links can quote evidence.
  update public.review_actions set note = null, metadata = null
   where point_evidence_id = any (v_links) and (note is not null or metadata is not null);
  delete from public.evidence_quotes where id = any (v_e);
  get diagnostics v_quotes = row_count;

  -- Step 1 (cont.): the participant's own messages, label and exclusion flag.
  delete from public.source_messages m
   using public.source_participants sp
   where sp.id = m.participant_id and sp.handover_id = p_handover_id and sp.source_id = any (v_sources)
     and sp.identity_kind = p_identity_kind
     and sp.identity_hash = p_identity_hash and sp.identity_pepper_version = p_identity_pepper_version;
  get diagnostics v_messages = row_count;
  -- M3: a conversation's preview is its first masked line and may be the participant's own words, and its
  -- participant list and counts describe them. For every conversation they took part in: clear the
  -- preview, drop their local id, and recount from the messages that remain.
  update public.source_conversations c
     set preview = null,
         participant_local_ids = array_remove(c.participant_local_ids, sp.local_id),
         message_count = (select count(*) from public.source_messages m where m.conversation_id = c.id),
         started_at = (select min(m.sent_at) from public.source_messages m where m.conversation_id = c.id),
         ended_at = (select max(m.sent_at) from public.source_messages m where m.conversation_id = c.id)
    from public.source_participants sp
   where sp.handover_id = p_handover_id and sp.source_id = any (v_sources) and sp.identity_kind = p_identity_kind
     and sp.identity_hash = p_identity_hash and sp.identity_pepper_version = p_identity_pepper_version
     and c.source_id = sp.source_id and sp.local_id = any (c.participant_local_ids);
  update public.source_participants set excluded = true, display_label = 'Removed participant', message_count = 0
   where handover_id = p_handover_id and source_id = any (v_sources) and identity_kind = p_identity_kind
     and identity_hash = p_identity_hash and identity_pepper_version = p_identity_pepper_version;
  update public.sources s
     set message_count = (select count(*) from public.source_messages m where m.source_id = s.id),
         first_message_at = (select min(m.sent_at) from public.source_messages m where m.source_id = s.id),
         last_message_at = (select max(m.sent_at) from public.source_messages m where m.source_id = s.id)
   where s.id in (select sp.source_id from public.source_participants sp
                   where sp.handover_id = p_handover_id and sp.source_id = any (v_sources)
                     and sp.identity_kind = p_identity_kind and sp.identity_hash = p_identity_hash
                     and sp.identity_pepper_version = p_identity_pepper_version);
  -- D29: same-name participants in OTHER sources are reported, never erased by name.
  if p_identity_kind = 'name' then
    select count(*) into v_same_name from public.source_participants sp
     where sp.handover_id = p_handover_id and sp.source_id <> p_scope_source_id and sp.identity_kind = 'name'
       and sp.identity_hash = p_identity_hash and sp.identity_pepper_version = p_identity_pepper_version
       and not sp.excluded;
  end if;

  -- Step 3: points derived only from erased evidence (X).
  if cardinality(v_x) > 0 then
    update public.handover_points set erased_at = now(), inference_rationale = null, conflict_resolution_note = null
     where id = any (v_x);
    update public.point_revisions
       set title = '[removed]', statement = '[removed]', attributes = '{}'::jsonb, edit_reason = null,
           redacted_at = now(), redaction_kind = 'tombstone'
     where point_id = any (v_x) and redaction_kind is distinct from 'tombstone';
    update public.review_actions set note = null, metadata = null
     where point_id = any (v_x) and (note is not null or metadata is not null);
    update public.gap_questions
       set status = 'waived', question = '[removed]', context = null, waived_reason = 'participant_erasure'
     where point_id = any (v_x);
  end if;

  -- Step 4: partly affected points (P), plus points using answers to X's questions.
  foreach v_point in array (v_p || v_extra) loop
    perform public.recompute_point_status(v_point);
    if public._flag_point_for_privacy(v_point, 'participant_erasure') then
      v_flagged := v_flagged || v_point;
    end if;
  end loop;

  -- Step 5: every publication snapshot of the handover.
  with u as (
    update public.publication_points set content = '{"redacted": true}'::jsonb, redacted_at = now()
     where handover_id = p_handover_id and point_id = any (v_x) and redacted_at is null
    returning publication_id)
  select coalesce(array_agg(publication_id), '{}') into v_pubs from u;
  v_changed_pubs := v_changed_pubs || v_pubs;
  with u as (
    update public.publication_points pp set content = public._redact_evidence_items(pp.content, v_e)
     where pp.handover_id = p_handover_id and public._redact_evidence_items(pp.content, v_e) is distinct from pp.content
    returning publication_id)
  select coalesce(array_agg(publication_id), '{}') into v_pubs from u;
  v_changed_pubs := v_changed_pubs || v_pubs;
  select coalesce(array_agg(publication_id), '{}') into v_pubs from public.publication_points where point_id = any (v_flagged);
  v_changed_pubs := v_changed_pubs || v_pubs;
  select coalesce(array_agg(distinct x order by x), '{}') into v_changed_pubs from unnest(v_changed_pubs) x;
  update public.handover_publications set summary = null, redacted_at = coalesce(redacted_at, now())
   where id = any (v_changed_pubs);

  -- Step 6: acknowledgements of every changed publication.
  update public.acknowledgements set invalidated_at = now(), invalidation_reason = 'participant_erasure'
   where publication_id = any (v_changed_pubs) and invalidated_at is null;
  get diagnostics v_acks = row_count;
  if v_h.current_publication_id = any (v_changed_pubs) and v_h.state = 'acknowledged' then
    perform public.transition_handover(p_handover_id, 'approved', null);
  end if;

  -- Step 7: audit counts only; scrub earlier entries about erased rows (defence in depth).
  update public.audit_logs set before = null, after = null
   where entity_id = any (v_e || v_links || v_x) and (before is not null or after is not null);

  v_report := jsonb_build_object(
    'messagesDeleted', v_messages, 'quotesDeleted', v_quotes, 'pointsErased', cardinality(v_x),
    'pointsFlaggedForPrivacyReview', cardinality(v_flagged), 'publicationsRedacted', cardinality(v_changed_pubs),
    'acknowledgementsInvalidated', v_acks, 'sameNameParticipantsElsewhere', v_same_name);

  insert into public.participant_erasures (id, handover_id, exclusion_id, identity_kind, scope_source_id, actor_profile_id, replayed)
  values (p_erasure_id, p_handover_id, v_exclusion, p_identity_kind, p_scope_source_id,
          case when v_replay then null else p_actor_profile_id end, v_replay);

  perform public._audit(p_handover_id, case when v_replay then null else p_actor_profile_id end, null,
                        case when v_replay then 'restore.erasure_replayed' else 'participant.erased' end,
                        'source_exclusion', v_exclusion, null, v_report);
  return v_report || jsonb_build_object('alreadyApplied', false);
end $$;


create or replace function public.purge_handover(p_event_id uuid, p_handover_id uuid, p_actor_profile_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers;
  v_replay boolean := session_user = 'baton_restore';
begin
  -- QA-L2: who is asking is settled before anything is read.
  if not v_replay then
    if p_actor_profile_id is null then
      -- the retention sweep only: no user session, no client API role
      if auth.uid() is not null or coalesce(current_setting('role', true), '') in ('anon', 'authenticated') then
        raise exception 'the actor-less purge is reserved for the retention sweep' using errcode = 'BTFB0';
      end if;
    else
      perform public._require_actor(p_actor_profile_id);
    end if;
  end if;

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
