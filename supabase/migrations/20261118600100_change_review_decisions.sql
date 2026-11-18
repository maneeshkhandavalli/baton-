-- Round 3 Task 05E (Living Handover, stage 4): the reviewer decision workflow for change-review items.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY (docs/round3/living-handover-versions.md). Requires 20261118500100.
-- ADDITIVE: two columns on source_change_review_items, one append-only table, one review-action value, new functions,
-- and CREATE OR REPLACE of the item guard. No existing row is changed; no published snapshot is touched.
--
-- decide_change_review_item(actor, item, decision, expected_state, expected_point_revision, note, payload) is the ONLY
-- way to decide an item (service role; the server passes its verified actor, as every Baton mutation). It locks the
-- handover (share) and the item, re-checks that the actor is a review role who can see the item's point(s), sources and
-- evidence, that the handover is in review, that the item is not stale, that its update and source version are still
-- current, that the handover's current publication is still the item's baseline, and that the point is still at the
-- revision the reviewer saw. Then, atomically, the kind-specific effect, the item's state, one decision row and the audit.
--
--   investigate (all kinds)  open → investigating (or another note while investigating). A note is required.
--   reject      (all kinds)  → rejected. A reason is required. new_information: the candidate point is rejected
--                            through reject_point (unless it already is). Every other kind changes no point or evidence.
--   accept                   → accepted, with a meaning per kind:
--     evidence_moved         the relocated quotation (exactly the item's span in the CURRENT version) is linked to the
--                            point as evidence (existing quote reused, else created as an exact slice); the historical
--                            evidence stays. Refused when the move was ambiguous or the new message is gone.
--     evidence_missing       a human re-attestation that the point stands although the source no longer contains its
--                            quotation: a note (≥ 20 characters) is required; no evidence is created or removed.
--     possible_contradiction the reviewer's corrected wording goes through edit_point (a new revision; an approved point
--                            returns to pending review) AND a supporting quotation chosen inside the new message is linked
--                            as evidence. Nothing is copied automatically.
--     support_changed        a human confirmation of the new support assessment (note required); evidence and content
--                            are unchanged (the verdicts already in point_evidence speak for themselves).
--     new_information        the candidate point is approved through approve_point (its own evidence-status rules:
--                            confirm inferred, resolve conflict, known gap), never duplicated.
-- Repeating a decision that already took effect (same actor, same decision) returns `unchanged` and writes nothing;
-- any other mismatch with the expected state is a conflict. Published snapshots are never touched.

-- ── 1. item decision columns and guard ───────────────────────────────────────

alter table public.source_change_review_items
  add column decided_by uuid references public.profiles (id) on delete set null,
  add column decided_at timestamptz,
  add constraint source_change_review_items_decided
    check ((decided_at is not null) = (state in ('accepted', 'rejected')) and (decided_by is null or decided_at is not null));

create or replace function public._guard_source_change_review_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public._privileged('baton.change_detection') and new.state = 'open' and new.stale_reason is null
       and new.decided_by is null and new.decided_at is null then
      return new;
    end if;
    raise exception 'change-review items are created only by change detection' using errcode = 'BTIT0';
  elsif tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if; -- cascades (handover, change, point, evidence)
    raise exception 'change-review items are never deleted' using errcode = 'BTIT0';
  end if;

  if (new.id, new.handover_id, new.change_id, new.kind, new.point_id, new.base_revision_id, new.base_publication_id,
      new.old_evidence_id, new.new_evidence_id, new.new_quote_start, new.new_quote_end, new.candidate_point_id, new.detail,
      new.dedupe_key, new.detector_version, new.created_at)
     is distinct from
     (old.id, old.handover_id, old.change_id, old.kind, old.point_id, old.base_revision_id, old.base_publication_id,
      old.old_evidence_id, old.new_evidence_id, old.new_quote_start, old.new_quote_end, old.candidate_point_id, old.detail,
      old.dedupe_key, old.detector_version, old.created_at) then
    raise exception 'a change-review item''s references are immutable' using errcode = 'BTIT0';
  end if;

  -- ON DELETE SET NULL side effects only (a pruned message, a removed flag, a purged run, a deleted account)
  if (new.state, new.state_changed_at, new.stale_reason, new.decided_at) is not distinct from
     (old.state, old.state_changed_at, old.stale_reason, old.decided_at)
     and (new.new_source_message_id is not distinct from old.new_source_message_id or new.new_source_message_id is null)
     and (new.review_flag_id is not distinct from old.review_flag_id or new.review_flag_id is null)
     and (new.run_id is not distinct from old.run_id or new.run_id is null)
     and (new.decided_by is not distinct from old.decided_by or new.decided_by is null) then
    return new;
  end if;

  if (new.new_source_message_id, new.review_flag_id, new.run_id) is distinct from (old.new_source_message_id, old.review_flag_id, old.run_id) then
    raise exception 'a change-review item''s references are immutable' using errcode = 'BTIT0';
  end if;
  -- automatic invalidation: a newer version superseded the update, or the source was removed
  if public._privileged('baton.change_detection') and old.state in ('open', 'investigating') and new.state = 'stale'
     and new.stale_reason is not null and (new.decided_by, new.decided_at) is not distinct from (old.decided_by, old.decided_at) then
    return new;
  end if;
  -- reviewer decisions: only through decide_change_review_item (it sets baton.change_review)
  if public._privileged('baton.change_review') and new.stale_reason is null
     and (old.state, new.state) in (('open', 'investigating'), ('investigating', 'investigating'), ('open', 'accepted'), ('open', 'rejected'),
                                    ('investigating', 'accepted'), ('investigating', 'rejected'))
     and ((new.state = 'investigating' and new.decided_by is null and new.decided_at is null)
          or (new.state in ('accepted', 'rejected') and new.decided_by is not null and new.decided_at is not null)) then
    return new;
  end if;
  raise exception 'this change-review state change is not allowed' using errcode = 'BTIT0';
end $$;

-- ── 2. decision history (append-only) ────────────────────────────────────────

create table public.source_change_review_decisions (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  item_id uuid not null references public.source_change_review_items (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  decision text not null check (decision in ('investigate', 'accept', 'reject')),
  from_state text not null check (from_state in ('open', 'investigating')),
  to_state text not null check (to_state in ('investigating', 'accepted', 'rejected')),
  note text check (note is null or char_length(note) between 1 and 2000),
  -- what the decision changed, if anything (references only)
  point_revision_id uuid,
  point_evidence_id uuid,
  created_at timestamptz not null default now()
);
create index source_change_review_decisions_item_idx on public.source_change_review_decisions (item_id, created_at);
create index source_change_review_decisions_handover_idx on public.source_change_review_decisions (handover_id, created_at);

alter table public.source_change_review_decisions enable row level security;
-- exactly the item's visibility (the subquery is filtered by the item's own policy)
create policy source_change_review_decisions_select on public.source_change_review_decisions
  for select to authenticated
  using (exists (select 1 from public.source_change_review_items i where i.id = item_id));

create function public._guard_source_change_review_decisions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and public._privileged('baton.change_review') then return new; end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op = 'UPDATE' and new.actor_profile_id is null and old.actor_profile_id is not null
     and (new.id, new.handover_id, new.item_id, new.decision, new.from_state, new.to_state, new.note, new.point_revision_id,
          new.point_evidence_id, new.created_at)
         is not distinct from (old.id, old.handover_id, old.item_id, old.decision, old.from_state, old.to_state, old.note,
                               old.point_revision_id, old.point_evidence_id, old.created_at) then
    return new; -- ON DELETE SET NULL of the account
  end if;
  raise exception 'change-review decisions are append-only' using errcode = 'BTIT0';
end $$;

create trigger source_change_review_decisions_guard
  before insert or update or delete on public.source_change_review_decisions
  for each row execute function public._guard_source_change_review_decisions();

-- A review action records the change-review decision on the point's own history.
alter table public.review_actions drop constraint review_actions_action_check;
alter table public.review_actions add constraint review_actions_action_check
  check (action in ('approve', 'reject', 'reopen', 'edit', 'confirm_inferred', 'resolve_conflict', 'exclude_evidence',
                    'restore_evidence', 'change_access', 'auto_reopen', 'privacy_hold', 'resolve_privacy_review', 'change_review'));

-- ── 3. helpers ───────────────────────────────────────────────────────────────

-- The slice [p_start, p_end) of p_body in JavaScript UTF-16 code units (the app's offset convention); NULL when the
-- offsets do not fall on character boundaries or outside the text.
create function public._utf16_slice(p_body text, p_start int, p_end int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_units int := 0;
  v_i int := 1;
  v_len int := char_length(p_body);
  v_from int;
  v_to int;
begin
  if p_body is null or p_start is null or p_end is null or p_start < 0 or p_end <= p_start then
    return null;
  end if;
  while v_i <= v_len + 1 loop
    if v_units = p_start then v_from := v_i; end if;
    if v_units = p_end then v_to := v_i; exit; end if;
    exit when v_i > v_len;
    v_units := v_units + case when ascii(substr(p_body, v_i, 1)) > 65535 then 2 else 1 end;
    v_i := v_i + 1;
  end loop;
  if v_from is null or v_to is null then
    return null;
  end if;
  return substr(p_body, v_from, v_to - v_from);
end $$;

-- An exact source quote of the CURRENT version's message span, reused when it already exists (internal).
create function public._change_review_quote(p_handover_id uuid, p_message_id uuid, p_start int, p_end int)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q uuid;
  v_m public.source_messages;
  v_s public.sources;
  v_text text;
begin
  select * into v_m from public.source_messages where id = p_message_id and handover_id = p_handover_id;
  if not found then
    raise exception 'the new message is no longer available' using errcode = 'BTPF0';
  end if;
  select * into v_s from public.sources where id = v_m.source_id;
  if v_s.deleted_at is not null or v_s.superseded_at is not null or v_s.version_number is null then
    raise exception 'that source version is no longer current' using errcode = 'BTCF0';
  end if;
  select id into v_q from public.evidence_quotes
   where source_message_id = p_message_id and quote_start = p_start and quote_end = p_end;
  if v_q is not null then
    return v_q;
  end if;
  v_text := public._utf16_slice(v_m.body, p_start, p_end);
  -- the app's quote minimum (§10.7.4), approximated on the server: 12 characters and 3 words
  if v_text is null or char_length(btrim(v_text)) < 12
     or cardinality(array_remove(regexp_split_to_array(btrim(v_text), '\s+'), '')) < 3 then
    raise exception 'the supporting quotation is too short or not inside the message' using errcode = 'BTVF0';
  end if;
  insert into public.evidence_quotes (handover_id, kind, source_id, source_message_id, quote_text, quote_start, quote_end,
                                      message_sent_at, author_label, author_identity_kind, author_identity_hash,
                                      author_identity_pepper_version, source_title, location, quote_check, quote_checked_at,
                                      access_level)
  select v_m.handover_id, 'source_quote', v_m.source_id, v_m.id, v_text, p_start, p_end, v_m.sent_at,
         sp.display_label, sp.identity_kind, sp.identity_hash, sp.identity_pepper_version, v_s.title, v_m.location,
         'exact', now(), v_s.access_level
    from (select 1) one
    left join public.source_participants sp on sp.id = v_m.participant_id
  returning id into v_q;
  return v_q;
end $$;

-- Links evidence to a point (an existing active link is reused; an excluded one is not revived here).
create function public._change_review_link(p_point public.handover_points, p_evidence_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.point_evidence;
begin
  select * into v_link from public.point_evidence where point_id = p_point.id and evidence_id = p_evidence_id;
  if found then
    if v_link.excluded_at is not null then
      raise exception 'that quotation was excluded from this point; restore it in the point''s evidence instead' using errcode = 'BTPF0';
    end if;
    return v_link.id;
  end if;
  insert into public.point_evidence (handover_id, point_id, evidence_id) values (p_point.handover_id, p_point.id, p_evidence_id)
  returning id into v_link.id;
  return v_link.id;
end $$;

-- ── 4. the decision ──────────────────────────────────────────────────────────

create function public.decide_change_review_item(p_actor_profile_id uuid, p_item_id uuid, p_decision text,
  p_expected_state text, p_expected_point_revision_id uuid, p_note text default null, p_payload jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_i public.source_change_review_items;
  v_h public.handovers;
  v_c public.source_version_changes;
  v_to public.sources;
  v_from_s public.sources;
  v_p public.handover_points;
  v_target uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_last public.source_change_review_decisions;
  v_to_state text;
  v_rev uuid;
  v_link uuid;
  v_q uuid;
  v_rev_after uuid;
begin
  if p_decision is null or p_decision not in ('investigate', 'accept', 'reject') then
    raise exception 'unknown decision' using errcode = 'BTVF0';
  end if;
  if p_expected_state is null or p_expected_state not in ('open', 'investigating') then
    raise exception 'unknown expected state' using errcode = 'BTVF0';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'the note is too long' using errcode = 'BTVF0';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'invalid decision details' using errcode = 'BTVF0';
  end if;

  select * into v_i from public.source_change_review_items where id = p_item_id;
  if not found then
    raise exception 'change not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_share(v_i.handover_id);
  select * into v_i from public.source_change_review_items where id = p_item_id for update;
  select * into v_c from public.source_version_changes where id = v_i.change_id;
  select * into v_to from public.sources where id = v_c.to_source_id;
  select * into v_from_s from public.sources where id = v_c.from_source_id;
  v_target := coalesce(v_i.point_id, v_i.candidate_point_id);

  -- Visibility: a review role who can see the point(s), both versions and the evidence. Otherwise "not found" (§8.5).
  if not public._is_review_role_as(v_actor, v_i.handover_id)
     or not public._point_visible_as(v_actor, v_target)
     or not public._within_clearance_as(v_actor, v_i.handover_id, v_to.access_level)
     or not public._within_clearance_as(v_actor, v_i.handover_id, v_from_s.access_level)
     or exists (select 1 from public.evidence_quotes q where q.id in (v_i.old_evidence_id, v_i.new_evidence_id)
                 and not public._within_clearance_as(v_actor, v_i.handover_id, q.access_level)) then
    raise exception 'change not found' using errcode = 'BTNF0';
  end if;
  if v_h.state <> 'in_review' then
    raise exception 'changes can be decided only while the handover is in review' using errcode = 'BTIT0';
  end if;

  -- Stale: a newer version (or a removal) replaced the source state this item describes.
  if v_i.state = 'stale' or v_c.state = 'superseded' or v_to.deleted_at is not null or v_to.superseded_at is not null then
    raise exception 'this change belongs to a source version that has been replaced' using errcode = 'BTIT0';
  end if;

  -- Expected state. A repeat of a decision that already took effect writes nothing.
  if v_i.state <> p_expected_state then
    select * into v_last from public.source_change_review_decisions where item_id = v_i.id order by created_at desc, id desc limit 1;
    if v_last.id is not null and v_last.actor_profile_id = v_actor and v_last.decision = p_decision and v_last.to_state = v_i.state then
      return jsonb_build_object('outcome', 'unchanged', 'itemId', v_i.id, 'state', v_i.state);
    end if;
    raise exception 'this change was decided or updated by someone else' using errcode = 'BTCF0';
  end if;

  -- The context the reviewer saw is still current: the baseline publication and the point's revision.
  if v_h.current_publication_id is distinct from v_i.base_publication_id then
    raise exception 'the handover was published since this change was found' using errcode = 'BTCF0';
  end if;
  select * into v_p from public.handover_points where id = v_target for update;
  if v_p.erased_at is not null then
    raise exception 'change not found' using errcode = 'BTNF0';
  end if;
  if v_p.current_revision_id is distinct from p_expected_point_revision_id then
    raise exception 'the point changed since it was loaded' using errcode = 'BTCF0';
  end if;

  -- Investigate a second time: only a new note; an identical repeat writes nothing.
  if p_decision = 'investigate' and v_i.state = 'investigating' then
    select * into v_last from public.source_change_review_decisions where item_id = v_i.id order by created_at desc, id desc limit 1;
    if v_last.id is not null and v_last.actor_profile_id = v_actor and v_last.decision = 'investigate' and v_last.note is not distinct from v_note then
      return jsonb_build_object('outcome', 'unchanged', 'itemId', v_i.id, 'state', v_i.state);
    end if;
  end if;

  -- Required inputs per decision and kind
  if p_decision in ('investigate', 'reject') and v_note is null then
    raise exception 'a note is required' using errcode = 'BTVF0';
  end if;
  if p_decision = 'accept' and v_i.kind in ('evidence_missing', 'support_changed') and (v_note is null or char_length(v_note) < 20) then
    raise exception 'explain why the point still stands (at least 20 characters)' using errcode = 'BTVF0';
  end if;
  if p_decision = 'accept' and v_i.kind = 'possible_contradiction' and v_note is null then
    raise exception 'a reason for the correction is required' using errcode = 'BTVF0';
  end if;

  v_to_state := case p_decision when 'investigate' then 'investigating' when 'accept' then 'accepted' else 'rejected' end;

  -- Kind-specific effects (only accept, and reject of new information, touch a point)
  if p_decision = 'accept' then
    if v_i.kind = 'evidence_moved' then
      if v_i.new_quote_start is null or v_i.new_source_message_id is null then
        raise exception 'the quotation was found in several places or its message is gone: reject it or investigate' using errcode = 'BTPF0';
      end if;
      v_q := public._change_review_quote(v_i.handover_id, v_i.new_source_message_id, v_i.new_quote_start, v_i.new_quote_end);
      v_link := public._change_review_link(v_p, v_q);
    elsif v_i.kind = 'possible_contradiction' then
      if v_i.new_source_message_id is null then
        raise exception 'the new message is no longer available' using errcode = 'BTPF0';
      end if;
      if jsonb_typeof(v_payload -> 'attributes') is distinct from 'object'
         or coalesce(btrim(v_payload ->> 'title'), '') = '' or coalesce(btrim(v_payload ->> 'statement'), '') = ''
         or jsonb_typeof(v_payload -> 'evidenceStart') is distinct from 'number' or jsonb_typeof(v_payload -> 'evidenceEnd') is distinct from 'number' then
        raise exception 'the corrected point and its supporting quotation are required' using errcode = 'BTVF0';
      end if;
      -- the supporting quotation first (validated inside the new version), then the human edit (a new revision)
      v_q := public._change_review_quote(v_i.handover_id, v_i.new_source_message_id,
                                         (v_payload ->> 'evidenceStart')::int, (v_payload ->> 'evidenceEnd')::int);
      v_rev := public.edit_point(v_actor, v_p.id, p_expected_point_revision_id, v_payload ->> 'title', v_payload ->> 'statement',
                                 v_payload -> 'attributes', v_note);
      select * into v_p from public.handover_points where id = v_p.id;
      v_link := public._change_review_link(v_p, v_q);
    elsif v_i.kind = 'new_information' then
      if v_p.review_state = 'rejected' then
        raise exception 'the new point was rejected in the review; reject this change instead' using errcode = 'BTIT0';
      end if;
      if v_p.review_state = 'pending' then
        perform public.approve_point(v_actor, v_p.id, p_expected_point_revision_id,
                                     coalesce((v_payload ->> 'confirmInferred')::boolean, false),
                                     v_payload ->> 'resolutionNote',
                                     coalesce((v_payload ->> 'asKnownGap')::boolean, false));
      end if;
    end if;
    -- evidence_missing and support_changed: a human re-attestation; nothing is created or removed
  elsif p_decision = 'reject' and v_i.kind = 'new_information' and v_p.review_state <> 'rejected' then
    perform public.reject_point(v_actor, v_p.id, v_note);
  end if;

  select current_revision_id into v_rev_after from public.handover_points where id = v_p.id;

  perform set_config('baton.change_review', 'on', true);
  update public.source_change_review_items
     set state = v_to_state, state_changed_at = now(),
         decided_by = case when v_to_state in ('accepted', 'rejected') then v_actor end,
         decided_at = case when v_to_state in ('accepted', 'rejected') then now() end
   where id = v_i.id;
  insert into public.source_change_review_decisions (handover_id, item_id, actor_profile_id, decision, from_state, to_state, note,
                                                     point_revision_id, point_evidence_id)
  values (v_i.handover_id, v_i.id, v_actor, p_decision, v_i.state, v_to_state, v_note, v_rev, v_link);
  perform set_config('baton.change_review', 'off', true);

  -- the point's own history: one review action per decision (the note stays out of the audit log, §12.7)
  select * into v_p from public.handover_points where id = v_p.id;
  perform public._record_review_action(v_p, v_actor, 'change_review', v_p.review_state, v_p.review_state, v_note,
                                       jsonb_build_object('changeReviewItemId', v_i.id, 'kind', v_i.kind, 'decision', p_decision,
                                                          'itemState', v_to_state, 'newRevisionId', v_rev),
                                       v_link, v_rev_after);
  perform public._audit(v_i.handover_id, v_actor, null, 'source_update.review_decided', 'source_change_review_item', v_i.id,
                        jsonb_build_object('state', v_i.state),
                        jsonb_strip_nulls(jsonb_build_object('state', v_to_state, 'kind', v_i.kind, 'decision', p_decision,
                                                             'changeId', v_i.change_id, 'pointRevisionId', v_rev,
                                                             'pointEvidenceId', v_link)));
  return jsonb_strip_nulls(jsonb_build_object('outcome', 'decided', 'itemId', v_i.id, 'state', v_to_state,
                                              'pointRevisionId', v_rev, 'pointEvidenceId', v_link));
end $$;

-- ── 5. read API for the reviewer (SECURITY INVOKER, RLS) ─────────────────────

-- Every change-review item the viewer may see, with what a reviewer needs to decide it: the baseline (published)
-- revision, the point's current revision, the historical quotation, the new message and span, the candidate point,
-- the support verdicts, and the decision history. Masked, pseudonymised text only (as stored).
create function public.api_get_change_reviews(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p_handover_id is null or not public.is_review_role(p_handover_id) then null else coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'changeId', i.change_id, 'kind', i.kind, 'state', i.state, 'staleReason', i.stale_reason,
             'detail', i.detail, 'createdAt', i.created_at, 'decidedAt', i.decided_at,
             'sourceId', c.to_source_id, 'previousSourceId', c.from_source_id, 'sourceTitle', ts.title,
             'fromVersion', c.from_version, 'toVersion', c.to_version, 'updateState', c.state,
             'basePublicationId', i.base_publication_id,
             'point', case when p.id is null then null else jsonb_build_object(
               'id', p.id, 'category', p.category, 'reviewState', p.review_state, 'evidenceStatus', p.evidence_status,
               'currentRevisionId', p.current_revision_id,
               'title', case when cr.redacted_at is null then cr.title end,
               'statement', case when cr.redacted_at is null then cr.statement end,
               'attributes', case when cr.redacted_at is null then cr.attributes end) end,
             'base', case when br.id is null then null else jsonb_build_object(
               'revisionId', br.id, 'revisionNumber', br.revision_number,
               'title', case when br.redacted_at is null then br.title end,
               'statement', case when br.redacted_at is null then br.statement end) end,
             'oldEvidence', case when oq.id is null then null else jsonb_build_object(
               'id', oq.id, 'quote', oq.quote_text, 'authorLabel', oq.author_label, 'sentAt', oq.message_sent_at,
               'sourceTitle', oq.source_title, 'verdict', ol.support_verdict, 'rationale', ol.verdict_rationale) end,
             'newMessage', case when nm.id is null then null else jsonb_build_object(
               'id', nm.id, 'body', nm.body, 'sentAt', nm.sent_at, 'authorLabel', nsp.display_label,
               'quoteStart', i.new_quote_start, 'quoteEnd', i.new_quote_end) end,
             'newEvidence', case when nq.id is null then null else jsonb_build_object(
               'id', nq.id, 'quote', nq.quote_text, 'authorLabel', nq.author_label, 'sentAt', nq.message_sent_at,
               'verdict', nl.support_verdict, 'rationale', nl.verdict_rationale) end,
             'decisions', coalesce((select jsonb_agg(jsonb_build_object(
                                       'decision', d.decision, 'fromState', d.from_state, 'toState', d.to_state, 'note', d.note,
                                       'actorProfileId', d.actor_profile_id, 'createdAt', d.created_at) order by d.created_at, d.id)
                                     from public.source_change_review_decisions d where d.item_id = i.id), '[]'::jsonb))
             order by c.created_at, i.kind, i.created_at, i.id)
      from public.source_change_review_items i -- RLS
      join public.source_version_changes c on c.id = i.change_id
      join public.sources ts on ts.id = c.to_source_id
      left join public.handover_points p on p.id = coalesce(i.point_id, i.candidate_point_id)
      left join public.point_revisions cr on cr.id = p.current_revision_id
      left join public.point_revisions br on br.id = i.base_revision_id
      left join public.evidence_quotes oq on oq.id = i.old_evidence_id
      left join public.point_evidence ol on ol.evidence_id = i.old_evidence_id and ol.point_id = i.point_id
      left join public.evidence_quotes nq on nq.id = i.new_evidence_id
      left join public.point_evidence nl on nl.evidence_id = i.new_evidence_id and nl.point_id = coalesce(i.point_id, i.candidate_point_id)
      left join public.source_messages nm on nm.id = i.new_source_message_id
      left join public.source_participants nsp on nsp.id = nm.participant_id
     where i.handover_id = p_handover_id), '[]'::jsonb) end
$$;

-- ── 6. grants ────────────────────────────────────────────────────────────────

revoke all on public.source_change_review_decisions from public, anon, authenticated, service_role;
grant select on public.source_change_review_decisions to authenticated, service_role;

revoke execute on function
  public._guard_source_change_review_decisions(), public._utf16_slice(text, int, int),
  public._change_review_quote(uuid, uuid, int, int), public._change_review_link(public.handover_points, uuid),
  public.decide_change_review_item(uuid, uuid, text, text, uuid, text, jsonb),
  public.api_get_change_reviews(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_change_review_item(uuid, uuid, text, text, uuid, text, jsonb) to service_role;
grant execute on function public.api_get_change_reviews(uuid) to authenticated, service_role;
