-- Round 4 A (audit C5, C6 / F11): accepted Gap Interview answers and reviewer statements reach the published snapshot.
--
-- An accepted answer (review_gap_answer) and a manual point's "How do you know this?" statement (create_manual_point)
-- are testimony: human evidence whose link starts `unchecked` until a processing run's verify_support judges it. The
-- publication snapshot only kept links verified for the CURRENT revision as supports/contradicts, so a point resting on
-- testimony that no run had judged yet was published with NO evidence:
--   * the incoming member read "No source states this outright" with nothing to look at (C6);
--   * the Decision Timeline had no date for it and listed it under "Undated" until a later re-run (C5).
--
-- Now testimony is also published when the verifier has not rejected it: the link is unchecked, or its verdict was
-- for an earlier revision and was not negative (B's 20261121200100 stops re-verifying an approved point's testimony).
-- It is published as `supports`, dated with the answer's time (gap_answers.created_at) or the statement's time.
-- Testimony the verifier judged `irrelevant` or `contradicts` for the current revision is treated exactly as before
-- (contradicts is published as contradicting, irrelevant is left out). Source quotations are unchanged: they still
-- need a current-revision `supports`/`contradicts` verdict and an exact or normalised quote check.
--
-- The point's evidence status is NOT changed (a testimony point stays Inferred and still needs a reviewer's
-- confirmation to be approved), nor is any gate: publish_handover's checks are unchanged. Only the evidence copied
-- into the snapshot widens, and only for human testimony that the access level already lets the reader see
-- (publication_points RLS and the snapshot's evidence redaction are unchanged).
--
-- Same signature, SECURITY DEFINER and search_path as 20261111000400; no grant change (internal helper).

create or replace function public._build_publication_content(p_point_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', r.title,
    'statement', r.statement,
    'attributes', r.attributes,
    'evidenceStatus', p.evidence_status,
    'isPotentiallyOutdated', p.is_potentially_outdated,
    'isKnownGap', p.approved_as_known_gap,
    'inferredConfirmation',
      case when p.evidence_status = 'inferred' and p.inferred_confirmed_by is not null then
        jsonb_build_object('byLabel', public._handover_label(p.handover_id, p.inferred_confirmed_by),
                           'byProfileId', p.inferred_confirmed_by, 'at', p.inferred_confirmed_at)
      end,
    'conflictResolution',
      case when p.conflict_resolution_note is not null and p.conflict_resolved_by is not null then
        jsonb_build_object('note', p.conflict_resolution_note, 'byLabel', public._handover_label(p.handover_id, p.conflict_resolved_by),
                           'byProfileId', p.conflict_resolved_by, 'at', p.conflict_resolved_at)
      end,
    'evidence', coalesce((
      select jsonb_agg(item order by sent_at desc nulls last, eid)
        from (
          select q.id as eid,
                 coalesce(q.message_sent_at, case when q.kind = 'testimony' then coalesce(a.created_at, q.created_at) end) as sent_at,
                 jsonb_build_object(
                   'evidenceId', q.id, 'redacted', false, 'kind', q.kind, 'quote', q.quote_text,
                   'authorLabel', q.author_label,
                   'sentAt', coalesce(q.message_sent_at, case when q.kind = 'testimony' then coalesce(a.created_at, q.created_at) end),
                   'sourceTitle', q.source_title,
                   'stance', case when pe.support_verdict = 'contradicts' then 'contradicts' else 'supports' end,
                   'authorProfileId', case when q.kind = 'testimony' then coalesce(q.stated_by_profile_id, a.answered_by_profile_id) end
                 ) as item
            from public.point_evidence pe
            join public.evidence_quotes q on q.id = pe.evidence_id
            left join public.gap_answers a on a.id = q.gap_answer_id
           where pe.point_id = p.id and pe.excluded_at is null
             and q.quote_check in ('exact', 'normalized')
             and (
               -- every kind: a verdict for the current wording that supports or contradicts it (unchanged rule)
               (pe.verified_revision_id = p.current_revision_id and pe.support_verdict in ('supports', 'contradicts'))
               -- testimony: human evidence the verifier has not judged for this wording, and never a negative verdict
               or (q.kind = 'testimony'
                   and pe.support_verdict not in ('contradicts', 'irrelevant')
                   and (pe.support_verdict = 'unchecked' or pe.verified_revision_id is distinct from p.current_revision_id))
             )
        ) e
    ), '[]'::jsonb),
    'evidenceRedacted', false
  )
  from public.handover_points p
  join public.point_revisions r on r.id = p.current_revision_id
  where p.id = p_point_id
$$;
