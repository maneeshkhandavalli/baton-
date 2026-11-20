-- Round 4 B (audit F4 / E1, E2): Living Handover correctness and version history.
--
-- 1. RE-VERIFICATION SCOPE (F4). verify_support used to re-check every link of the handover that had no verdict for
--    the point's CURRENT revision. After a point was approved (and published), that meant:
--      * a manual point's own statement (reviewer testimony, never machine-checked before approval), and
--      * an approved, human-edited point (its quotes verified against the previous wording)
--    were re-verified by the next run, typically a Living Handover update run for an UNRELATED source. A negative
--    verdict turned the point Missing, recompute_point_status auto-reopened it, and the next version published a fact
--    from v1 as an open question.
--    Now, for an APPROVED point, list_links_needing_support returns only links that were never checked AND are
--    source quotations (new evidence, which in an update run comes from the changed source version). It skips:
--      * testimony on an approved point (human evidence the reviewer approved; accepted Gap Interview answers too);
--      * links verified for an earlier revision of an approved point (the reviewer approved the human edit).
--    Pending points are unchanged: everything without a verdict for the current revision is still checked, so a
--    point is never approved on an unchecked machine verdict it did not have before. A relevant change review
--    (evidence_missing, support_changed, possible_contradiction from the changed version) still decides about an
--    approved point, exactly as before. recompute_point_status is unchanged.
--
-- 2. CONFIRM & APPROVE (reviewer testimony). confirm_testimony_and_approve(actor, point, expected revision, note):
--    a review role confirms that the point's own testimony (a reviewer statement on a manual point or an accepted
--    Gap Interview answer) supports the CURRENT wording. Every active testimony link is recorded as `supports` for
--    the current revision with provenance { kind: 'reviewer_confirmation', actorProfileId }, then the point is
--    approved (it is Sourced by that human evidence; a conflicting source quotation still needs a resolution).
--    This is the alternative to "Approve as gap" for a point whose testimony a verifier rejected.
--
-- 3. VERSION HISTORY (E2): read-only, SECURITY INVOKER (RLS: membership and clearance, as for the current version):
--      api_list_publication_versions(handover)        every publication of the handover, newest first
--      api_get_publication_version(handover, version)  the same shape as api_get_published_handover, for one version
--    publication_points RLS already filters by clearance, redaction and privacy hold; nothing new is exposed.

-- ── 1. scope ─────────────────────────────────────────────────────────────────

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
       order by pe.created_at, pe.id
       limit p_limit) x), '[]'::jsonb);
end $$;

-- The rule on its own (also mirrored in lib/signals/reverify-scope.ts for the mocks and the demo). Called only for
-- links that have no verdict for the point's current revision.
create or replace function public.link_in_reverify_scope(p_review_state text, p_evidence_kind text, p_support_verdict text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_review_state is distinct from 'approved' then true          -- pending / rejected: as before
    when p_evidence_kind = 'testimony' then false                       -- approved human evidence
    else p_support_verdict = 'unchecked'                                -- new source evidence only; never a re-check of an approved edit
  end
$$;

-- ── 2. confirm & approve ─────────────────────────────────────────────────────

create or replace function public.confirm_testimony_and_approve(p_actor_profile_id uuid, p_point_id uuid,
  p_expected_revision_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.handover_points := public._review_prelude(p_actor_profile_id, p_point_id, 'approve');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_links uuid[];
  v_status text;
begin
  if not public._is_review_role_as(v_actor, v_p.handover_id) then
    raise exception 'point not found' using errcode = 'BTNF0';
  end if;
  if v_p.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'the point changed since it was loaded' using errcode = 'BTCF0';
  end if;
  if v_p.review_state <> 'pending' then
    raise exception 'only pending points can be approved' using errcode = 'BTIT0';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'the note is too long' using errcode = 'BTVF0';
  end if;

  select array_agg(pe.id order by pe.id) into v_links
    from public.point_evidence pe
    join public.evidence_quotes q on q.id = pe.evidence_id
   where pe.point_id = p_point_id and pe.excluded_at is null and q.kind = 'testimony'
     and (q.stated_by_profile_id is not null or q.gap_answer_id is not null);
  if v_links is null then
    raise exception 'this point has no statement or accepted answer to confirm' using errcode = 'BTPF0';
  end if;

  update public.point_evidence
     set support_verdict = 'supports',
         verdict_rationale = 'Confirmed by a reviewer.',
         verifier_provenance = jsonb_build_object('kind', 'reviewer_confirmation', 'actorProfileId', v_actor),
         verified_revision_id = v_p.current_revision_id,
         verified_at = now()
   where id = any (v_links);
  -- the point_evidence trigger recomputed the status; the point is pending, so nothing was auto-reopened
  select evidence_status into v_status from public.handover_points where id = p_point_id;
  if v_status = 'conflicting' then
    raise exception 'a source quotation contradicts this point: resolve the conflict first' using errcode = 'BTPF0';
  end if;
  if v_status <> 'sourced' then
    raise exception 'the statement could not be confirmed for this point' using errcode = 'BTPF0';
  end if;

  update public.handover_points set review_state = 'approved', approved_as_known_gap = false where id = p_point_id;
  select * into v_p from public.handover_points where id = p_point_id;
  perform public._record_review_action(v_p, v_actor, 'approve', 'pending', 'approved', v_note,
    jsonb_build_object('evidenceStatus', 'sourced', 'asKnownGap', false, 'confirmedTestimony', true,
                       'pointEvidenceIds', to_jsonb(v_links)));
  return jsonb_build_object('pointId', p_point_id, 'evidenceStatus', 'sourced', 'reviewState', 'approved',
                            'confirmedLinks', coalesce(array_length(v_links, 1), 0));
end $$;

-- ── 3. version history (read-only, RLS) ──────────────────────────────────────

create or replace function public.api_list_publication_versions(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'publication_id', pub.id, 'version', pub.version, 'published_at', pub.published_at,
           'published_by_label', coalesce(public.member_label(h.id, pub.published_by), 'Former member'),
           'is_current', pub.id = h.current_publication_id,
           'visible_points', (select count(*) from public.publication_points pp where pp.publication_id = pub.id),
           'viewer_acknowledged_at', (
             select max(a.acknowledged_at) from public.acknowledgements a
              where a.publication_id = pub.id and a.profile_id = auth.uid() and a.invalidated_at is null))
         order by pub.version desc), '[]'::jsonb)
    from public.handovers h
    join public.handover_publications pub on pub.handover_id = h.id -- RLS: members only
   where h.id = p_handover_id and h.deleted_at is null
$$;

create or replace function public.api_get_publication_version(p_handover_id uuid, p_version int)
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
  join public.handover_publications pub on pub.handover_id = h.id and pub.version = p_version
  where h.id = p_handover_id and h.deleted_at is null
$$;

-- ── grants ───────────────────────────────────────────────────────────────────

revoke execute on function
  public.link_in_reverify_scope(text, text, text),
  public.confirm_testimony_and_approve(uuid, uuid, uuid, text),
  public.api_list_publication_versions(uuid),
  public.api_get_publication_version(uuid, int)
  from public, anon, authenticated, service_role;
grant execute on function public.link_in_reverify_scope(text, text, text) to service_role;
grant execute on function public.confirm_testimony_and_approve(uuid, uuid, uuid, text) to service_role;
grant execute on function public.api_list_publication_versions(uuid) to authenticated, service_role;
grant execute on function public.api_get_publication_version(uuid, int) to authenticated, service_role;
