-- Round 4 B follow-up (browser verification, bug D): an approved point whose quote is unchanged in a new version of its
-- source stays approved.
--
-- 20261121200100 limited re-verification of an APPROVED point to never-checked source quotations ("new evidence").
-- But a new source version is re-extracted, and the extract stage attaches the re-extracted citation of an UNCHANGED
-- sentence to the existing point (lib/pipeline/dedup.ts) as a new, unchecked link. That link counted as new evidence:
-- verify_support judged it against the point's CURRENT wording. For a point a reviewer had edited and approved
-- ("Confirm & approve" of an inferred point), the old quote was verified against the earlier wording only, so the new
-- verdict changed the evidence status (inferred -> sourced) and recompute_point_status auto-reopened the point, although
-- nothing about it had changed.
--
-- Now, for an approved point, a source quotation is NOT re-verified when it is unchanged from an earlier version of the
-- same source: its text (normalised as the quote checker does: NFC, format characters removed, curly quotes and dashes
-- mapped, whitespace collapsed; case preserved) is found in a message of an EARLIER version of the same lineage that
-- the point already cites with a found quote (exact or normalized) through an active link. That passage was part of
-- the evidence when the reviewer approved the point. Everything else is unchanged:
--   * a changed or new passage of the changed version is still verified (a contradiction still reopens the point);
--   * a quote missing from the new version is still an evidence_missing change review (change detection, unchanged);
--   * pending and rejected points are verified exactly as before;
--   * recompute_point_status and link_in_reverify_scope are unchanged.
-- CREATE OR REPLACE of list_links_needing_support (same signature, grants and security mode) and two new internal
-- helpers, not executable by any API role. No table, row or policy changes.

-- ── 1. helpers ───────────────────────────────────────────────────────────────

-- The quote checker's normalisation (lib/ai/quote-check.ts normalizeForQuoteMatch), case preserved.
create or replace function public._quote_match_norm(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
           translate(regexp_replace(normalize(coalesce(p_text, ''), NFC), '[­​-‏‪-‮⁠-⁤﻿]', '', 'g'),
                     U&'\2018\2019\201A\201B\201C\201D\201E\201F\2010\2011\2012\2013\2014\2015\2212',
                     $q$''''""""-------$q$),
           '\s+', ' ', 'g'))
$$;

-- True when the link is a source quotation whose text already appeared, unchanged, in a message of an EARLIER version
-- of the same source that the same point cites through another active link with a found quote.
create or replace function public._source_quote_unchanged_from_earlier_version(p_point_evidence_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.point_evidence pe
      join public.evidence_quotes q on q.id = pe.evidence_id and q.kind = 'source_quote'
      join public.sources s on s.id = q.source_id
      join public.point_evidence pe0 on pe0.point_id = pe.point_id and pe0.id <> pe.id and pe0.excluded_at is null
      join public.evidence_quotes q0 on q0.id = pe0.evidence_id and q0.kind = 'source_quote'
                                    and q0.quote_check in ('exact', 'normalized')
      join public.sources s0 on s0.id = q0.source_id
      join public.source_messages m0 on m0.id = q0.source_message_id
     where pe.id = p_point_evidence_id
       and s.lineage_id is not null and s0.lineage_id = s.lineage_id
       and s0.version_number is not null and s.version_number is not null and s0.version_number < s.version_number
       and char_length(public._quote_match_norm(q.quote_text)) > 0
       and strpos(public._quote_match_norm(m0.body), public._quote_match_norm(q.quote_text)) > 0
  )
$$;

-- ── 2. scope ─────────────────────────────────────────────────────────────────

create or replace function public.list_links_needing_support(p_handover_id uuid, p_limit int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid page size' using errcode = 'BTVF0';
  end if;
  return coalesce((
    select jsonb_agg(x.obj order by x.created_at, x.id) from (
      select pe.id, pe.created_at, jsonb_build_object(
               'pointEvidenceId', pe.id, 'pointId', p.id, 'revisionId', p.current_revision_id,
               'claim', jsonb_build_object('category', p.category, 'title', r.title, 'statement', r.statement,
                                           'attributes', r.attributes),
               'evidenceKind', q.kind,
               'quote', jsonb_build_object('text', q.quote_text, 'authorLabel', q.author_label, 'sentAt', q.message_sent_at),
               'context', case when q.kind = 'source_quote' and m.id is not null then coalesce((
                   select jsonb_agg(jsonb_build_object('authorLabel', sp.display_label, 'sentAt', n.sent_at, 'body', n.body)
                                    order by n.seq)
                     from (select * from public.source_messages n0
                            where n0.source_id = m.source_id and n0.id <> m.id and n0.kind in ('text', 'document_block')
                            order by abs(n0.seq - m.seq), n0.seq limit 3) n
                     left join public.source_participants sp on sp.id = n.participant_id), '[]'::jsonb)
                 else '[]'::jsonb end) as obj
        from public.point_evidence pe
        join public.handover_points p on p.id = pe.point_id
        join public.point_revisions r on r.id = p.current_revision_id
        join public.evidence_quotes q on q.id = pe.evidence_id
        left join public.source_messages m on m.id = q.source_message_id
       where pe.handover_id = p_handover_id and pe.excluded_at is null
         and p.erased_at is null and p.privacy_review <> 'required' and r.redacted_at is null
         and q.quote_check in ('exact', 'normalized')
         and (pe.support_verdict = 'unchecked' or pe.verified_revision_id is distinct from p.current_revision_id)
         and public.link_in_reverify_scope(p.review_state, q.kind, pe.support_verdict)
         -- an approved point: a quotation carried over unchanged from an earlier version is not new evidence
         and not (p.review_state = 'approved' and q.kind = 'source_quote'
                  and public._source_quote_unchanged_from_earlier_version(pe.id))
       order by pe.created_at, pe.id
       limit p_limit) x), '[]'::jsonb);
end $$;

-- ── 3. grants (internal helpers: no API role) ────────────────────────────────

revoke execute on function
  public._quote_match_norm(text),
  public._source_quote_unchanged_from_earlier_version(uuid)
  from public, anon, authenticated, service_role;
