-- Round 3, Agent 4: PI-11 guard fields on the review read (lead-approved additive contract change).
--
-- api_get_point (same signature, security invoker, grants unchanged) adds two keys to every evidence
-- object, so the UI no longer has to recognise the guard's fixed rationale sentence:
--   guarded       boolean  true when the deterministic injection guard (lib/ai/injection-guard.ts)
--                          replaced the verifier's promoting verdict with 'irrelevant';
--   model_verdict text     the verdict the model returned before the guard ('supports' | 'partial'),
--                          null unless guarded.
-- Both are derived from point_evidence.verifier_provenance -> 'injectionGuard', which the verify_support
-- stage writes (pattern ids and verdicts only, never text). They hold only while the stored verdict is
-- still 'irrelevant': a later reset (privacy redaction sets 'unchecked') or a new verdict clears them.
-- No table, column, grant or RLS change. Everything else is byte-for-byte the 20261111000900 body.

create or replace function public.api_get_point(p_point_id uuid)
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
               'guarded', (pe.support_verdict = 'irrelevant'
                           and coalesce(pe.verifier_provenance -> 'injectionGuard' ->> 'guarded', '') = 'true'),
               'model_verdict', case when pe.support_verdict = 'irrelevant'
                                      and coalesce(pe.verifier_provenance -> 'injectionGuard' ->> 'guarded', '') = 'true'
                                      and pe.verifier_provenance -> 'injectionGuard' ->> 'modelVerdict' in ('supports', 'partial')
                                     then pe.verifier_provenance -> 'injectionGuard' ->> 'modelVerdict' end,
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
