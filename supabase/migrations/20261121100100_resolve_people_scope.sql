-- Round 4 final fix (Agent C, audit S6 / 3.8): narrow resolve_handover_people to what each member needs.
-- ADDITIVE and idempotent: replaces one function body with the same signature; no table or data change.
--
-- Before: every member got the sealed label of EVERY participant of any parsed person_v1 source within their
-- clearance, including incoming members and leads, who cannot read sources at all, and including people the
-- uploader excluded.
--
-- After:
--   * still: actor verified (_require_actor), live handover, membership (clearance not null) or not_found;
--     decryption stays on the application server, after this check;
--   * excluded people are never resolved for anyone: an ordinal whose participant row is excluded in ANY
--     source of the handover is dropped (privacy-conservative: the uploader asked for this person to be left
--     out, so no screen should name them);
--   * review roles (creator, outgoing, reviewer: _is_review_role_of) keep the previous scope: participants of
--     parsed person_v1 sources within their clearance (they read those sources and the review queue), plus
--     people only MENTIONED in text (vault entries that are not participants, Round 4 name detection) whose
--     tokens appear in messages, evidence quotes or current point revisions within their clearance;
--   * every other member (incoming, lead) gets ONLY the ordinals that appear in content they can actually
--     see: publication points of non-redacted publications within their clearance that are not redacted or
--     privacy-held (the same filter as the publication_points RLS policy), plus the gap questions assigned
--     to them that they can answer. Reviewer-only material, unpublished points and other members' questions
--     contribute nothing. A sender must still be a participant of a parsed person_v1 source within their
--     clearance, so a token in published text never widens the source clearance rule; a mention-only person
--     (no participant row anywhere in the handover) is resolved when visible published content names them.

create or replace function public.resolve_handover_people(p_actor_profile_id uuid, p_handover_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_ordinals int[];
  v_needed int[];
  v_review boolean;
begin
  if not exists (select 1 from public.handovers h where h.id = p_handover_id and h.deleted_at is null)
     or public._clearance_of(p_handover_id, v_actor) is null then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;

  v_review := public._is_review_role_of(p_handover_id, v_actor);

  -- People of parsed, pseudonymised sources within the actor's clearance, never an excluded person.
  -- Senders are source participants. People only MENTIONED in text (Round 4, lib/privacy/name-detect.ts) are in
  -- the vault but are not participants: review roles also resolve the [PERSON_n] tokens found in material they
  -- can read (messages of those sources, evidence quotes and current point revisions within their clearance);
  -- non-review members resolve a mention-only person only through visible published content (below).
  select array_agg(distinct o.ordinal)
    into v_ordinals
    from (
      select substring(sp.display_label from '^\[PERSON_([0-9]+)\]$')::int as ordinal
        from public.source_participants sp
        join public.sources s on s.id = sp.source_id
       where sp.handover_id = p_handover_id
         and sp.display_label ~ '^\[PERSON_[1-9][0-9]{0,5}\]$'
         and not sp.excluded
         and s.deleted_at is null and s.state = 'parsed' and s.identity_scheme = 'person_v1'
         and public._within_clearance_as(v_actor, p_handover_id, s.access_level)
      union all
      select (regexp_matches(m.body, '\[PERSON_([1-9][0-9]{0,5})\]', 'g'))[1]::int
        from public.source_messages m
        join public.sources s on s.id = m.source_id
       where v_review and m.handover_id = p_handover_id and m.body is not null
         and s.deleted_at is null and s.state = 'parsed' and s.identity_scheme = 'person_v1'
         and public._within_clearance_as(v_actor, p_handover_id, s.access_level)
      union all
      select (regexp_matches(q.quote_text, '\[PERSON_([1-9][0-9]{0,5})\]', 'g'))[1]::int
        from public.evidence_quotes q
       where v_review and q.handover_id = p_handover_id and q.quote_text is not null
         and public._within_clearance_as(v_actor, p_handover_id, q.access_level)
      union all
      select (regexp_matches(coalesce(r.title, '') || ' ' || coalesce(r.statement, '') || ' ' || coalesce(r.attributes::text, ''),
                             '\[PERSON_([1-9][0-9]{0,5})\]', 'g'))[1]::int
        from public.handover_points pt
        join public.point_revisions r on r.id = pt.current_revision_id
       where v_review and pt.handover_id = p_handover_id and pt.erased_at is null
         and public._within_clearance_as(v_actor, p_handover_id, pt.access_level)
      union all
      -- mention-only people (never a participant of any source of this handover): candidates for non-review
      -- members, kept only if visible published content names them (intersection below)
      select hp.ordinal
        from public.handover_people hp
       where not v_review and hp.handover_id = p_handover_id
         and not exists (select 1 from public.source_participants x
                          where x.handover_id = p_handover_id and x.display_label = '[PERSON_' || hp.ordinal || ']')
    ) o
   where not exists (
     select 1 from public.source_participants x
      where x.handover_id = p_handover_id and x.excluded
        and x.display_label = '[PERSON_' || o.ordinal || ']');

  if v_ordinals is null then
    return '[]'::jsonb;
  end if;

  if not v_review then
    -- Incoming members and leads: only people named in content they can see.
    select array_agg(distinct m.ordinal)
      into v_needed
      from (
        select (regexp_matches(pp.content::text, '\[PERSON_([1-9][0-9]{0,5})\]', 'g'))[1]::int as ordinal
          from public.publication_points pp
          join public.handover_publications pub on pub.id = pp.publication_id and pub.handover_id = pp.handover_id
         where pp.handover_id = p_handover_id
           and pub.redacted_at is null
           and pp.redacted_at is null and not pp.privacy_hold
           and public._within_clearance_as(v_actor, p_handover_id, pp.access_level)
        union all
        select (regexp_matches(coalesce(q.question, '') || ' ' || coalesce(q.context, ''),
                               '\[PERSON_([1-9][0-9]{0,5})\]', 'g'))[1]::int
          from public.gap_questions q
         where q.handover_id = p_handover_id
           and public._gap_question_visible_as(v_actor, q.id)
      ) m;
    if v_needed is null then
      return '[]'::jsonb;
    end if;
    select array_agg(o) into v_ordinals from unnest(v_ordinals) o where o = any (v_needed);
    if v_ordinals is null then
      return '[]'::jsonb;
    end if;
  end if;

  return public._handover_people_json(p_handover_id, v_ordinals);
end $$;

revoke execute on function public.resolve_handover_people(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_handover_people(uuid, uuid) to service_role;
