-- Read API behind BatonQueries (§11.6). Every function is SECURITY INVOKER: rows, counts and aggregates
-- come only from what the viewer's RLS allows (§8.5). Output is snake_case JSON; lib/db/mappers.ts maps
-- it to the canonical camelCase DTOs, so raw rows never reach UI code (§2).
-- A NULL result means "not visible" and becomes not_found in lib/db.

create function public.api_list_my_handovers()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'title', h.title, 'team_name', h.team_name, 'role_title', h.role_title, 'state', h.state,
           'viewer_role', m.role, 'viewer_is_creator', h.created_by = auth.uid(), 'viewer_clearance', m.clearance,
           -- R8: an open creatorship offer, for the creator and the offered member only (§12.9). It lapses
           -- after 14 days or when the offered member is removed. Under RLS other members cannot see the
           -- offered member's row, so they get NULL.
           'pending_creator_transfer', (
             select jsonb_build_object('to_member_id', om.id, 'offered_at', h.creator_transfer_offered_at)
               from public.handover_members om
              where om.id = h.pending_creator_member_id and om.removed_at is null
                and h.creator_transfer_offered_at >= now() - interval '14 days'
                and (h.created_by = auth.uid() or om.profile_id = auth.uid())),
           'current_publication_id', h.current_publication_id, 'created_at', h.created_at, 'updated_at', h.updated_at)
         order by h.updated_at desc, h.id), '[]'::jsonb)
    from public.handovers h
    join public.handover_members m on m.handover_id = h.id and m.profile_id = auth.uid() and m.removed_at is null
   where h.deleted_at is null
$$;

create function public.api_get_handover(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'id', h.id, 'title', h.title, 'team_name', h.team_name, 'role_title', h.role_title, 'state', h.state,
           'viewer_role', m.role, 'viewer_is_creator', h.created_by = auth.uid(), 'viewer_clearance', m.clearance,
           -- R8: an open creatorship offer, for the creator and the offered member only (§12.9). It lapses
           -- after 14 days or when the offered member is removed. Under RLS other members cannot see the
           -- offered member's row, so they get NULL.
           'pending_creator_transfer', (
             select jsonb_build_object('to_member_id', om.id, 'offered_at', h.creator_transfer_offered_at)
               from public.handover_members om
              where om.id = h.pending_creator_member_id and om.removed_at is null
                and h.creator_transfer_offered_at >= now() - interval '14 days'
                and (h.created_by = auth.uid() or om.profile_id = auth.uid())),
           'current_publication_id', h.current_publication_id, 'created_at', h.created_at, 'updated_at', h.updated_at)
    from public.handovers h
    join public.handover_members m on m.handover_id = h.id and m.profile_id = auth.uid() and m.removed_at is null
   where h.id = p_handover_id and h.deleted_at is null
$$;

create function public.api_list_members(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when public.is_member(p_handover_id) then coalesce((
    select jsonb_agg(jsonb_build_object('id', d.member_id, 'display_name', d.display_name, 'role', d.role,
                                        'clearance', d.clearance, 'ack_required', d.ack_required,
                                        'is_creator', d.is_creator, 'is_viewer', d.profile_id = auth.uid())
                     order by d.role, d.display_name, d.member_id)
      from public.handover_member_directory d
     where d.handover_id = p_handover_id and not d.removed), '[]'::jsonb) end
$$;

create function public._source_json(s public.sources)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'handover_id', s.handover_id, 'kind', s.kind, 'title', s.title, 'state', s.state,
    'access_level', s.access_level, 'size_bytes', s.size_bytes, 'consent_recorded_at', s.consent_recorded_at,
    'raw_deleted_at', s.raw_deleted_at, 'first_message_at', s.first_message_at, 'last_message_at', s.last_message_at,
    'message_count', s.message_count, 'masking_counts', s.masking_counts, 'error_code', s.error_code)
$$;

create function public.api_list_sources(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when public.is_member(p_handover_id) then coalesce((
    select jsonb_agg(public._source_json(s) order by s.created_at, s.id)
      from public.sources s where s.handover_id = p_handover_id and s.deleted_at is null), '[]'::jsonb) end
$$;

create function public.api_get_processing_status(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'handover_state', h.state,
    'run', (
      select jsonb_build_object(
        'id', r.id, 'status', r.status, 'started_at', r.started_at, 'finished_at', r.finished_at,
        'error', case when r.error_code is not null
                      then jsonb_build_object('code', r.error_code, 'message', coalesce(r.error_message, '')) end,
        'stages', coalesce((
          select jsonb_agg(jsonb_build_object('stage', st.stage, 'status', st.status, 'done', st.done, 'total', st.total)
                           order by array_position(array['parse','extract','verify_quotes','verify_support','analyze','prepare_review'], st.stage))
            from (
              select j.stage,
                     case when bool_or(j.status = 'running') then 'running'
                          when bool_or(j.status = 'failed') then 'failed'
                          when bool_and(j.status = 'succeeded') then 'succeeded'
                          when bool_or(j.status = 'cancelled') then 'cancelled'
                          else 'queued' end as status,
                     count(*) filter (where j.status = 'succeeded') as done,
                     count(*) as total
                from public.processing_jobs j where j.run_id = r.id group by j.stage
            ) st), '[]'::jsonb))
        from public.processing_runs r where r.handover_id = h.id
       order by r.created_at desc, r.id limit 1),
    'sources', public.api_list_sources(h.id))
  from public.handovers h where h.id = p_handover_id
$$;

create function public.api_list_points(
  p_handover_id uuid, p_category text default null, p_status text default null, p_review_state text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when public.is_member(p_handover_id) then coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'category', p.category, 'title', r.title, 'statement', r.statement,
             'evidence_status', p.evidence_status, 'review_state', p.review_state, 'access_level', p.access_level,
             'is_potentially_outdated', p.is_potentially_outdated, 'origin', p.origin,
             -- visible evidence only: point_evidence and evidence_quotes are both RLS-filtered
             'evidence_count', (select count(*) from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                                 where pe.point_id = p.id),
             'privacy_review', p.privacy_review, 'last_supported_at', p.last_supported_at, 'updated_at', p.updated_at)
           order by p.sort_key, p.id)
      from public.handover_points p
      join public.point_revisions r on r.id = p.current_revision_id
     where p.handover_id = p_handover_id
       and (p_category is null or p.category = p_category)
       and (p_status is null or p.evidence_status = p_status)
       and (p_review_state is null or p.review_state = p_review_state)), '[]'::jsonb) end
$$;

create function public.api_get_point(p_point_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'category', p.category, 'title', r.title, 'statement', r.statement,
    'evidence_status', p.evidence_status, 'review_state', p.review_state, 'access_level', p.access_level,
    'is_potentially_outdated', p.is_potentially_outdated, 'origin', p.origin,
    'evidence_count', (select count(*) from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                        where pe.point_id = p.id),
    'privacy_review', p.privacy_review, 'last_supported_at', p.last_supported_at, 'updated_at', p.updated_at,
    'current_revision_id', p.current_revision_id, 'revision_number', r.revision_number, 'attributes', r.attributes,
    'inference_rationale', p.inference_rationale,
    'privacy_review_flagged_at', case when p.privacy_review = 'required' then p.privacy_review_flagged_at end,
    'privacy_review_reason', case when p.privacy_review = 'required' then (
        select ra.metadata ->> 'reason' from public.review_actions ra
         where ra.point_id = p.id and ra.action = 'privacy_hold' order by ra.created_at desc, ra.id desc limit 1) end,
    'privacy_review_set', public.get_privacy_review(p.id),
    'inferred_confirmation', case when p.inferred_confirmed_at is not null then jsonb_build_object(
        'by', coalesce(public.member_label(p.handover_id, p.inferred_confirmed_by), 'Former member'),
        'at', p.inferred_confirmed_at) end,
    'conflict_resolution', case when p.conflict_resolution_note is not null then jsonb_build_object(
        'note', p.conflict_resolution_note,
        'by', coalesce(public.member_label(p.handover_id, p.conflict_resolved_by), 'Former member'),
        'at', p.conflict_resolved_at) end,
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'point_evidence_id', pe.id, 'evidence_id', q.id, 'kind', q.kind, 'quote', q.quote_text,
               'author_label', q.author_label,
               'sent_at', coalesce(q.message_sent_at, case when q.kind = 'testimony' then q.created_at end),
               'source_title', q.source_title, 'location', q.location, 'quote_check', q.quote_check,
               'support_verdict', pe.support_verdict, 'verdict_rationale', pe.verdict_rationale,
               'is_current_revision_verdict', pe.verified_revision_id is not distinct from p.current_revision_id
                                               and pe.support_verdict <> 'unchecked',
               'excluded', pe.excluded_at is not null, 'exclusion_reason', pe.exclusion_reason,
               'access_level', q.access_level)
             order by coalesce(q.message_sent_at, case when q.kind = 'testimony' then q.created_at end) desc nulls last, pe.id)
        from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
       where pe.point_id = p.id), '[]'::jsonb),
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', rv.id, 'number', rv.revision_number, 'title', rv.title, 'statement', rv.statement,
               'attributes', rv.attributes, 'edit_reason', rv.edit_reason,
               'author_label', case when rv.author_profile_id is not null
                                    then coalesce(public.member_label(p.handover_id, rv.author_profile_id), 'Former member') end,
               'created_at', rv.created_at, 'redaction', rv.redaction_kind)
             order by rv.revision_number)
        from public.point_revisions rv where rv.point_id = p.id), '[]'::jsonb),
    'review_history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'action', ra.action,
               'actor_label', case when ra.actor_profile_id is not null
                                   then coalesce(public.member_label(p.handover_id, ra.actor_profile_id), 'Former member') end,
               'note', ra.note, 'created_at', ra.created_at)
             order by ra.created_at, ra.id)
        from public.review_actions ra where ra.point_id = p.id), '[]'::jsonb))
  from public.handover_points p
  join public.point_revisions r on r.id = p.current_revision_id
  where p.id = p_point_id
$$;

create function public.api_list_gap_questions(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when public.is_member(p_handover_id) then coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id, 'point_id', q.point_id, 'category', q.category, 'question', q.question, 'context', q.context,
             'priority', q.priority, 'status', q.status,
             -- held questions never reach other members at all (RLS), so this is false for them
             'privacy_held', public.is_review_role(p_handover_id) and public.gap_question_privacy_held(q.id),
             'answers', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', a.id, 'answerer_label', a.answerer_label, 'text', a.answer_text, 'status', a.status,
                        'privacy_held', public.is_review_role(p_handover_id) and public.gap_answer_privacy_held(a.id),
                        'created_at', a.created_at) order by a.created_at, a.id)
                 from public.gap_answers a where a.gap_question_id = q.id), '[]'::jsonb))
           order by q.sort_key nulls last, q.created_at, q.id)
      from public.gap_questions q where q.handover_id = p_handover_id), '[]'::jsonb) end
$$;

create function public.api_get_readiness(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select public.readiness_report(p_handover_id) $$;

create function public.api_get_published_handover(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'handover_id', h.id, 'title', h.title, 'team_name', h.team_name, 'role_title', h.role_title,
    'publication_id', pub.id, 'version', pub.version, 'published_at', pub.published_at,
    'published_by_label', coalesce(public.member_label(h.id, pub.published_by), 'Former member'),
    'summary', pub.summary,
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('category', sec.category, 'points', sec.points)
                       order by array_position(array['decision','owner','open_task','blocker','risk','dependency',
                                                     'recurring_problem','contact','next_action','account_access'], sec.category))
        from (
          select pp.category,
                 jsonb_agg(jsonb_build_object('id', pp.point_id, 'content', pp.content) order by pp.sort_key nulls last, pp.id) as points
            from public.publication_points pp -- RLS: clearance, not redacted, not privacy-held
           where pp.publication_id = pub.id
           group by pp.category
        ) sec), '[]'::jsonb),
    'viewer_acknowledged_at', (
      select max(a.acknowledged_at) from public.acknowledgements a
       where a.publication_id = pub.id and a.profile_id = auth.uid() and a.invalidated_at is null))
  from public.handovers h
  join public.handover_publications pub on pub.id = h.current_publication_id
  where h.id = p_handover_id and h.deleted_at is null
$$;

-- ── R8 read API (§11.6, BatonQueries) ────────────────────────────────────────

-- Review roles, within clearance (source_participants RLS). The identity hash is never returned. A
-- p_source_id that is not a visible source of the handover is not_found.
create function public.api_list_participants(p_handover_id uuid, p_source_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when not public.is_review_role(p_handover_id) then null
    when p_source_id is not null and not exists (
      select 1 from public.sources s
       where s.id = p_source_id and s.handover_id = p_handover_id and s.deleted_at is null) then null
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sp.id, 'source_id', sp.source_id, 'source_title', s.title, 'local_id', sp.local_id,
               'display_label', sp.display_label, 'identity_kind', sp.identity_kind,
               'message_count', coalesce(sp.message_count, 0), 'excluded', sp.excluded)
             order by s.created_at, s.id, length(sp.local_id), sp.local_id)
        from public.source_participants sp
        join public.sources s on s.id = sp.source_id
       where sp.handover_id = p_handover_id and s.deleted_at is null
         and (p_source_id is null or sp.source_id = p_source_id)), '[]'::jsonb)
  end
$$;

-- Review roles (source_exclusions RLS). Never the identity hash.
create function public.api_list_exclusions(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when public.is_review_role(p_handover_id) then coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'kind', e.kind, 'scope', case when e.source_id is null then 'handover' else 'source' end,
             'source_id', e.source_id, 'identity_kind', e.participant_identity_kind,
             'conversation_local_id', e.conversation_local_id, 'range_start', e.range_start, 'range_end', e.range_end,
             'reason', e.reason, 'requested_via', e.requested_via, 'created_at', e.created_at)
           order by e.created_at, e.id)
      from public.source_exclusions e
     where e.handover_id = p_handover_id), '[]'::jsonb) end
$$;

-- Messages around one quoted message (§11.6 SourceMessageContext). Review roles within clearance: the
-- link (point_evidence), the quote (evidence_quotes) and the messages (source_messages) are each
-- RLS-filtered. Testimony and quotes whose source was purged are not_found. A pruned or erased quoted
-- message, or a removed source, gives available = false and no messages. Each side is clamped to 0–10.
create function public.api_get_source_message_context(p_point_evidence_id uuid, p_before int default 3, p_after int default 3)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_before int := greatest(0, least(10, coalesce(p_before, 3)));
  v_after int := greatest(0, least(10, coalesce(p_after, 3)));
  v_q record;
  v_title text;
  v_deleted timestamptz;
  v_m public.source_messages;
  v_messages jsonb := '[]'::jsonb;
  v_min int;
  v_max int;
  v_more_before boolean := false;
  v_more_after boolean := false;
begin
  -- explicit columns: clients have no SELECT on the identity-hash columns (grants migration)
  select q.kind, q.source_id, q.source_message_id, q.source_title into v_q
    from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
   where pe.id = p_point_evidence_id;
  if not found or v_q.kind <> 'source_quote' or v_q.source_id is null then
    return null;
  end if;
  select s.title, s.deleted_at into v_title, v_deleted from public.sources s where s.id = v_q.source_id;
  if v_q.source_message_id is not null and v_deleted is null then
    select * into v_m from public.source_messages m where m.id = v_q.source_message_id;
  end if;

  if v_m.id is not null then
    with win as (
      (select m.* from public.source_messages m
        where m.source_id = v_m.source_id and m.conversation_id is not distinct from v_m.conversation_id and m.seq < v_m.seq
        order by m.seq desc limit v_before)
      union all
      select m.* from public.source_messages m where m.id = v_m.id
      union all
      (select m.* from public.source_messages m
        where m.source_id = v_m.source_id and m.conversation_id is not distinct from v_m.conversation_id and m.seq > v_m.seq
        order by m.seq limit v_after)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'seq', w.seq, 'sent_at', w.sent_at, 'author_label', sp.display_label, 'kind', w.kind, 'body', w.body,
             'location', w.location, 'is_quoted', w.id = v_m.id) order by w.seq), '[]'::jsonb),
           min(w.seq), max(w.seq)
      into v_messages, v_min, v_max
      from win w left join public.source_participants sp on sp.id = w.participant_id;
    v_more_before := exists (select 1 from public.source_messages m where m.source_id = v_m.source_id
                               and m.conversation_id is not distinct from v_m.conversation_id and m.seq < v_min);
    v_more_after := exists (select 1 from public.source_messages m where m.source_id = v_m.source_id
                              and m.conversation_id is not distinct from v_m.conversation_id and m.seq > v_max);
  end if;

  return jsonb_build_object(
    'point_evidence_id', p_point_evidence_id, 'source_id', v_q.source_id,
    'source_title', coalesce(v_title, v_q.source_title, ''), 'available', v_m.id is not null,
    'messages', v_messages, 'has_more_before', v_more_before, 'has_more_after', v_more_after);
end $$;

-- Open creatorship offers addressed to the signed-in user (/account, §12.9). Lapsed offers (14 days) and
-- offers to a removed membership are not listed.
create function public.api_list_my_creator_transfer_offers()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'handover_id', h.id, 'handover_title', h.title,
           'offered_by_label', coalesce(public.member_label(h.id, h.created_by), 'Former member'),
           'offered_at', h.creator_transfer_offered_at)
         order by h.creator_transfer_offered_at desc, h.id), '[]'::jsonb)
    from public.handovers h
    join public.handover_members m
      on m.id = h.pending_creator_member_id and m.profile_id = auth.uid() and m.removed_at is null
   where h.deleted_at is null and h.creator_transfer_offered_at >= now() - interval '14 days'
$$;
