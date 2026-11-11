-- Review actions (§5), manual points, gap questions and answers (§6.15, §6.16) and pipeline write paths.
-- All of these are child-row-only writers: they take FOR SHARE on the handover first (§5.5 item 2).
-- Text arguments must already be masked by the server (§12.1); the database never sees unmasked input.

-- ── Review helpers ───────────────────────────────────────────────────────────

-- Locks the handover FOR SHARE, then the point FOR UPDATE, and checks visibility and lifecycle.
create function public._review_prelude(p_actor_profile_id uuid, p_point_id uuid, p_action text)
returns public.handover_points
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_h public.handovers;
  v_p public.handover_points;
begin
  perform public._require_actor(p_actor_profile_id);
  select handover_id into v_handover from public.handover_points where id = p_point_id;
  if v_handover is null then
    raise exception 'point not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_share(v_handover);
  select * into v_p from public.handover_points where id = p_point_id for update;
  -- Hidden by access level, erased, or not a review role: all indistinguishable from "missing" (§8.5).
  if not public._point_visible_as(p_actor_profile_id, p_point_id) then
    raise exception 'point not found' using errcode = 'BTNF0';
  end if;
  if p_action <> 'change_access' and v_h.state <> 'in_review' then
    raise exception 'points can be reviewed only while the handover is in review' using errcode = 'BTIT0';
  end if;
  -- §5.5: the point is frozen while its privacy review is required.
  if v_p.privacy_review = 'required' and p_action <> 'change_access' then
    raise exception 'point is held for privacy review' using errcode = 'BTPF0';
  end if;
  return v_p;
end $$;

create function public._record_review_action(
  p_point public.handover_points, p_actor uuid, p_action text, p_from text, p_to text,
  p_note text, p_metadata jsonb, p_link_id uuid default null, p_revision_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action_id uuid;
begin
  insert into public.review_actions (handover_id, point_id, revision_id, point_evidence_id, actor_profile_id, action,
                                     from_review_state, to_review_state, note, metadata)
  values (p_point.handover_id, p_point.id, coalesce(p_revision_id, p_point.current_revision_id), p_link_id, p_actor, p_action,
          p_from, p_to, nullif(btrim(p_note), ''), p_metadata)
  returning id into v_action_id;
  -- Audit is structural only (§12.7): never the note.
  perform public._audit(p_point.handover_id, p_actor, null, 'point.review.' || p_action, 'point', p_point.id,
                        jsonb_build_object('reviewState', p_from),
                        coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('reviewState', p_to, 'reviewActionId', v_action_id));
end $$;

-- ── Review actions (§5.2–§5.4) ───────────────────────────────────────────────

create function public.approve_point(p_actor_profile_id uuid, 
  p_point_id uuid, p_expected_revision_id uuid, p_confirm_inferred boolean default false,
  p_resolution_note text default null, p_as_known_gap boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'approve');
begin
  if v_p.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'the point changed since it was loaded' using errcode = 'BTCF0';
  end if;
  if v_p.review_state <> 'pending' then
    raise exception 'only pending points can be approved' using errcode = 'BTIT0';
  end if;

  if v_p.evidence_status = 'inferred' then
    if not coalesce(p_confirm_inferred, false) then
      raise exception 'inferred points must be confirmed to be approved' using errcode = 'BTPF0';
    end if;
    update public.handover_points set inferred_confirmed_by = v_actor, inferred_confirmed_at = now() where id = p_point_id;
  elsif v_p.evidence_status = 'conflicting' then
    if coalesce(btrim(p_resolution_note), '') = '' then
      raise exception 'conflicting points need a resolution note' using errcode = 'BTPF0';
    end if;
    update public.handover_points
       set conflict_resolution_note = btrim(p_resolution_note), conflict_resolved_by = v_actor, conflict_resolved_at = now()
     where id = p_point_id;
  elsif v_p.evidence_status = 'missing' then
    if not coalesce(p_as_known_gap, false) then
      raise exception 'missing points can only be approved as known gaps' using errcode = 'BTPF0';
    end if;
    update public.handover_points set approved_as_known_gap = true where id = p_point_id;
  end if;

  update public.handover_points set review_state = 'approved' where id = p_point_id;
  perform public._record_review_action(v_p, v_actor, 'approve', 'pending', 'approved',
    case when v_p.evidence_status = 'conflicting' then p_resolution_note end,
    jsonb_build_object('evidenceStatus', v_p.evidence_status, 'asKnownGap', v_p.evidence_status = 'missing'));
end $$;

create function public.reject_point(p_actor_profile_id uuid, p_point_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'reject');
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required' using errcode = 'BTVF0';
  end if;
  if v_p.review_state = 'rejected' then
    raise exception 'point is already rejected' using errcode = 'BTIT0';
  end if;
  update public.handover_points set review_state = 'rejected', approved_as_known_gap = false where id = p_point_id;
  perform public._record_review_action(v_p, v_actor, 'reject', v_p.review_state, 'rejected', p_reason, null);
end $$;

create function public.reopen_point(p_actor_profile_id uuid, p_point_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'reopen');
begin
  if v_p.review_state = 'pending' then
    raise exception 'point is already pending' using errcode = 'BTIT0';
  end if;
  update public.handover_points set review_state = 'pending', approved_as_known_gap = false where id = p_point_id;
  perform public._record_review_action(v_p, v_actor, 'reopen', v_p.review_state, 'pending', p_note, null);
end $$;

-- Attributes are validated per category by the caller (parsePointAttributes, §11.5) and masked (§12.1).
create function public.edit_point(p_actor_profile_id uuid, 
  p_point_id uuid, p_expected_revision_id uuid, p_title text, p_statement text, p_attributes jsonb, p_edit_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'edit');
  v_rev uuid;
  v_to text;
begin
  if v_p.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'the point changed since it was loaded' using errcode = 'BTCF0';
  end if;
  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_statement), '') = '' or coalesce(btrim(p_edit_reason), '') = ''
     or jsonb_typeof(p_attributes) is distinct from 'object' then
    raise exception 'title, statement, attributes and reason are required' using errcode = 'BTVF0';
  end if;

  insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes,
                                      author_kind, author_profile_id, edit_reason)
  select v_p.handover_id, p_point_id, max(r.revision_number) + 1, btrim(p_title), btrim(p_statement), p_attributes,
         'profile', v_actor, btrim(p_edit_reason)
    from public.point_revisions r where r.point_id = p_point_id
  returning id into v_rev;

  v_to := case when v_p.review_state = 'approved' then 'pending' else v_p.review_state end;
  update public.handover_points
     set current_revision_id = v_rev, review_state = v_to,
         approved_as_known_gap = case when v_to = 'pending' then false else approved_as_known_gap end
   where id = p_point_id;
  perform public._record_review_action(v_p, v_actor, 'edit', v_p.review_state, v_to, p_edit_reason,
                                       jsonb_build_object('newRevisionId', v_rev), null, v_rev);
  return v_rev;
end $$;

create function public.confirm_inferred(p_actor_profile_id uuid, p_point_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'confirm_inferred');
begin
  if v_p.evidence_status <> 'inferred' then
    raise exception 'only inferred points can be confirmed' using errcode = 'BTIT0';
  end if;
  update public.handover_points set inferred_confirmed_by = v_actor, inferred_confirmed_at = now() where id = p_point_id;
  perform public._record_review_action(v_p, v_actor, 'confirm_inferred', v_p.review_state, v_p.review_state, p_note, null);
end $$;

create function public.resolve_conflict(p_actor_profile_id uuid, p_point_id uuid, p_resolution_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'resolve_conflict');
begin
  if v_p.evidence_status <> 'conflicting' then
    raise exception 'only conflicting points can be resolved' using errcode = 'BTIT0';
  end if;
  if coalesce(btrim(p_resolution_note), '') = '' then
    raise exception 'a resolution note is required' using errcode = 'BTVF0';
  end if;
  update public.handover_points
     set conflict_resolution_note = btrim(p_resolution_note), conflict_resolved_by = v_actor, conflict_resolved_at = now()
   where id = p_point_id;
  perform public._record_review_action(v_p, v_actor, 'resolve_conflict', v_p.review_state, v_p.review_state, p_resolution_note, null);
end $$;

create function public.exclude_evidence(p_actor_profile_id uuid, p_point_id uuid, p_point_evidence_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'exclude_evidence');
  v_link public.point_evidence;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required' using errcode = 'BTVF0';
  end if;
  select * into v_link from public.point_evidence where id = p_point_evidence_id and point_id = p_point_id for update;
  if not found then
    raise exception 'evidence not found' using errcode = 'BTNF0';
  end if;
  if v_link.excluded_at is not null then
    raise exception 'evidence is already excluded' using errcode = 'BTIT0';
  end if;
  update public.point_evidence
     set excluded_at = now(), excluded_by = v_actor, exclusion_reason = btrim(p_reason)
   where id = p_point_evidence_id;
  perform public._record_review_action(v_p, v_actor, 'exclude_evidence', v_p.review_state,
    (select review_state from public.handover_points where id = p_point_id), p_reason, null, p_point_evidence_id);
end $$;

create function public.restore_evidence(p_actor_profile_id uuid, p_point_id uuid, p_point_evidence_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'restore_evidence');
  v_link public.point_evidence;
begin
  select * into v_link from public.point_evidence where id = p_point_evidence_id and point_id = p_point_id for update;
  if not found then
    raise exception 'evidence not found' using errcode = 'BTNF0';
  end if;
  if v_link.excluded_at is null then
    raise exception 'evidence is not excluded' using errcode = 'BTIT0';
  end if;
  if exists (select 1 from public.evidence_quotes q left join public.sources s on s.id = q.source_id
             where q.id = v_link.evidence_id and q.kind = 'source_quote' and (s.id is null or s.deleted_at is not null)) then
    raise exception 'evidence from a removed source cannot be restored' using errcode = 'BTPF0';
  end if;
  update public.point_evidence set excluded_at = null, excluded_by = null, exclusion_reason = null where id = p_point_evidence_id;
  perform public._record_review_action(v_p, v_actor, 'restore_evidence', v_p.review_state,
    (select review_state from public.handover_points where id = p_point_id), null, null, p_point_evidence_id);
end $$;

-- p_access_override NULL returns the point to its evidence floor. While a privacy review is required,
-- the resulting level may only go up (§5.5).
create function public.change_point_access(p_actor_profile_id uuid, p_point_id uuid, p_access_override text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'change_access');
  v_new_level text;
begin
  if p_access_override is not null and public.access_rank(p_access_override) is null then
    raise exception 'unknown access level' using errcode = 'BTVF0';
  end if;
  v_new_level := public.max_access(v_p.access_floor, p_access_override);
  if v_p.privacy_review = 'required' and public.access_rank(v_new_level) < public.access_rank(v_p.access_level) then
    raise exception 'access can only be raised during a privacy review' using errcode = 'BTPF0';
  end if;
  update public.handover_points set access_override = p_access_override where id = p_point_id;
  perform public._record_review_action(v_p, v_actor, 'change_access', v_p.review_state, v_p.review_state, null,
    jsonb_build_object('fromAccess', v_p.access_level, 'toAccess', v_new_level));
end $$;

-- ── Manual points (createManualPoint, §11.3) ─────────────────────────────────
-- NOTE: CreateManualPointInput is referenced in §11.3 but not defined in lib/contracts; the parameters
-- below follow §3.1, §6.10 and §8.4 and must be confirmed by main.

create function public.create_manual_point(p_actor_profile_id uuid, 
  p_handover_id uuid, p_category text, p_title text, p_statement text, p_attributes jsonb,
  p_inference_rationale text default null, p_access_override text default null,
  p_testimony_text text default null, p_testimony_access_level text default 'everyone'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_point uuid;
  v_rev uuid;
  v_quote uuid;
begin
  v_h := public._lock_handover_for_share(p_handover_id);
  if not public._is_review_role_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if v_h.state <> 'in_review' then
    raise exception 'points can be added only while the handover is in review' using errcode = 'BTIT0';
  end if;
  if coalesce(btrim(p_title), '') = '' or coalesce(btrim(p_statement), '') = '' or jsonb_typeof(p_attributes) is distinct from 'object' then
    raise exception 'title, statement and attributes are required' using errcode = 'BTVF0';
  end if;

  insert into public.handover_points (handover_id, category, origin, inference_rationale, access_override, sort_key)
  values (p_handover_id, p_category, 'manual', nullif(btrim(p_inference_rationale), ''), p_access_override,
          coalesce((select max(sort_key) from public.handover_points where handover_id = p_handover_id), 0) + 1)
  returning id into v_point;
  insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind, author_profile_id)
  values (p_handover_id, v_point, 1, btrim(p_title), btrim(p_statement), p_attributes, 'profile', v_actor)
  returning id into v_rev;
  update public.handover_points set current_revision_id = v_rev where id = v_point;

  if coalesce(btrim(p_testimony_text), '') <> '' then
    insert into public.evidence_quotes (handover_id, kind, stated_by_profile_id, quote_text, author_label, quote_check, access_level)
    values (p_handover_id, 'testimony', v_actor, btrim(p_testimony_text),
            public._handover_label(p_handover_id, v_actor), 'exact', coalesce(p_testimony_access_level, 'everyone'))
    returning id into v_quote;
    insert into public.point_evidence (handover_id, point_id, evidence_id) values (p_handover_id, v_point, v_quote);
  end if;

  perform public._audit(p_handover_id, v_actor, null, 'point.created', 'point', v_point, null,
                        jsonb_build_object('origin', 'manual', 'category', p_category));
  return v_point;
end $$;

-- ── Gap questions ────────────────────────────────────────────────────────────

create function public._insert_gap_question(
  p_handover_id uuid, p_point_id uuid, p_category text, p_question text, p_context text, p_priority text,
  p_access_level text, p_assigned_member_id uuid, p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_point_id is not null then
    if not exists (select 1 from public.handover_points where id = p_point_id and handover_id = p_handover_id and erased_at is null) then
      raise exception 'point not found' using errcode = 'BTNF0';
    end if;
    if exists (select 1 from public.handover_points where id = p_point_id and privacy_review = 'required') then
      raise exception 'point is held for privacy review' using errcode = 'BTPF0';
    end if;
  end if;
  if p_assigned_member_id is not null and not exists (
    select 1 from public.handover_members where id = p_assigned_member_id and handover_id = p_handover_id and removed_at is null
  ) then
    raise exception 'member not found' using errcode = 'BTNF0';
  end if;
  if coalesce(btrim(p_question), '') = '' then
    raise exception 'question text is required' using errcode = 'BTVF0';
  end if;
  insert into public.gap_questions (handover_id, point_id, assigned_member_id, created_by, category, question, context,
                                    priority, access_level, sort_key)
  values (p_handover_id, p_point_id, p_assigned_member_id, p_created_by,
          -- a point question always takes the point's category (S10); otherwise the given one
          case when p_point_id is not null then (select category from public.handover_points where id = p_point_id)
               else p_category end,
          btrim(p_question), nullif(btrim(p_context), ''), p_priority, coalesce(p_access_level, 'everyone'),
          coalesce((select max(sort_key) from public.gap_questions where handover_id = p_handover_id), 0) + 1)
  returning id into v_id;
  return v_id;
end $$;

-- createGapQuestionInput (schemas.ts, R8).
create function public.create_gap_question(p_actor_profile_id uuid, 
  p_handover_id uuid, p_point_id uuid, p_category text, p_question text, p_context text,
  p_priority text, p_access_level text default 'everyone', p_assigned_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_id uuid;
begin
  -- createGapQuestionInput (R8, S10): a question about a point takes the point's category; never both.
  if p_point_id is not null and p_category is not null then
    raise exception 'a question about a point takes the point''s category' using errcode = 'BTVF0';
  end if;
  perform public._lock_handover_for_share(p_handover_id);
  if not public._is_review_role_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if p_point_id is not null and not public._point_visible_as(v_actor, p_point_id) then
    raise exception 'point not found' using errcode = 'BTNF0';
  end if;
  v_id := public._insert_gap_question(p_handover_id, p_point_id, p_category, p_question, p_context, p_priority,
                                      p_access_level, p_assigned_member_id, v_actor);
  perform public._audit(p_handover_id, v_actor, null, 'gap_question.created', 'gap_question', v_id, null,
                        jsonb_build_object('priority', p_priority));
  return v_id;
end $$;

-- Worker (service_role): prepare_review creates questions for missing points (§10.10).
create function public.create_system_gap_question(
  p_handover_id uuid, p_point_id uuid, p_category text, p_question text, p_context text, p_priority text, p_access_level text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._lock_handover_for_share(p_handover_id);
  perform public._require_active_run(p_handover_id); -- N3: prepare_review runs inside a run
  return public._insert_gap_question(p_handover_id, p_point_id, p_category, p_question, p_context, p_priority,
                                     p_access_level, null, null);
end $$;

-- ── Gap answers ──────────────────────────────────────────────────────────────

-- In-app answers. p_answers: [{ "gapQuestionId": uuid, "answerText": masked text }], one handover.
create function public.submit_gap_answers(p_actor_profile_id uuid, p_answers jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_handover uuid;
  v_label text;
  v_item jsonb;
  v_q uuid;
  v_n int := 0;
begin
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) = 0 then
    raise exception 'at least one answer is required' using errcode = 'BTVF0';
  end if;
  select q.handover_id into v_handover from public.gap_questions q
   where q.id = (p_answers -> 0 ->> 'gapQuestionId')::uuid;
  if v_handover is null then
    raise exception 'question not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_handover);
  v_label := public._handover_label(v_handover, v_actor); -- N6

  for v_item in select * from jsonb_array_elements(p_answers) loop
    v_q := (v_item ->> 'gapQuestionId')::uuid;
    -- Unknown, other handover, not assigned, above clearance, closed or held: the same not_found (§8.5).
    if not exists (select 1 from public.gap_questions q where q.id = v_q and q.handover_id = v_handover)
       or not public._gap_question_answerable(v_q)
       or not (
         public._gap_question_visible_as(v_actor, v_q)
         or (public._is_review_role_as(v_actor, v_handover)
             and exists (select 1 from public.gap_questions q where q.id = v_q and public._within_clearance_as(v_actor, v_handover, q.access_level)))
       ) then
      raise exception 'question not found' using errcode = 'BTNF0';
    end if;
    if coalesce(btrim(v_item ->> 'answerText'), '') = '' then
      raise exception 'answer text is required' using errcode = 'BTVF0';
    end if;
    insert into public.gap_answers (handover_id, gap_question_id, answered_by_profile_id, answer_text, answerer_label)
    values (v_handover, v_q, v_actor, btrim(v_item ->> 'answerText'), v_label);
    v_n := v_n + 1;
  end loop;
  perform public._audit(v_handover, v_actor, null, 'gap_answer.submitted', 'handover', v_handover, null,
                        jsonb_build_object('answers', v_n));
  return v_n;
end $$;

create function public.review_gap_answer(p_actor_profile_id uuid, p_answer_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_a public.gap_answers;
  v_q public.gap_questions;
  v_quote uuid;
begin
  select * into v_a from public.gap_answers where id = p_answer_id;
  if not found then
    raise exception 'answer not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_a.handover_id);
  select * into v_q from public.gap_questions where id = v_a.gap_question_id for update;
  select * into v_a from public.gap_answers where id = p_answer_id for update;
  if not (public._is_review_role_as(v_actor, v_a.handover_id) and public._within_clearance_as(v_actor, v_a.handover_id, v_q.access_level)) then
    raise exception 'answer not found' using errcode = 'BTNF0';
  end if;
  if public.gap_answer_privacy_held(p_answer_id) then
    raise exception 'answer is held for privacy review' using errcode = 'BTPF0';
  end if;
  if v_a.status <> 'submitted' then
    raise exception 'answer was already reviewed' using errcode = 'BTIT0';
  end if;
  if p_decision not in ('accept', 'reject') then
    raise exception 'decision must be accept or reject' using errcode = 'BTVF0';
  end if;

  update public.gap_answers
     set status = case when p_decision = 'accept' then 'accepted' else 'rejected' end,
         reviewed_by = v_actor, reviewed_at = now(), review_note = nullif(btrim(p_note), '')
   where id = p_answer_id;

  if p_decision = 'accept' then
    -- §6.16: testimony (text and access copied by trigger) plus an unchecked link; verify_support follows (D16).
    insert into public.evidence_quotes (handover_id, kind, gap_answer_id, quote_text, author_label, quote_check, access_level)
    values (v_a.handover_id, 'testimony', p_answer_id, v_a.answer_text, v_a.answerer_label, 'exact', v_q.access_level)
    returning id into v_quote;
    if v_q.point_id is not null then
      insert into public.point_evidence (handover_id, point_id, evidence_id) values (v_a.handover_id, v_q.point_id, v_quote);
    end if;
    update public.gap_questions set status = 'answered' where id = v_q.id and status = 'open';
  end if;

  perform public._audit(v_a.handover_id, v_actor, null, 'gap_answer.' || p_decision || 'ed', 'gap_answer', p_answer_id,
                        jsonb_build_object('status', 'submitted'),
                        jsonb_build_object('status', case when p_decision = 'accept' then 'accepted' else 'rejected' end,
                                           'evidenceId', v_quote));
end $$;

-- ── Pipeline writes (service_role workers; §9.3, §10) ────────────────────────

-- N3: extraction-side writers only act while the handover is processing an active run. Callers hold the
-- handover lock (FOR SHARE) already, so the state cannot change underneath them. Returns the run id.
create function public._require_active_run(p_handover_id uuid, p_run_id uuid default null)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_run uuid;
begin
  if not exists (select 1 from public.handovers where id = p_handover_id and state = 'processing' and deleted_at is null) then
    raise exception 'the handover is not processing' using errcode = 'BTIT0';
  end if;
  select r.id into v_run from public.processing_runs r
   where r.handover_id = p_handover_id and r.status in ('queued', 'running')
     and (p_run_id is null or r.id = p_run_id);
  if v_run is null then
    raise exception 'no active processing run' using errcode = 'BTIT0';
  end if;
  return v_run;
end $$;

create function public.claim_processing_jobs(p_limit int default 5, p_lease_seconds int default 300)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.processing_jobs j
     set status = 'running', attempt = j.attempt + 1, started_at = coalesce(j.started_at, now()),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where j.id in (
     select c.id from public.processing_jobs c
      join public.processing_runs r on r.id = c.run_id
      where r.status in ('queued', 'running')
        and ((c.status = 'queued' and (c.next_attempt_at is null or c.next_attempt_at <= now()))
             or (c.status = 'running' and c.lease_expires_at < now()))
        and c.attempt < c.max_attempts
      order by c.next_attempt_at nulls first, c.id
      limit p_limit
      for update of c skip locked
   )
  returning j.*;
  -- M4: the job rows are locked above, then the run (jobs → run, the order every closer uses too).
  update public.processing_runs r set status = 'running', started_at = coalesce(r.started_at, now())
   where r.status = 'queued' and exists (select 1 from public.processing_jobs j where j.run_id = r.id and j.status = 'running');
end $$;

-- Written when a job is claimed, before the provider is called (§11.8 rule 3).
create function public.set_job_provenance(p_job_id uuid, p_provenance jsonb)
returns void
language sql
security definer
set search_path = ''
as $$ update public.processing_jobs set ai_provenance = p_provenance where id = p_job_id $$;

-- p_outcome: 'succeeded' | 'retry' | 'failed'. p_attempt is a non-sensitive AiAttemptRecord (§11.8).
create function public.record_job_attempt(
  p_job_id uuid, p_outcome text, p_attempt jsonb default null, p_error_code text default null,
  p_error_message text default null, p_next_attempt_at timestamptz default null,
  p_progress_done int default null, p_progress_total int default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'BTNF0';
  end if;
  if p_outcome not in ('succeeded', 'retry', 'failed') then
    raise exception 'unknown outcome' using errcode = 'BTVF0';
  end if;
  update public.processing_jobs
     set attempt_log = case when p_attempt is null then attempt_log else attempt_log || jsonb_build_array(p_attempt) end,
         status = case
           when p_outcome = 'succeeded' then 'succeeded'
           when p_outcome = 'retry' and v_job.attempt < v_job.max_attempts then 'queued'
           else 'failed' end,
         next_attempt_at = case when p_outcome = 'retry' then coalesce(p_next_attempt_at, now()) end,
         lease_expires_at = null,
         error_code = case when p_outcome = 'succeeded' then null else p_error_code end,
         error_message = case when p_outcome = 'succeeded' then null else p_error_message end,
         progress_done = coalesce(p_progress_done, progress_done),
         progress_total = coalesce(p_progress_total, progress_total),
         finished_at = case when p_outcome = 'retry' and v_job.attempt < v_job.max_attempts then null else now() end
   where id = p_job_id;
end $$;

-- Persist a final parse in ONE transaction (§10.3 step 3). p_parsed is a ParsedSource (§11.4) whose
-- identity hashes are hex HMACs made with pepper version p_pepper_version.
-- Defence in depth for the exclusion rules (§6.8, §6.8.1), re-evaluated here under the source lock:
--   * a persisted participant matching an `apply` rule may not keep any message  → conflict;
--   * a persisted participant matching a `detect` rule (a handover-wide NAME exclusion with no decision
--     for this source) means the creator has not decided                          → precondition_failed.
-- Matching needs identity kind, hash AND pepper version to agree (§12.11).
create function public.persist_parsed_source(p_source_id uuid, p_parsed jsonb, p_pepper_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.sources;
  v_n int;
begin
  select * into v_s from public.sources where id = p_source_id;
  if not found or v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_s.handover_id);
  perform public._require_active_run(v_s.handover_id); -- N3
  select * into v_s from public.sources where id = p_source_id for update;
  if v_s.state not in ('uploaded', 'parsing', 'failed') then
    raise exception 'source cannot be parsed from state %', v_s.state using errcode = 'BTIT0';
  end if;
  if p_pepper_version is distinct from 'p1' then
    raise exception 'unsupported identity pepper version' using errcode = 'BTVF0'; -- §12.8 point 9: fail closed
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_parsed -> 'participants', '[]'::jsonb)) p
     where coalesce(p ->> 'identityKind', '') not in ('phone', 'name')
        or coalesce(p ->> 'identityHash', '') !~ '^[0-9a-f]{64}$'
        or coalesce(p ->> 'identityPepperVersion', p_pepper_version) is distinct from p_pepper_version
  ) then
    raise exception 'every participant needs an identity kind and a hash of this pepper version' using errcode = 'BTVF0';
  end if;

  insert into public.source_participants (handover_id, source_id, local_id, display_label, identity_kind, identity_hash,
                                          identity_pepper_version, message_count)
  select v_s.handover_id, p_source_id, p ->> 'localId', p ->> 'displayLabel', p ->> 'identityKind',
         decode(p ->> 'identityHash', 'hex'), p_pepper_version, (p ->> 'messageCount')::int
    from jsonb_array_elements(p_parsed -> 'participants') p;

  -- An unresolved name match: the creator must decide first (§6.8.1). Nothing of this parse is kept.
  if exists (
    select 1 from public.source_participants sp
    join public.source_exclusions e
      on e.handover_id = sp.handover_id and e.kind = 'participant'
     and e.participant_identity_kind = sp.identity_kind
     and e.participant_identity_hash = sp.identity_hash
     and e.participant_identity_pepper_version = sp.identity_pepper_version
    where sp.source_id = p_source_id and public._exclusion_rule_mode(e, p_source_id) = 'detect'
  ) then
    raise exception 'identity_confirmation_required' using errcode = 'BTPF0';
  end if;

  -- The parser drops excluded participants in memory. If one still carries messages, refuse the whole
  -- parse rather than store their content (§12.2).
  select count(*) into v_n
    from public.source_participants sp
    join public.source_exclusions e
      on e.handover_id = sp.handover_id and e.kind = 'participant'
     and e.participant_identity_kind = sp.identity_kind
     and e.participant_identity_hash = sp.identity_hash
     and e.participant_identity_pepper_version = sp.identity_pepper_version
   where sp.source_id = p_source_id and coalesce(sp.message_count, 0) > 0
     and public._exclusion_rule_mode(e, p_source_id) = 'apply';
  if v_n > 0 then
    raise exception 'parsed output contains messages from an excluded participant' using errcode = 'BTCF0';
  end if;

  insert into public.source_conversations (handover_id, source_id, local_id, started_at, ended_at, message_count,
                                           participant_local_ids, preview)
  select v_s.handover_id, p_source_id, c ->> 'localId', (c ->> 'startedAt')::timestamptz, (c ->> 'endedAt')::timestamptz,
         (c ->> 'messageCount')::int,
         coalesce(array(select jsonb_array_elements_text(c -> 'participantLocalIds')), '{}'), left(c ->> 'preview', 140)
    from jsonb_array_elements(coalesce(p_parsed -> 'conversations', '[]'::jsonb)) c;

  insert into public.source_messages (handover_id, source_id, conversation_id, participant_id, seq, sent_at, kind, body,
                                      body_sha256, location)
  select v_s.handover_id, p_source_id, sc.id, sp.id, (m ->> 'seq')::int, (m ->> 'sentAt')::timestamptz, m ->> 'kind',
         m ->> 'body', sha256(convert_to(m ->> 'body', 'UTF8')),
         case when jsonb_typeof(m -> 'location') = 'object' then m -> 'location' end
    from jsonb_array_elements(p_parsed -> 'messages') m
    left join public.source_conversations sc on sc.source_id = p_source_id and sc.local_id = m ->> 'conversationLocalId'
    left join public.source_participants sp on sp.source_id = p_source_id and sp.local_id = m ->> 'participantLocalId';
  get diagnostics v_n = row_count;

  if exists (
    select 1 from public.source_messages m
    join public.source_participants sp on sp.id = m.participant_id
    join public.source_exclusions e
      on e.handover_id = sp.handover_id and e.kind = 'participant'
     and e.participant_identity_kind = sp.identity_kind
     and e.participant_identity_hash = sp.identity_hash
     and e.participant_identity_pepper_version = sp.identity_pepper_version
    where m.source_id = p_source_id and public._exclusion_rule_mode(e, p_source_id) = 'apply'
  ) then
    raise exception 'parsed output contains messages from an excluded participant' using errcode = 'BTCF0';
  end if;

  update public.sources
     set state = 'parsed', parser_version = p_parsed ->> 'parserVersion', message_count = v_n,
         first_message_at = (p_parsed ->> 'firstMessageAt')::timestamptz,
         last_message_at = (p_parsed ->> 'lastMessageAt')::timestamptz,
         masking_counts = p_parsed -> 'masking' -> 'counts', error_code = null
   where id = p_source_id;
  perform public._audit(v_s.handover_id, null, null, 'source.parsed', 'source', p_source_id, null,
                        jsonb_build_object('messages', v_n));
end $$;

create function public.mark_source_parse_failed(p_source_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
begin
  select handover_id into v_handover from public.sources where id = p_source_id;
  if v_handover is null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_handover);
  update public.sources set state = 'failed', error_code = p_error_code
   where id = p_source_id and state in ('uploaded', 'parsing', 'failed');
end $$;

-- Only after the parse transaction has committed (§10.3 step 4), or when the source was removed.
create function public.mark_source_raw_deleted(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.sources;
begin
  select * into v_s from public.sources where id = p_source_id for update;
  if not found then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  if v_s.raw_storage_path is null then
    return;
  end if;
  update public.sources set raw_storage_path = null, raw_deleted_at = now() where id = p_source_id;
  perform public._audit(v_s.handover_id, null, null, 'source.raw_deleted', 'source', p_source_id, null,
                        jsonb_build_object('state', v_s.state));
end $$;

create function public.insert_extracted_point(
  p_handover_id uuid, p_run_id uuid, p_category text, p_title text, p_statement text, p_attributes jsonb,
  p_inference_rationale text, p_extraction_access_level text, p_ai_provenance jsonb, p_sort_key double precision default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_point uuid;
  v_rev uuid;
begin
  perform public._lock_handover_for_share(p_handover_id);
  perform public._require_active_run(p_handover_id, p_run_id); -- N3: this run, active, handover processing
  if p_extraction_access_level is null or p_ai_provenance is null then
    raise exception 'extraction access level and provenance are required' using errcode = 'BTVF0';
  end if;
  insert into public.handover_points (handover_id, category, origin, inference_rationale, extraction_run_id,
                                      extraction_access_level, access_floor, sort_key)
  values (p_handover_id, p_category, 'extracted', nullif(btrim(p_inference_rationale), ''), p_run_id,
          p_extraction_access_level, p_extraction_access_level, p_sort_key)
  returning id into v_point;
  insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind, ai_provenance)
  values (p_handover_id, v_point, 1, p_title, p_statement, p_attributes, 'system', p_ai_provenance)
  returning id into v_rev;
  update public.handover_points set current_revision_id = v_rev where id = v_point;
  return v_point;
end $$;

-- Attach a quote from a persisted message to a point (dedup by message span). Snapshots author,
-- identity hash, time, source title and location so the quote survives message pruning (§6.10).
create function public.add_source_quote_evidence(
  p_point_id uuid, p_source_message_id uuid, p_quote_text text, p_quote_start int, p_quote_end int, p_quote_check text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_quote uuid;
  v_link uuid;
begin
  select handover_id into v_handover from public.handover_points where id = p_point_id;
  if v_handover is null then
    raise exception 'point not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_handover);
  perform public._require_active_run(v_handover); -- N3

  select id into v_quote from public.evidence_quotes
   where source_message_id = p_source_message_id and quote_start is not distinct from p_quote_start
     and quote_end is not distinct from p_quote_end;
  if v_quote is null then
    insert into public.evidence_quotes (handover_id, kind, source_id, source_message_id, quote_text, quote_start, quote_end,
                                        message_sent_at, author_label, author_identity_kind, author_identity_hash,
                                        author_identity_pepper_version, source_title, location, quote_check,
                                        quote_checked_at, access_level)
    select m.handover_id, 'source_quote', m.source_id, m.id, p_quote_text, p_quote_start, p_quote_end, m.sent_at,
           sp.display_label, sp.identity_kind, sp.identity_hash, sp.identity_pepper_version, s.title, m.location,
           coalesce(p_quote_check, 'pending'), case when p_quote_check is not null and p_quote_check <> 'pending' then now() end,
           s.access_level
      from public.source_messages m
      join public.sources s on s.id = m.source_id
      left join public.source_participants sp on sp.id = m.participant_id
     where m.id = p_source_message_id and m.handover_id = v_handover
    returning id into v_quote;
    if v_quote is null then
      raise exception 'message not found' using errcode = 'BTNF0';
    end if;
  end if;

  insert into public.point_evidence (handover_id, point_id, evidence_id)
  values (v_handover, p_point_id, v_quote)
  on conflict (point_id, evidence_id) do nothing
  returning id into v_link;
  if v_link is null then
    select id into v_link from public.point_evidence where point_id = p_point_id and evidence_id = v_quote;
  end if;
  return v_link;
end $$;

create function public.record_quote_check(p_evidence_id uuid, p_quote_check text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
begin
  select handover_id into v_handover from public.evidence_quotes where id = p_evidence_id;
  if v_handover is null then
    raise exception 'evidence not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_handover);
  perform public._require_active_run(v_handover); -- N3
  update public.evidence_quotes set quote_check = p_quote_check, quote_checked_at = now()
   where id = p_evidence_id and kind = 'source_quote';
end $$;

-- verify_support result (§10.8). p_quote_sha256 is the SHA-256 of the quote text the verifier saw: if the
-- evidence text changed meanwhile (privacy redact) the verdict is refused, so a verdict is never stored
-- for replaced or removed testimony (§5.5 test T6).
create function public.record_support_verdict(
  p_point_evidence_id uuid, p_revision_id uuid, p_verdict text, p_rationale text, p_provenance jsonb, p_quote_sha256 bytea
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_link public.point_evidence;
  v_text text;
begin
  select handover_id into v_handover from public.point_evidence where id = p_point_evidence_id;
  if v_handover is null then
    raise exception 'evidence link not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_handover); -- waits for any privacy function (T6)
  if not exists (select 1 from public.handovers where id = v_handover and state in ('processing', 'in_review')) then
    raise exception 'verdicts are recorded only while processing or in review' using errcode = 'BTIT0'; -- N3
  end if;
  select * into v_link from public.point_evidence where id = p_point_evidence_id for update;
  if not found then
    raise exception 'evidence link not found' using errcode = 'BTNF0';
  end if;
  select quote_text into v_text from public.evidence_quotes where id = v_link.evidence_id;
  if sha256(convert_to(v_text, 'UTF8')) is distinct from p_quote_sha256 then
    raise exception 'evidence text changed since verification started' using errcode = 'BTCF0';
  end if;
  if p_verdict not in ('supports', 'partial', 'contradicts', 'irrelevant') then
    raise exception 'unknown verdict' using errcode = 'BTVF0';
  end if;
  update public.point_evidence
     set support_verdict = p_verdict, verdict_rationale = p_rationale, verifier_provenance = p_provenance,
         verified_revision_id = p_revision_id, verified_at = now()
   where id = p_point_evidence_id;
end $$;
