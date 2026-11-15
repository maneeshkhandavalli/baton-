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
