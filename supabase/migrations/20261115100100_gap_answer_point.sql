-- An accepted Gap Interview answer always reaches the handover (QA-UI3-G1).
--
-- Why: review_gap_answer stored an accepted answer as testimony evidence and linked it ONLY when its question was
-- about a point. Category-level questions (the D21 checklist, or a question asked without a point) have no point,
-- so the testimony was attached to nothing: the question became 'answered' (which also cleared a required-gap
-- blocker), but publish_handover snapshots approved POINTS only, so the knowledge never reached the published
-- handover or the incoming member.
--
-- What changes (one function body, same signature, so grants, ownership and SECURITY DEFINER are unchanged):
--   * Accepting an answer to a question WITH a point: unchanged (testimony linked to that point).
--   * Accepting an answer to a question WITHOUT a point, while the handover is in review: a new PENDING point is
--     created (origin 'gap_answer', the question's category, or 'next_action' for an uncategorised question),
--     titled with the question, stating the answer, with the testimony as its evidence; the question is then
--     linked to it, so later accepted answers to the same question attach to the SAME point (no duplicates).
--     The point is computed like any other (testimony without a support check = inferred) and must be confirmed
--     and approved by a reviewer before publish_handover will run: no readiness check is bypassed. Its access
--     follows the question's level through the existing testimony and access-floor triggers.
--   * Accepting an answer to a question without a point when the handover is NOT in review is refused (BTIT0),
--     because points can only be added in review (same rule as create_manual_point); nothing is changed then.
--   * Rejecting an answer: unchanged (no evidence, no point).
-- No table, column, constraint, policy, trigger or grant changes. Existing rows are not touched.
-- Rollback: re-create public.review_gap_answer from supabase/migrations/20261111000500_review_gaps_pipeline.sql.

create or replace function public.review_gap_answer(p_actor_profile_id uuid, p_answer_id uuid, p_decision text, p_note text default null)
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
      v_category := coalesce(v_q.category, 'next_action');
      insert into public.handover_points (handover_id, category, origin, sort_key)
      values (v_a.handover_id, v_category, 'gap_answer',
              coalesce((select max(sort_key) from public.handover_points where handover_id = v_a.handover_id), 0) + 1)
      returning id into v_point;
      insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind, author_profile_id)
      values (v_a.handover_id, v_point, 1, left(btrim(v_q.question), 200), v_a.answer_text, '{}'::jsonb, 'profile', v_actor)
      returning id into v_rev;
      update public.handover_points set current_revision_id = v_rev where id = v_point;
      insert into public.point_evidence (handover_id, point_id, evidence_id) values (v_a.handover_id, v_point, v_quote);
      update public.gap_questions set point_id = v_point where id = v_q.id;
      perform public._audit(v_a.handover_id, v_actor, null, 'point.created', 'point', v_point, null,
                            jsonb_build_object('origin', 'gap_answer', 'category', v_category, 'gapQuestionId', v_q.id));
    end if;
    update public.gap_questions set status = 'answered' where id = v_q.id and status = 'open';
  end if;

  perform public._audit(v_a.handover_id, v_actor, null, 'gap_answer.' || p_decision || 'ed', 'gap_answer', p_answer_id,
                        jsonb_build_object('status', 'submitted'),
                        jsonb_build_object('status', case when p_decision = 'accept' then 'accepted' else 'rejected' end,
                                           'evidenceId', v_quote, 'pointId', coalesce(v_point, v_q.point_id)));
end $$;
