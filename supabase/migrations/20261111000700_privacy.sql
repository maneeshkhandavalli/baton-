-- Privacy review (§5.5) and participant erasure (§12.8).
--
-- Concurrency (§5.5 items 1–7): both functions take the handover row FOR UPDATE first, set lock_timeout,
-- then lock dependent rows FOR UPDATE in the fixed table order (points, revisions, evidence links,
-- review actions, gap questions, gap answers, testimony, publications, publication rows,
-- acknowledgements), by ascending id. Every other writer takes the handover lock first (FOR SHARE or
-- FOR UPDATE), so nothing can change the review set between revalidation and commit.

-- ── Review set (§5.5 "Review set") ───────────────────────────────────────────
-- One function computes the set for both getPoint and the resolution, so they cannot drift.

create function public.privacy_review_surfaces(p_point_id uuid)
returns table (kind text, id uuid, revision_number int, fields jsonb, shared_with_point_ids uuid[], kind_order int)
language sql
stable
security definer
set search_path = ''
as $$
  with pt as (
    select * from public.handover_points where id = p_point_id
  ),
  answer_ids as (
    select a.id
      from public.gap_answers a join public.gap_questions q on q.id = a.gap_question_id
     where q.point_id = p_point_id
    union
    select t.gap_answer_id
      from public.point_evidence pe join public.evidence_quotes t on t.id = pe.evidence_id
     where pe.point_id = p_point_id and t.gap_answer_id is not null
  )
  select 'point', pt.id, null::int,
         jsonb_build_object('title', r.title, 'statement', r.statement, 'attributes', r.attributes::text,
                            'editReason', r.edit_reason, 'inferenceRationale', pt.inference_rationale,
                            'conflictResolutionNote', pt.conflict_resolution_note),
         '{}'::uuid[], 0
    from pt join public.point_revisions r on r.id = pt.current_revision_id
  union all
  select 'revision', r.id, r.revision_number,
         jsonb_build_object('title', r.title, 'statement', r.statement, 'attributes', r.attributes::text, 'editReason', r.edit_reason),
         '{}'::uuid[], 1
    from pt join public.point_revisions r on r.point_id = pt.id
   where r.id <> pt.current_revision_id and r.redaction_kind is distinct from 'tombstone'
  union all
  select 'review_note', ra.id, null, jsonb_build_object('note', ra.note), '{}'::uuid[], 2
    from public.review_actions ra where ra.point_id = p_point_id and ra.note is not null
  union all
  select 'evidence_note', pe.id, null,
         jsonb_build_object('exclusionReason', pe.exclusion_reason, 'verdictRationale', pe.verdict_rationale), '{}'::uuid[], 3
    from public.point_evidence pe
   where pe.point_id = p_point_id and (pe.exclusion_reason is not null or pe.verdict_rationale is not null)
  union all
  select 'gap_question', q.id, null,
         jsonb_build_object('question', q.question, 'context', q.context, 'waivedReason', q.waived_reason), '{}'::uuid[], 4
    from public.gap_questions q where q.point_id = p_point_id
  union all
  select 'gap_answer', a.id, null,
         jsonb_build_object('answerText', a.answer_text, 'reviewNote', a.review_note, 'testimonyText', t.quote_text),
         coalesce((select array_agg(distinct pe2.point_id order by pe2.point_id)
                     from public.point_evidence pe2 join public.handover_points p2 on p2.id = pe2.point_id
                    where pe2.evidence_id = t.id and pe2.point_id <> p_point_id and p2.erased_at is null), '{}'::uuid[]),
         5
    from public.gap_answers a left join public.evidence_quotes t on t.gap_answer_id = a.id
   where a.id in (select answer_ids.id from answer_ids)
$$;

-- Hash over every surface id and its current text (and the points sharing each answer).
create function public.privacy_review_digest(p_point_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(string_agg(
           s.kind || ':' || s.id::text || ':' || s.fields::text || ':' || array_to_string(s.shared_with_point_ids, ','),
           E'\n' order by s.kind_order, s.id), ''), 'UTF8')), 'hex')
    from public.privacy_review_surfaces(p_point_id) s
$$;

-- Read path for getPoint: review roles only, and only while the review is required.
create function public.get_privacy_review(p_point_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.point_visible(p_point_id)
               and exists (select 1 from public.handover_points where id = p_point_id and privacy_review = 'required')
    then jsonb_build_object(
      'surfaces', coalesce((
        select jsonb_agg(jsonb_build_object('kind', s.kind, 'id', s.id, 'revision_number', s.revision_number,
                                            'fields', s.fields, 'shared_with_point_ids', to_jsonb(s.shared_with_point_ids))
                         order by s.kind_order, s.id)
          from public.privacy_review_surfaces(p_point_id) s), '[]'::jsonb),
      'digest', public.privacy_review_digest(p_point_id))
  end
$$;

-- ── Shared helpers ───────────────────────────────────────────────────────────

-- Enter privacy review (§5.5 "When a point enters required"). Returns false for missing/erased points.
create function public._flag_point_for_privacy(p_point_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.handover_points;
begin
  select * into v_p from public.handover_points where id = p_point_id for update;
  if not found or v_p.erased_at is not null then
    return false;
  end if;
  update public.handover_points
     set privacy_review = 'required', privacy_review_flagged_at = now(), review_state = 'pending',
         approved_as_known_gap = case when review_state = 'approved' then false else approved_as_known_gap end
   where id = p_point_id;
  insert into public.review_actions (handover_id, point_id, revision_id, actor_profile_id, action, from_review_state,
                                     to_review_state, metadata)
  values (v_p.handover_id, p_point_id, v_p.current_revision_id, null, 'privacy_hold', v_p.review_state, 'pending',
          jsonb_build_object('reason', p_reason));
  update public.publication_points set privacy_hold = true where point_id = p_point_id and not privacy_hold;
  return true;
end $$;

-- Replace evidence items whose evidenceId is in p_ids with { evidenceId, redacted: true }, moved to the end.
create function public._redact_evidence_items(p_content jsonb, p_ids uuid[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_content -> 'evidence') is distinct from 'array' or coalesce(cardinality(p_ids), 0) = 0 then p_content
    else (
      select case when coalesce(bool_or(x.newly), false) then
               jsonb_set(jsonb_set(p_content, '{evidence}', coalesce(jsonb_agg(x.item order by x.grp, x.ord), '[]'::jsonb)),
                         '{evidenceRedacted}', 'true'::jsonb)
             else p_content end
        from (
          select case when (e ->> 'evidenceId')::uuid = any (p_ids)
                      then jsonb_build_object('evidenceId', e -> 'evidenceId', 'redacted', true) else e end as item,
                 case when (e ->> 'evidenceId')::uuid = any (p_ids) or coalesce((e ->> 'redacted')::boolean, false)
                      then 1 else 0 end as grp,
                 t.ord,
                 (e ->> 'evidenceId')::uuid = any (p_ids) and not coalesce((e ->> 'redacted')::boolean, false) as newly
            from jsonb_array_elements(p_content -> 'evidence') with ordinality as t (e, ord)
        ) x
    )
  end
$$;

create function public._tombstone_revisions(p_where_point uuid, p_only_revision uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.point_revisions
     set title = '[removed]', statement = '[removed]', attributes = '{}'::jsonb, edit_reason = null,
         redacted_at = now(), redaction_kind = 'tombstone'
   where (p_only_revision is not null and id = p_only_revision)
      or (p_only_revision is null and point_id = p_where_point and redaction_kind is distinct from 'tombstone')
$$;

-- ── resolve_privacy_review (§5.5 "Resolution", "Function") ──────────────────
-- p_decisions = { expectedRevisionId, decision: keep|redact|withdraw, redacted?: {title, statement,
-- attributes, inferenceRationale?, conflictResolutionNote?}, surfaces: [{kind, id, decision, replacement?}] }.
-- Replacement text must already be masked (§12.1) and attributes validated for the category (§11.5).

create function public.resolve_privacy_review(
  p_point_id uuid, p_decisions jsonb, p_surfaces_digest text, p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_h public.handovers;
  v_p public.handover_points;
  v_decision text := p_decisions ->> 'decision';
  v_redacted jsonb := p_decisions -> 'redacted';
  v_surfaces jsonb := coalesce(p_decisions -> 'surfaces', '[]'::jsonb);
  v_expected uuid;
  v_answer_ids uuid[];
  v_testimony_ids uuid[];
  v_set_keys text[];
  v_sub_keys text[];
  v_s jsonb;
  v_kind text;
  v_id uuid;
  v_dec text;
  v_repl jsonb;
  v_t uuid;
  v_dep uuid;
  v_dependents uuid[];
  v_changed_pubs uuid[] := '{}';
  v_flagged uuid[] := '{}';
  v_redacted_evidence uuid[] := '{}';
  v_pubs uuid[];
  v_new_rev uuid;
  v_old_rev uuid;
  v_to_state text;
  v_acks int := 0;
  v_by_kind jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
begin
  perform set_config('lock_timeout', '5s', true);
  perform public._require_actor(p_actor_profile_id); -- H1: a real, non-deleted, server-verified actor

  select handover_id into v_handover from public.handover_points where id = p_point_id;
  if v_handover is null then
    raise exception 'point not found' using errcode = 'BTNF0';
  end if;
  -- (1) One handover lock serialises every privacy mutation of this handover.
  v_h := public._lock_handover_for_update(v_handover, true);
  if not public._is_review_role_of(v_handover, p_actor_profile_id) then
    raise exception 'point not found' using errcode = 'BTNF0';
  end if;

  -- Shape checks (no writes yet).
  if v_decision is null or v_decision not in ('keep', 'redact', 'withdraw') then
    raise exception 'unknown decision' using errcode = 'BTVF0';
  end if;
  if (v_decision = 'redact') is distinct from coalesce(jsonb_typeof(v_redacted) = 'object', false) then
    raise exception 'replacement text is required exactly when redacting' using errcode = 'BTVF0';
  end if;
  if v_decision = 'redact' and (coalesce(btrim(v_redacted ->> 'title'), '') = '' or coalesce(btrim(v_redacted ->> 'statement'), '') = ''
                                or jsonb_typeof(v_redacted -> 'attributes') is distinct from 'object') then
    raise exception 'redacted title, statement and attributes are required' using errcode = 'BTVF0';
  end if;
  if jsonb_typeof(v_surfaces) <> 'array' then
    raise exception 'surfaces must be a list' using errcode = 'BTVF0';
  end if;
  begin
    v_expected := (p_decisions ->> 'expectedRevisionId')::uuid;
    select array_agg((e ->> 'kind') || ':' || ((e ->> 'id')::uuid)::text order by (e ->> 'kind') || ':' || ((e ->> 'id')::uuid)::text)
      into v_sub_keys from jsonb_array_elements(v_surfaces) e;
  exception when invalid_text_representation then
    raise exception 'malformed id' using errcode = 'BTVF0';
  end;
  for v_s in select * from jsonb_array_elements(v_surfaces) loop
    v_dec := v_s ->> 'decision';
    if v_s ->> 'kind' not in ('revision', 'review_note', 'evidence_note', 'gap_question', 'gap_answer')
       or v_dec is null or v_dec not in ('keep', 'redact', 'remove')
       or (v_dec = 'redact') is distinct from coalesce(jsonb_typeof(v_s -> 'replacement') = 'object', false) then
      raise exception 'invalid surface decision' using errcode = 'BTVF0';
    end if;
    if v_decision = 'withdraw' and v_s ->> 'kind' = 'revision' and v_dec <> 'remove' then
      raise exception 'withdrawing requires every earlier revision to be removed' using errcode = 'BTVF0';
    end if;
  end loop;

  -- (3) Deterministic lock order. The set is stable under the handover lock.
  select array_agg(s.id order by s.id) into v_answer_ids from public.privacy_review_surfaces(p_point_id) s where s.kind = 'gap_answer';
  select array_agg(t.id order by t.id) into v_testimony_ids from public.evidence_quotes t
   where t.gap_answer_id = any (coalesce(v_answer_ids, '{}'));
  perform 1 from public.handover_points
   where id = p_point_id
      or id in (select pe.point_id from public.point_evidence pe where pe.evidence_id = any (coalesce(v_testimony_ids, '{}')))
   order by id for update;
  perform 1 from public.point_revisions where point_id = p_point_id order by id for update;
  perform 1 from public.point_evidence
   where point_id = p_point_id or evidence_id = any (coalesce(v_testimony_ids, '{}')) order by id for update;
  perform 1 from public.review_actions where point_id = p_point_id order by id for update;
  perform 1 from public.gap_questions where point_id = p_point_id order by id for update;
  perform 1 from public.gap_answers where id = any (coalesce(v_answer_ids, '{}')) order by id for update;
  perform 1 from public.evidence_quotes where id = any (coalesce(v_testimony_ids, '{}')) order by id for update;
  perform 1 from public.handover_publications where handover_id = v_handover order by id for update;
  perform 1 from public.publication_points where handover_id = v_handover order by id for update;
  perform 1 from public.acknowledgements where handover_id = v_handover order by id for update;

  -- (4) Revalidate with every lock held. Any mismatch → conflict before any write.
  select * into v_p from public.handover_points where id = p_point_id;
  if v_p.erased_at is not null then
    raise exception 'point not found' using errcode = 'BTNF0';
  end if;
  if v_p.privacy_review <> 'required' then
    raise exception 'privacy review is no longer required' using errcode = 'BTCF0';
  end if;
  if v_p.current_revision_id is distinct from v_expected then
    raise exception 'the point changed since it was loaded' using errcode = 'BTCF0';
  end if;
  if public.privacy_review_digest(p_point_id) is distinct from p_surfaces_digest then
    raise exception 'the review set changed since it was loaded' using errcode = 'BTCF0';
  end if;
  select array_agg(s.kind || ':' || s.id::text order by s.kind || ':' || s.id::text) into v_set_keys
    from public.privacy_review_surfaces(p_point_id) s where s.kind <> 'point';
  if coalesce(v_set_keys, '{}') is distinct from coalesce(v_sub_keys, '{}') then
    raise exception 'decisions must cover the review set exactly' using errcode = 'BTCF0';
  end if;

  -- (5) Atomic effects.
  perform set_config('baton.privacy_review', 'on', true);

  for v_s in select * from jsonb_array_elements(v_surfaces) loop
    v_kind := v_s ->> 'kind';
    v_id := (v_s ->> 'id')::uuid;
    v_dec := v_s ->> 'decision';
    v_repl := v_s -> 'replacement';
    v_by_kind := jsonb_set(v_by_kind, array[v_kind], coalesce(v_by_kind -> v_kind, '{}'::jsonb), true);
    v_by_kind := jsonb_set(v_by_kind, array[v_kind, v_dec],
                           coalesce(v_by_kind -> v_kind -> v_dec, '[]'::jsonb) || to_jsonb(v_id::text), true);
    continue when v_dec = 'keep';

    if v_kind = 'revision' then
      if v_dec = 'redact' then
        if coalesce(btrim(v_repl ->> 'title'), '') = '' or coalesce(btrim(v_repl ->> 'statement'), '') = ''
           or jsonb_typeof(v_repl -> 'attributes') is distinct from 'object' then
          raise exception 'revision replacement needs title, statement and attributes' using errcode = 'BTVF0';
        end if;
        update public.point_revisions
           set title = btrim(v_repl ->> 'title'), statement = btrim(v_repl ->> 'statement'), attributes = v_repl -> 'attributes',
               edit_reason = nullif(btrim(v_repl ->> 'editReason'), ''), redacted_at = now(), redaction_kind = 'replacement'
         where id = v_id;
        with u as (
          update public.publication_points
             set content = content || jsonb_build_object('title', btrim(v_repl ->> 'title'), 'statement', btrim(v_repl ->> 'statement'),
                                                         'attributes', v_repl -> 'attributes', 'textRedacted', true)
           where revision_id = v_id and redacted_at is null
          returning publication_id)
        select coalesce(array_agg(publication_id), '{}') into v_pubs from u;
      else
        perform public._tombstone_revisions(null, v_id);
        with u as (
          update public.publication_points set content = '{"redacted": true}'::jsonb, redacted_at = now()
           where revision_id = v_id and redacted_at is null
          returning publication_id)
        select coalesce(array_agg(publication_id), '{}') into v_pubs from u;
      end if;
      v_changed_pubs := v_changed_pubs || v_pubs;

    elsif v_kind = 'review_note' then
      if v_dec = 'redact' and coalesce(btrim(v_repl ->> 'note'), '') = '' then
        raise exception 'note replacement is required' using errcode = 'BTVF0';
      end if;
      update public.review_actions
         set note = case when v_dec = 'redact' then btrim(v_repl ->> 'note') end
       where id = v_id;

    elsif v_kind = 'evidence_note' then
      update public.point_evidence
         set exclusion_reason = case when v_dec = 'redact' then nullif(btrim(v_repl ->> 'exclusionReason'), '') end,
             verdict_rationale = null -- AI text is never hand-edited
       where id = v_id;

    elsif v_kind = 'gap_question' then
      if v_dec = 'redact' then
        if coalesce(btrim(v_repl ->> 'question'), '') = '' then
          raise exception 'question replacement is required' using errcode = 'BTVF0';
        end if;
        update public.gap_questions
           set question = btrim(v_repl ->> 'question'), context = nullif(btrim(v_repl ->> 'context'), ''),
               waived_reason = nullif(btrim(v_repl ->> 'waivedReason'), '')
         where id = v_id;
      else
        update public.gap_questions
           set status = 'waived', question = '[removed]', context = null, waived_reason = 'privacy_review'
         where id = v_id;
      end if;

    elsif v_kind = 'gap_answer' then
      select t.id into v_t from public.evidence_quotes t where t.gap_answer_id = v_id;
      select coalesce(array_agg(distinct pe.point_id order by pe.point_id), '{}') into v_dependents
        from public.point_evidence pe where pe.evidence_id = v_t and pe.point_id <> p_point_id;
      if v_dec = 'redact' then
        if coalesce(btrim(v_repl ->> 'answerText'), '') = '' then
          raise exception 'answer replacement is required' using errcode = 'BTVF0';
        end if;
        update public.gap_answers
           set answer_text = btrim(v_repl ->> 'answerText'),
               review_note = case when v_repl ? 'reviewNote' then nullif(btrim(v_repl ->> 'reviewNote'), '') else review_note end
         where id = v_id;
        if v_t is not null then
          -- (1) no stale copy: testimony text follows the answer; (3) every verdict on it is re-run.
          update public.evidence_quotes set quote_text = btrim(v_repl ->> 'answerText') where id = v_t;
          update public.point_evidence
             set support_verdict = 'unchecked', verified_revision_id = null, verdict_rationale = null
           where evidence_id = v_t;
        end if;
      else
        update public.gap_answers set answer_text = '[removed]', review_note = null, status = 'rejected' where id = v_id;
        if v_t is not null then
          delete from public.evidence_quotes where id = v_t; -- links cascade, statuses recompute
        end if;
      end if;
      if v_t is not null then
        v_redacted_evidence := v_redacted_evidence || v_t;
        -- (4) other points using the testimony are never changed silently.
        foreach v_dep in array v_dependents loop
          if public._flag_point_for_privacy(v_dep, 'linked_evidence_changed') then
            v_flagged := v_flagged || v_dep;
          end if;
        end loop;
      end if;
    end if;
  end loop;

  -- (2) No stale testimony in any snapshot: { evidenceId, redacted: true } in every publication.
  if cardinality(v_redacted_evidence) > 0 then
    with u as (
      update public.publication_points pp
         set content = public._redact_evidence_items(pp.content, v_redacted_evidence)
       where pp.handover_id = v_handover
         and public._redact_evidence_items(pp.content, v_redacted_evidence) is distinct from pp.content
      returning publication_id)
    select coalesce(array_agg(publication_id), '{}') into v_pubs from u;
    v_changed_pubs := v_changed_pubs || v_pubs;
  end if;

  -- The point surface.
  if v_decision = 'keep' then
    update public.handover_points set privacy_review = 'cleared', privacy_review_flagged_at = null where id = p_point_id;
    update public.publication_points set privacy_hold = false where point_id = p_point_id and privacy_hold;
    v_to_state := 'pending';

  elsif v_decision = 'redact' then
    v_old_rev := v_p.current_revision_id;
    insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind,
                                        author_profile_id, edit_reason)
    select v_handover, p_point_id, max(r.revision_number) + 1, btrim(v_redacted ->> 'title'), btrim(v_redacted ->> 'statement'),
           v_redacted -> 'attributes', 'profile', p_actor_profile_id, 'privacy_redaction'
      from public.point_revisions r where r.point_id = p_point_id
    returning id into v_new_rev;
    perform public._tombstone_revisions(null, v_old_rev);
    update public.handover_points
       set current_revision_id = v_new_rev,
           inference_rationale = nullif(btrim(v_redacted ->> 'inferenceRationale'), ''),
           conflict_resolution_note = nullif(btrim(v_redacted ->> 'conflictResolutionNote'), ''),
           conflict_resolved_by = case when nullif(btrim(v_redacted ->> 'conflictResolutionNote'), '') is null then null else conflict_resolved_by end,
           conflict_resolved_at = case when nullif(btrim(v_redacted ->> 'conflictResolutionNote'), '') is null then null else conflict_resolved_at end,
           privacy_review = 'cleared', privacy_review_flagged_at = null
     where id = p_point_id;
    with u as (
      update public.publication_points
         set content = (content || jsonb_build_object('title', btrim(v_redacted ->> 'title'), 'statement', btrim(v_redacted ->> 'statement'),
                                                      'attributes', v_redacted -> 'attributes', 'textRedacted', true))
                       || jsonb_build_object('conflictResolution',
                            case when jsonb_typeof(content -> 'conflictResolution') = 'object'
                                      and nullif(btrim(v_redacted ->> 'conflictResolutionNote'), '') is not null
                                 then jsonb_set(content -> 'conflictResolution', '{note}', to_jsonb(btrim(v_redacted ->> 'conflictResolutionNote')))
                                 else 'null'::jsonb end)
       where revision_id = v_old_rev and redacted_at is null
      returning publication_id)
    select coalesce(array_agg(publication_id), '{}') into v_pubs from u;
    v_changed_pubs := v_changed_pubs || v_pubs;
    update public.publication_points set privacy_hold = false where point_id = p_point_id and privacy_hold;
    v_to_state := 'pending';

  else -- withdraw: as for X in §12.8 step 3
    perform public._tombstone_revisions(p_point_id, null);
    -- M2: a withdrawn point keeps no answerable Gap Interview question. Text stays as decided on its
    -- own gap_question surface; only the status changes.
    update public.gap_questions
       set status = 'waived', waived_reason = coalesce(waived_reason, 'privacy_review')
     where point_id = p_point_id and status = 'open';
    update public.handover_points
       set review_state = 'rejected', erased_at = now(), inference_rationale = null, conflict_resolution_note = null,
           privacy_review = 'cleared', privacy_review_flagged_at = null
     where id = p_point_id;
    with u as (
      update public.publication_points set content = '{"redacted": true}'::jsonb, redacted_at = now(), privacy_hold = false
       where point_id = p_point_id and redacted_at is null
      returning publication_id)
    select coalesce(array_agg(publication_id), '{}') into v_pubs from u;
    v_changed_pubs := v_changed_pubs || v_pubs;
    v_to_state := 'rejected';
  end if;

  -- Publications and acknowledgements.
  select coalesce(array_agg(distinct x order by x), '{}') into v_changed_pubs from unnest(v_changed_pubs) x;
  update public.handover_publications set summary = null, redacted_at = coalesce(redacted_at, now()) where id = any (v_changed_pubs);
  if v_h.current_publication_id = any (v_changed_pubs) then
    update public.acknowledgements set invalidated_at = now(), invalidation_reason = 'privacy_review'
     where publication_id = v_h.current_publication_id and invalidated_at is null;
    get diagnostics v_acks = row_count;
    if v_h.state = 'acknowledged' then
      perform public.transition_handover(v_handover, 'approved', null);
    end if;
  end if;

  -- Audit: structural only (§12.7).
  select coalesce(jsonb_object_agg(k, jsonb_build_object(
           'keep', coalesce(jsonb_array_length(v_by_kind -> k -> 'keep'), 0),
           'redact', coalesce(jsonb_array_length(v_by_kind -> k -> 'redact'), 0),
           'remove', coalesce(jsonb_array_length(v_by_kind -> k -> 'remove'), 0))), '{}'::jsonb)
    into v_counts from jsonb_object_keys(v_by_kind) k;

  insert into public.review_actions (handover_id, point_id, revision_id, actor_profile_id, action, from_review_state,
                                     to_review_state, metadata)
  values (v_handover, p_point_id, coalesce(v_new_rev, v_p.current_revision_id), p_actor_profile_id, 'resolve_privacy_review',
          v_p.review_state, v_to_state,
          jsonb_strip_nulls(jsonb_build_object('decision', v_decision, 'newRevisionId', v_new_rev, 'surfaceDecisions', v_counts)));

  perform public._audit(v_handover, p_actor_profile_id, null, 'point.privacy_review.resolved', 'point', p_point_id,
                        jsonb_build_object('privacyReview', 'required', 'revisionId', v_p.current_revision_id),
                        jsonb_strip_nulls(jsonb_build_object(
                          'decision', v_decision, 'surfaces', v_by_kind, 'newRevisionId', v_new_rev,
                          'publicationsChanged', cardinality(v_changed_pubs), 'acknowledgementsInvalidated', v_acks,
                          'pointsFlagged', cardinality(v_flagged))));

  return jsonb_build_object('decision', v_decision, 'newRevisionId', v_new_rev,
                            'publicationsChanged', cardinality(v_changed_pubs), 'acknowledgementsInvalidated', v_acks,
                            'pointsFlagged', cardinality(v_flagged));
end $$;

-- ── erasure_target (§12.8, R8) ───────────────────────────────────────────────
-- Server-only (service_role), creator only. What eraseParticipant must write into the recovery manifest
-- BEFORE calling erase_participant, for a participant row: the identity kind, hash and pepper version, and
-- for a NAME identity the one source the erasure is limited to (D29). The hash never reaches a browser.

create function public.erasure_target(p_actor_profile_id uuid, p_participant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_p public.source_participants;
begin
  select * into v_p from public.source_participants where id = p_participant_id;
  if not found or not public._is_member_as(v_actor, v_p.handover_id) then
    raise exception 'participant not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, v_p.handover_id) then
    raise exception 'only the creator can erase a participant' using errcode = 'BTFB0';
  end if;
  return jsonb_build_object(
    'handoverId', v_p.handover_id, 'identityKind', v_p.identity_kind,
    'identityHashHex', encode(v_p.identity_hash, 'hex'), 'pepperVersion', v_p.identity_pepper_version,
    'scopeSourceId', case when v_p.identity_kind = 'name' then v_p.source_id end);
end $$;

-- ── erase_participant (§12.8) ────────────────────────────────────────────────
-- Idempotent on p_erasure_id (the recovery-manifest eventId, written by main BEFORE this call).
-- R8 (D24, D29) scope: a PHONE identity is erased in every source of the handover (p_scope_source_id
-- NULL). A NAME identity is erased only in p_scope_source_id, the source of the participant row being
-- erased: names are weak identities, so another person who shares the name is never erased by it.
-- Same-name participants elsewhere are counted in sameNameParticipantsElsewhere for separate review.
-- Only the creator may erase; the sole exception is a replay by the dedicated restore role, identified by
-- session_user = 'baton_restore'. That role is NOT created by any migration: its Supabase behaviour is
-- unverified (§12.8 point 10, assumption 13, D27). Until it exists, this branch is unreachable.

create function public.erase_participant(
  p_erasure_id uuid, p_handover_id uuid, p_identity_kind text, p_identity_hash bytea, p_identity_pepper_version text,
  p_scope_source_id uuid, p_actor_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers;
  v_replay boolean := session_user = 'baton_restore';
  v_exclusion uuid;
  v_e uuid[];
  v_links uuid[];
  v_x uuid[];
  v_p uuid[];
  v_extra uuid[];
  v_point uuid;
  v_flagged uuid[] := '{}';
  v_changed_pubs uuid[] := '{}';
  v_pubs uuid[];
  v_messages int := 0;
  v_quotes int := 0;
  v_acks int := 0;
  v_same_name int := 0;
  v_sources uuid[];
  v_report jsonb;
begin
  perform set_config('lock_timeout', '5s', true);
  if p_erasure_id is null or p_identity_hash is null then
    raise exception 'erasure id and identity hash are required' using errcode = 'BTVF0';
  end if;
  if p_identity_kind is null or p_identity_kind not in ('phone', 'name') then
    raise exception 'unknown identity kind' using errcode = 'BTVF0';
  end if;
  if (p_identity_kind = 'name') <> (p_scope_source_id is not null) then
    raise exception 'a name erasure names its one source; a phone erasure names none' using errcode = 'BTVF0';
  end if;

  -- (1) Handover lock first; a soft-deleted handover can still be erased until it is purged.
  select * into v_h from public.handovers where id = p_handover_id for update;
  if not found then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;

  -- Step 0: idempotency.
  if exists (select 1 from public.participant_erasures where id = p_erasure_id) then
    return jsonb_build_object('alreadyApplied', true, 'messagesDeleted', 0, 'quotesDeleted', 0, 'pointsErased', 0,
                              'pointsFlaggedForPrivacyReview', 0, 'publicationsRedacted', 0, 'acknowledgementsInvalidated', 0,
                              'sameNameParticipantsElsewhere', 0);
  end if;
  if not v_replay and (p_actor_profile_id is null or p_actor_profile_id is distinct from v_h.created_by) then
    raise exception 'only the creator can erase a participant' using errcode = 'BTFB0';
  end if;
  if p_identity_pepper_version is distinct from 'p1' then
    raise exception 'unsupported identity pepper version' using errcode = 'BTVF0';
  end if;

  -- Sources S: every source of H for a phone identity, only the scope source for a name identity.
  if p_identity_kind = 'name' then
    if not exists (select 1 from public.sources where id = p_scope_source_id and handover_id = p_handover_id) then
      raise exception 'source not found' using errcode = 'BTNF0';
    end if;
    v_sources := array[p_scope_source_id];
  else
    select coalesce(array_agg(s.id order by s.id), '{}') into v_sources from public.sources s where s.handover_id = p_handover_id;
  end if;

  -- Scope (computed before any delete; links cascade with their evidence). A phone erasure also covers
  -- quotes whose source was purged (source_id NULL); a name erasure cannot attribute those (§12.8).
  select coalesce(array_agg(q.id order by q.id), '{}') into v_e
    from public.evidence_quotes q
   where q.handover_id = p_handover_id and q.kind = 'source_quote'
     and q.author_identity_kind = p_identity_kind
     and q.author_identity_hash = p_identity_hash and q.author_identity_pepper_version = p_identity_pepper_version
     and (p_identity_kind = 'phone' or q.source_id = p_scope_source_id);
  select coalesce(array_agg(pe.id order by pe.id), '{}') into v_links
    from public.point_evidence pe where pe.evidence_id = any (v_e);
  select coalesce(array_agg(p.id order by p.id), '{}') into v_x
    from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null
     and exists (select 1 from public.point_evidence pe where pe.point_id = p.id and pe.evidence_id = any (v_e))
     and not exists (select 1 from public.point_evidence pe where pe.point_id = p.id and not (pe.evidence_id = any (v_e)));
  select coalesce(array_agg(p.id order by p.id), '{}') into v_p
    from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and not (p.id = any (v_x))
     and exists (select 1 from public.point_evidence pe where pe.point_id = p.id and pe.evidence_id = any (v_e));
  -- Surviving points that use testimony answering a question of an erased point (step 3, last bullet).
  select coalesce(array_agg(distinct pe.point_id order by pe.point_id), '{}') into v_extra
    from public.gap_questions q
    join public.gap_answers a on a.gap_question_id = q.id
    join public.evidence_quotes t on t.gap_answer_id = a.id
    join public.point_evidence pe on pe.evidence_id = t.id
    join public.handover_points sp on sp.id = pe.point_id
   where q.point_id = any (v_x) and sp.erased_at is null and not (sp.id = any (v_x)) and not (sp.id = any (v_p));

  -- (3) Lock order.
  perform 1 from public.handover_points where id = any (v_x || v_p || v_extra) order by id for update;
  perform 1 from public.point_revisions where point_id = any (v_x) order by id for update;
  perform 1 from public.point_evidence where point_id = any (v_x || v_p) order by id for update;
  perform 1 from public.review_actions where point_id = any (v_x || v_p) order by id for update;
  perform 1 from public.gap_questions where point_id = any (v_x) order by id for update;
  perform 1 from public.evidence_quotes where id = any (v_e) order by id for update;
  perform 1 from public.handover_publications where handover_id = p_handover_id order by id for update;
  perform 1 from public.publication_points where handover_id = p_handover_id order by id for update;
  perform 1 from public.acknowledgements where handover_id = p_handover_id order by id for update;

  perform set_config('baton.erasure', 'on', true);

  -- Step 1: the handover-wide exclusion, so later uploads drop the participant at parse time.
  -- (phone: applied to later uploads; name: only detected there and decided per source, §6.8.1)
  insert into public.source_exclusions (handover_id, source_id, requested_by, kind, participant_identity_kind,
                                        participant_identity_hash, participant_identity_pepper_version, requested_via)
  values (p_handover_id, null, case when v_replay then null else p_actor_profile_id end, 'participant', p_identity_kind,
          p_identity_hash, p_identity_pepper_version, 'participant_request')
  on conflict (handover_id, participant_identity_kind, participant_identity_hash, participant_identity_pepper_version)
    where kind = 'participant' and source_id is null
  do nothing;
  select id into v_exclusion from public.source_exclusions
   where handover_id = p_handover_id and kind = 'participant' and source_id is null
     and participant_identity_kind = p_identity_kind
     and participant_identity_hash = p_identity_hash and participant_identity_pepper_version = p_identity_pepper_version;

  -- Step 2: evidence. Notes and metadata of review actions on those links can quote evidence.
  update public.review_actions set note = null, metadata = null
   where point_evidence_id = any (v_links) and (note is not null or metadata is not null);
  delete from public.evidence_quotes where id = any (v_e);
  get diagnostics v_quotes = row_count;

  -- Step 1 (cont.): the participant's own messages, label and exclusion flag.
  delete from public.source_messages m
   using public.source_participants sp
   where sp.id = m.participant_id and sp.handover_id = p_handover_id and sp.source_id = any (v_sources)
     and sp.identity_kind = p_identity_kind
     and sp.identity_hash = p_identity_hash and sp.identity_pepper_version = p_identity_pepper_version;
  get diagnostics v_messages = row_count;
  -- M3: a conversation's preview is its first masked line and may be the participant's own words, and its
  -- participant list and counts describe them. For every conversation they took part in: clear the
  -- preview, drop their local id, and recount from the messages that remain.
  update public.source_conversations c
     set preview = null,
         participant_local_ids = array_remove(c.participant_local_ids, sp.local_id),
         message_count = (select count(*) from public.source_messages m where m.conversation_id = c.id),
         started_at = (select min(m.sent_at) from public.source_messages m where m.conversation_id = c.id),
         ended_at = (select max(m.sent_at) from public.source_messages m where m.conversation_id = c.id)
    from public.source_participants sp
   where sp.handover_id = p_handover_id and sp.source_id = any (v_sources) and sp.identity_kind = p_identity_kind
     and sp.identity_hash = p_identity_hash and sp.identity_pepper_version = p_identity_pepper_version
     and c.source_id = sp.source_id and sp.local_id = any (c.participant_local_ids);
  update public.source_participants set excluded = true, display_label = 'Removed participant', message_count = 0
   where handover_id = p_handover_id and source_id = any (v_sources) and identity_kind = p_identity_kind
     and identity_hash = p_identity_hash and identity_pepper_version = p_identity_pepper_version;
  update public.sources s
     set message_count = (select count(*) from public.source_messages m where m.source_id = s.id),
         first_message_at = (select min(m.sent_at) from public.source_messages m where m.source_id = s.id),
         last_message_at = (select max(m.sent_at) from public.source_messages m where m.source_id = s.id)
   where s.id in (select sp.source_id from public.source_participants sp
                   where sp.handover_id = p_handover_id and sp.source_id = any (v_sources)
                     and sp.identity_kind = p_identity_kind and sp.identity_hash = p_identity_hash
                     and sp.identity_pepper_version = p_identity_pepper_version);
  -- D29: same-name participants in OTHER sources are reported, never erased by name.
  if p_identity_kind = 'name' then
    select count(*) into v_same_name from public.source_participants sp
     where sp.handover_id = p_handover_id and sp.source_id <> p_scope_source_id and sp.identity_kind = 'name'
       and sp.identity_hash = p_identity_hash and sp.identity_pepper_version = p_identity_pepper_version
       and not sp.excluded;
  end if;

  -- Step 3: points derived only from erased evidence (X).
  if cardinality(v_x) > 0 then
    update public.handover_points set erased_at = now(), inference_rationale = null, conflict_resolution_note = null
     where id = any (v_x);
    update public.point_revisions
       set title = '[removed]', statement = '[removed]', attributes = '{}'::jsonb, edit_reason = null,
           redacted_at = now(), redaction_kind = 'tombstone'
     where point_id = any (v_x) and redaction_kind is distinct from 'tombstone';
    update public.review_actions set note = null, metadata = null
     where point_id = any (v_x) and (note is not null or metadata is not null);
    update public.gap_questions
       set status = 'waived', question = '[removed]', context = null, waived_reason = 'participant_erasure'
     where point_id = any (v_x);
  end if;

  -- Step 4: partly affected points (P), plus points using answers to X's questions.
  foreach v_point in array (v_p || v_extra) loop
    perform public.recompute_point_status(v_point);
    if public._flag_point_for_privacy(v_point, 'participant_erasure') then
      v_flagged := v_flagged || v_point;
    end if;
  end loop;

  -- Step 5: every publication snapshot of the handover.
  with u as (
    update public.publication_points set content = '{"redacted": true}'::jsonb, redacted_at = now()
     where handover_id = p_handover_id and point_id = any (v_x) and redacted_at is null
    returning publication_id)
  select coalesce(array_agg(publication_id), '{}') into v_pubs from u;
  v_changed_pubs := v_changed_pubs || v_pubs;
  with u as (
    update public.publication_points pp set content = public._redact_evidence_items(pp.content, v_e)
     where pp.handover_id = p_handover_id and public._redact_evidence_items(pp.content, v_e) is distinct from pp.content
    returning publication_id)
  select coalesce(array_agg(publication_id), '{}') into v_pubs from u;
  v_changed_pubs := v_changed_pubs || v_pubs;
  select coalesce(array_agg(publication_id), '{}') into v_pubs from public.publication_points where point_id = any (v_flagged);
  v_changed_pubs := v_changed_pubs || v_pubs;
  select coalesce(array_agg(distinct x order by x), '{}') into v_changed_pubs from unnest(v_changed_pubs) x;
  update public.handover_publications set summary = null, redacted_at = coalesce(redacted_at, now())
   where id = any (v_changed_pubs);

  -- Step 6: acknowledgements of every changed publication.
  update public.acknowledgements set invalidated_at = now(), invalidation_reason = 'participant_erasure'
   where publication_id = any (v_changed_pubs) and invalidated_at is null;
  get diagnostics v_acks = row_count;
  if v_h.current_publication_id = any (v_changed_pubs) and v_h.state = 'acknowledged' then
    perform public.transition_handover(p_handover_id, 'approved', null);
  end if;

  -- Step 7: audit counts only; scrub earlier entries about erased rows (defence in depth).
  update public.audit_logs set before = null, after = null
   where entity_id = any (v_e || v_links || v_x) and (before is not null or after is not null);

  v_report := jsonb_build_object(
    'messagesDeleted', v_messages, 'quotesDeleted', v_quotes, 'pointsErased', cardinality(v_x),
    'pointsFlaggedForPrivacyReview', cardinality(v_flagged), 'publicationsRedacted', cardinality(v_changed_pubs),
    'acknowledgementsInvalidated', v_acks, 'sameNameParticipantsElsewhere', v_same_name);

  insert into public.participant_erasures (id, handover_id, exclusion_id, identity_kind, scope_source_id, actor_profile_id, replayed)
  values (p_erasure_id, p_handover_id, v_exclusion, p_identity_kind, p_scope_source_id,
          case when v_replay then null else p_actor_profile_id end, v_replay);

  perform public._audit(p_handover_id, case when v_replay then null else p_actor_profile_id end, null,
                        case when v_replay then 'restore.erasure_replayed' else 'participant.erased' end,
                        'source_exclusion', v_exclusion, null, v_report);
  return v_report || jsonb_build_object('alreadyApplied', false);
end $$;
