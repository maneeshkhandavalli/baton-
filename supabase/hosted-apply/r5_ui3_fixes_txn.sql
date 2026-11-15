-- Baton Round 5 hosted apply: the UI3 fixes (20261115100100_gap_answer_point.sql, 20261115100200_pipeline_points_cited_messages.sql), verbatim, in ONE transaction,
-- on baton-dev (xnwppnzvrpthukxjfojj) only. Run through run-hosted.sh r5apply. The guard aborts (nothing applied) unless the
-- history is exactly baton-dev's post-Round-4 state (37 rows, newest 20261114100100) and both functions are the old ones.
begin;
set local lock_timeout = '10s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 37
     or (select max(version) from supabase_migrations.schema_migrations) <> '20261114100100'
     or to_regprocedure('public.review_gap_answer(uuid,uuid,text,text)') is null
     or to_regprocedure('public.list_points_for_pipeline(uuid)') is null
     or (select prosrc from pg_proc where oid = to_regprocedure('public.review_gap_answer(uuid,uuid,text,text)')) like '%QA-UI3-G1%'
     or (select prosrc from pg_proc where oid = to_regprocedure('public.list_points_for_pipeline(uuid)')) like '%citedMessageIds%'
  then
    raise exception 'REFUSED: not baton-dev at the expected migration state; nothing was changed';
  end if;
end $$;

-- ===== 20261115100100_gap_answer_point.sql (verbatim) =====
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
-- ===== end of migration =====

insert into supabase_migrations.schema_migrations (version, name) values ('20261115100100', 'gap_answer_point');

-- ===== 20261115100200_pipeline_points_cited_messages.sql (verbatim) =====
-- Retry idempotency for extraction (QA-UI3-X1): the worker's point list also returns, per point, the source
-- messages its active evidence cites and its first-revision (extractor) statement.
--
-- Why: dedup matched only identical statements (or the same owner/system/contact subject). A retry after a
-- failed run re-extracts the same chunk and the model rewords its claims, so the retry inserted duplicates.
-- lib/pipeline/dedup.ts now also treats a candidate as the same point when it cites one of the same messages
-- with the same numbers and strongly overlapping wording; it needs these two fields to do that.
--
-- What changes: list_points_for_pipeline gains two additive keys, citedMessageIds and originalStatement. Same
-- signature, so grants (service_role only), ownership and SECURITY DEFINER are unchanged. Read-only; no table,
-- column, policy or data change. Older workers ignore the new keys.
-- Rollback: re-create list_points_for_pipeline from 20261112000100_integration_worker_support.sql.

create or replace function public.list_points_for_pipeline(p_handover_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'pointId', p.id, 'category', p.category, 'origin', p.origin, 'extractionRunId', p.extraction_run_id,
           'extractionAccessLevel', p.extraction_access_level, 'accessLevel', p.access_level,
           'evidenceStatus', p.evidence_status, 'reviewState', p.review_state, 'privacyReview', p.privacy_review,
           'currentRevisionId', p.current_revision_id,
           'title', case when r.redacted_at is null then r.title end,
           'statement', case when r.redacted_at is null then r.statement end,
           'attributes', case when r.redacted_at is null then r.attributes end,
           'redacted', r.redacted_at is not null,
           'newestEvidenceAt', (select max(q.message_sent_at) from public.point_evidence pe
                                  join public.evidence_quotes q on q.id = pe.evidence_id
                                 where pe.point_id = p.id and pe.excluded_at is null),
           'lastSupportedAt', p.last_supported_at,
           'citedMessageIds', coalesce((select jsonb_agg(distinct q.source_message_id)
                                          from public.point_evidence pe
                                          join public.evidence_quotes q on q.id = pe.evidence_id
                                         where pe.point_id = p.id and pe.excluded_at is null and q.source_message_id is not null), '[]'::jsonb),
           'originalStatement', (select case when r1.redacted_at is null then r1.statement end
                                   from public.point_revisions r1 where r1.point_id = p.id and r1.revision_number = 1))
           order by p.created_at, p.id), '[]'::jsonb)
    from public.handover_points p
    left join public.point_revisions r on r.id = p.current_revision_id
   where p.handover_id = p_handover_id and p.erased_at is null
$$;
-- ===== end of migration =====

insert into supabase_migrations.schema_migrations (version, name) values ('20261115100200', 'pipeline_points_cited_messages');

commit;

notify pgrst, 'reload schema';
