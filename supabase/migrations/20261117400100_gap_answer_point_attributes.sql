-- Round 3 Task 04 (release reliability): an accepted Gap Interview answer never creates an invalid typed point.
-- ADDITIVE / forward-only. REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- Defect (Tier E step 4): review_gap_answer (20261115100100, QA-UI3-G1) created the point for a category-level
-- question with attributes '{}'. Three categories REQUIRE an attribute (lib/contracts/schemas.ts):
--   owner.responsibility · contact.nameLabel · account_access.system
-- so getPoint refused the row (DbError internal), the review page silently dropped the point, and the pending point
-- still counted in readiness, which could make publishing impossible from the interface.
--
-- Fix (at the source, nothing fabricated):
--   * The required attribute comes from ONE of two real sources:
--       1. the reviewer, who reads the answer and supplies it when accepting (`p_point_detail`, already masked by
--          the server action), or
--       2. the question that was actually asked, when it is one of the product-authored checklist questions that
--          names the subject itself (exact text match, `_checklist_point_detail`; mirrors
--          lib/pipeline/checklist.ts `pointDetail`, kept in step by a test). E.g. "Who holds the bank or UPI
--          account …?" → system "Bank or UPI account". A contact NAME is never derivable from a question.
--   * When neither is available, accepting is REFUSED (BTVF0, "needs details"): the answer stays `submitted`
--     (preserved and still reviewable), the question stays `open` (the existing unresolved-gap mechanism, so a
--     required gap keeps blocking readiness), and nothing is written. The reviewer adds the detail and accepts
--     again, or rejects/waives as before.
--   * Everything else is unchanged: answers to questions WITH a point, categories without a required attribute,
--     rejections, the in-review rule, privacy holds, permissions and audit.
-- Signatures: review_gap_answer(uuid, uuid, text, text) keeps its signature, grants and SECURITY DEFINER and
-- delegates; the new overload review_gap_answer(uuid, uuid, text, text, text) is server-only (service_role).
-- Existing rows are NOT modified. `gap_answer_points_missing_attributes()` (service_role, read-only, no text)
-- lists points created in the invalid form, for the reviewed repair procedure in
-- docs/operations/release-guard.md.

-- The required attribute of a category, or null when the category has none.
create function public._gap_point_required_field(p_category text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_category when 'owner' then 'responsibility' when 'contact' then 'nameLabel' when 'account_access' then 'system' end
$$;

-- The subject a checklist question names (checklist@1), by exact category + question text; null otherwise.
-- Keep in step with lib/pipeline/checklist.ts `pointDetail` (lib/pipeline/__tests__/gap-point-detail.test.ts).
create function public._checklist_point_detail(p_category text, p_question text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_category = 'account_access' and p_question = 'Who holds the bank or UPI account, and how is access handed over?'
      then 'Bank or UPI account'
    when p_category = 'account_access' and p_question = 'Where are shared logins (email, social media, drive) kept, and who can recover them?'
      then 'Shared logins (email, social media, drive)'
    when p_category = 'owner' and p_question = 'Who is responsible for the budget and reimbursements?'
      then 'Budget and reimbursements'
  end
$$;

create function public.review_gap_answer(
  p_actor_profile_id uuid, p_answer_id uuid, p_decision text, p_note text, p_point_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_a public.gap_answers;
  v_q public.gap_questions;
  v_quote uuid;
  v_point uuid;
  v_rev uuid;
  v_category text;
  v_field text;
  v_detail text := nullif(btrim(p_point_detail), '');
  v_detail_source text;
  v_attrs jsonb := '{}'::jsonb;
begin
  select * into v_a from public.gap_answers where id = p_answer_id;
  if not found then
    raise exception 'answer not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_share(v_a.handover_id);
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
  if p_decision = 'accept' and v_q.point_id is null and v_h.state <> 'in_review' then
    raise exception 'an answer to a question without a point can be accepted only while the handover is in review' using errcode = 'BTIT0';
  end if;

  v_category := coalesce(v_q.category, 'next_action');
  v_field := case when p_decision = 'accept' and v_q.point_id is null then public._gap_point_required_field(v_category) end;
  if v_detail is not null and v_field is null then
    raise exception 'a point detail applies only when accepting an answer that creates an owner, contact or account point'
      using errcode = 'BTVF0';
  end if;
  if v_detail is not null and char_length(v_detail) > 200 then
    raise exception 'the point detail is at most 200 characters' using errcode = 'BTVF0';
  end if;
  if v_field is not null then
    v_detail_source := case when v_detail is not null then 'reviewer' end;
    if v_detail is null then
      v_detail := public._checklist_point_detail(v_category, v_q.question);
      v_detail_source := case when v_detail is not null then 'checklist_question' end;
    end if;
    if v_detail is null then
      -- Nothing to build a valid point from: refuse; the answer stays submitted and the question open.
      raise exception 'gap_answer_needs_details: accepting this answer needs the % of the point', v_field using errcode = 'BTVF0';
    end if;
    v_attrs := jsonb_build_object(v_field, v_detail);
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
    else
      -- QA-UI3-G1: give the answer a point of its own, pending review, and link the question to it.
      insert into public.handover_points (handover_id, category, origin, sort_key)
      values (v_a.handover_id, v_category, 'gap_answer',
              coalesce((select max(sort_key) from public.handover_points where handover_id = v_a.handover_id), 0) + 1)
      returning id into v_point;
      insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind, author_profile_id)
      values (v_a.handover_id, v_point, 1, left(btrim(v_q.question), 200), v_a.answer_text, v_attrs, 'profile', v_actor)
      returning id into v_rev;
      update public.handover_points set current_revision_id = v_rev where id = v_point;
      insert into public.point_evidence (handover_id, point_id, evidence_id) values (v_a.handover_id, v_point, v_quote);
      update public.gap_questions set point_id = v_point where id = v_q.id;
      perform public._audit(v_a.handover_id, v_actor, null, 'point.created', 'point', v_point, null,
                            jsonb_build_object('origin', 'gap_answer', 'category', v_category, 'gapQuestionId', v_q.id,
                                               'requiredAttribute', v_field, 'attributeSource', v_detail_source));
    end if;
    update public.gap_questions set status = 'answered' where id = v_q.id and status = 'open';
  end if;

  perform public._audit(v_a.handover_id, v_actor, null, 'gap_answer.' || p_decision || 'ed', 'gap_answer', p_answer_id,
                        jsonb_build_object('status', 'submitted'),
                        jsonb_build_object('status', case when p_decision = 'accept' then 'accepted' else 'rejected' end,
                                           'evidenceId', v_quote, 'pointId', coalesce(v_point, v_q.point_id)));
end $$;

-- Same signature, grants and SECURITY DEFINER as before; now delegates (no reviewer-supplied detail).
create or replace function public.review_gap_answer(p_actor_profile_id uuid, p_answer_id uuid, p_decision text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.review_gap_answer(p_actor_profile_id, p_answer_id, p_decision, p_note, null::text);
end $$;

-- Read-only diagnostic for the repair procedure: gap-answer points whose CURRENT revision lacks its category's
-- required attribute. Ids, states and a derivability flag only; never text.
create function public.gap_answer_points_missing_attributes()
returns table (point_id uuid, handover_id uuid, category text, review_state text, handover_state text,
               in_publication boolean, derivable_from_question boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.handover_id, p.category, p.review_state, h.state,
         exists (select 1 from public.publication_points pp where pp.point_id = p.id),
         public._checklist_point_detail(p.category, q.question) is not null
    from public.handover_points p
    join public.handovers h on h.id = p.handover_id
    join public.point_revisions r on r.id = p.current_revision_id
    left join public.gap_questions q on q.point_id = p.id
   where p.origin = 'gap_answer' and p.erased_at is null
     and public._gap_point_required_field(p.category) is not null
     and nullif(btrim(r.attributes ->> public._gap_point_required_field(p.category)), '') is null
$$;

revoke execute on function
  public._gap_point_required_field(text), public._checklist_point_detail(text, text),
  public.review_gap_answer(uuid, uuid, text, text, text), public.gap_answer_points_missing_attributes()
  from public, anon, authenticated, service_role;
grant execute on function public.review_gap_answer(uuid, uuid, text, text, text), public.gap_answer_points_missing_attributes()
  to service_role;
