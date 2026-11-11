-- Integrity triggers: append-only guards, same-row invariants the FKs cannot express (§6.0 exceptions),
-- testimony sync, access propagation (§8.4), directContact floor (§3.1, D5) and status recompute hooks (§4.2).
--
-- Error codes raised by Baton functions (mapped by lib/db/errors.ts):
--   BTNF0 not_found · BTCF0 conflict · BTIT0 invalid_transition · BTPF0 precondition_failed
--   BTFB0 forbidden · BTVF0 validation_failed · BTUA0 unauthenticated · BTTI0 token_invalid

-- ── Flags and caller identity ────────────────────────────────────────────────

-- Transaction-local flags set only inside the narrowly scoped SECURITY DEFINER paths named in §2:
--   baton.erasure (erase_participant), baton.privacy_review (resolve_privacy_review),
--   baton.account_anonymisation (anonymise_account_snapshots), baton.purge (purge_handover),
--   plus baton.transition / baton.creator_transfer for handovers.state / created_by.
create function public._flag(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(current_setting(p_name, true), '') = 'on' $$;

-- True when the statement runs directly as an API role (PostgREST client, or service_role) rather than
-- inside a SECURITY DEFINER function owned by the migration role. Flags are honoured only in the latter.
create function public._is_api_role()
returns boolean
language sql
stable
set search_path = ''
as $$ select current_user in ('anon', 'authenticated', 'service_role') $$;

create function public._privileged(variadic p_flags text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select not public._is_api_role() and exists (select 1 from unnest(p_flags) f where public._flag(f))
$$;

-- ── updated_at ───────────────────────────────────────────────────────────────

create function public._touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public._touch_updated_at();
create trigger handovers_touch before update on public.handovers for each row execute function public._touch_updated_at();
create trigger sources_touch before update on public.sources for each row execute function public._touch_updated_at();
create trigger handover_points_touch before update on public.handover_points for each row execute function public._touch_updated_at();
create trigger gap_questions_touch before update on public.gap_questions for each row execute function public._touch_updated_at();

-- ── Append-only guards (§2) ──────────────────────────────────────────────────

create function public._guard_point_revisions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public._privileged('baton.purge') then return old; end if;
    raise exception 'point_revisions is append-only' using errcode = 'BTIT0';
  end if;
  if not public._privileged('baton.erasure', 'baton.privacy_review') then
    raise exception 'point_revisions is append-only' using errcode = 'BTIT0';
  end if;
  if (new.id, new.handover_id, new.point_id, new.revision_number, new.author_kind, new.ai_provenance, new.created_at)
     is distinct from (old.id, old.handover_id, old.point_id, old.revision_number, old.author_kind, old.ai_provenance, old.created_at)
     or new.author_profile_id is distinct from old.author_profile_id then
    raise exception 'only revision text may be redacted' using errcode = 'BTIT0';
  end if;
  if new.redacted_at is null or (old.redacted_at is not null and new.redacted_at is null) then
    raise exception 'a revision update must record its redaction' using errcode = 'BTIT0';
  end if;
  return new;
end $$;

create trigger point_revisions_append_only
  before update or delete on public.point_revisions
  for each row execute function public._guard_point_revisions();

create function public._guard_review_actions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public._privileged('baton.purge') then return old; end if;
    raise exception 'review_actions is append-only' using errcode = 'BTIT0';
  end if;
  -- point_evidence_id may be nulled by the FK when a link is deleted (erasure, testimony removal, purge).
  if new.point_evidence_id is distinct from old.point_evidence_id and new.point_evidence_id is not null then
    raise exception 'review_actions is append-only' using errcode = 'BTIT0';
  end if;
  if (new.note is distinct from old.note or new.metadata is distinct from old.metadata)
     and not public._privileged('baton.erasure', 'baton.privacy_review') then
    raise exception 'review_actions is append-only' using errcode = 'BTIT0';
  end if;
  if new.point_evidence_id is distinct from old.point_evidence_id
     and not public._privileged('baton.erasure', 'baton.privacy_review', 'baton.purge') then
    raise exception 'review_actions is append-only' using errcode = 'BTIT0';
  end if;
  if (new.id, new.handover_id, new.point_id, new.revision_id, new.actor_profile_id, new.action,
      new.from_review_state, new.to_review_state, new.created_at)
     is distinct from (old.id, old.handover_id, old.point_id, old.revision_id, old.actor_profile_id, old.action,
      old.from_review_state, old.to_review_state, old.created_at) then
    raise exception 'review_actions is append-only' using errcode = 'BTIT0';
  end if;
  return new;
end $$;

create trigger review_actions_append_only
  before update or delete on public.review_actions
  for each row execute function public._guard_review_actions();

create function public._guard_audit_logs()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public._privileged('baton.purge') then return old; end if;
    raise exception 'audit_logs is append-only' using errcode = 'BTIT0';
  end if;
  -- Purge: the FKs null handover_id (D17) and actor_token_id. Erasure: clears before/after (§12.8 step 7).
  if (new.handover_id is distinct from old.handover_id and (new.handover_id is not null or not public._privileged('baton.purge')))
     or (new.actor_token_id is distinct from old.actor_token_id and (new.actor_token_id is not null or not public._privileged('baton.purge')))
     or ((new.before is distinct from old.before or new.after is distinct from old.after)
         and (new.before is not null or new.after is not null or not public._privileged('baton.erasure')))
     or (new.id, new.actor_profile_id, new.action, new.entity_type, new.entity_id, new.access_level, new.request_id, new.created_at)
        is distinct from (old.id, old.actor_profile_id, old.action, old.entity_type, old.entity_id, old.access_level, old.request_id, old.created_at) then
    raise exception 'audit_logs is append-only' using errcode = 'BTIT0';
  end if;
  return new;
end $$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public._guard_audit_logs();

create function public._guard_handover_publications()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public._privileged('baton.purge') then return old; end if;
    raise exception 'handover_publications is append-only' using errcode = 'BTIT0';
  end if;
  if not public._privileged('baton.erasure', 'baton.privacy_review')
     or (new.summary is distinct from old.summary and new.summary is not null)
     or (old.redacted_at is not null and new.redacted_at is distinct from old.redacted_at)
     or (new.id, new.handover_id, new.version, new.published_by, new.published_at, new.supersedes_id)
        is distinct from (old.id, old.handover_id, old.version, old.published_by, old.published_at, old.supersedes_id) then
    raise exception 'handover_publications is append-only' using errcode = 'BTIT0';
  end if;
  return new;
end $$;

create trigger handover_publications_append_only
  before update or delete on public.handover_publications
  for each row execute function public._guard_handover_publications();

-- The label paths that account anonymisation may rewrite in a publication snapshot (§12.9 item 6).
create function public._mask_account_label_paths(p_content jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_content ? 'evidence' then
    jsonb_set(
      (case when jsonb_typeof(p_content -> 'inferredConfirmation') = 'object'
            then jsonb_set(p_content, '{inferredConfirmation,byLabel}', '"*"') else p_content end)
      || (case when jsonb_typeof(p_content -> 'conflictResolution') = 'object'
               then jsonb_build_object('conflictResolution', jsonb_set(p_content -> 'conflictResolution', '{byLabel}', '"*"'))
               else '{}'::jsonb end),
      '{evidence}',
      coalesce((
        select jsonb_agg(case when e ? 'authorLabel' then jsonb_set(e, '{authorLabel}', '"*"') else e end order by ord)
        from jsonb_array_elements(p_content -> 'evidence') with ordinality as t (e, ord)
      ), '[]'::jsonb))
  else p_content end
$$;

create function public._guard_publication_points()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public._privileged('baton.purge') then return old; end if;
    raise exception 'publication_points is append-only' using errcode = 'BTIT0';
  end if;
  if (new.id, new.handover_id, new.publication_id, new.point_id, new.revision_id, new.category, new.evidence_status,
      new.access_level, new.is_potentially_outdated, new.is_known_gap, new.sort_key)
     is distinct from (old.id, old.handover_id, old.publication_id, old.point_id, old.revision_id, old.category,
      old.evidence_status, old.access_level, old.is_potentially_outdated, old.is_known_gap, old.sort_key) then
    raise exception 'publication_points is append-only' using errcode = 'BTIT0';
  end if;
  if public._privileged('baton.erasure', 'baton.privacy_review') then
    if old.redacted_at is not null and new.redacted_at is distinct from old.redacted_at then
      raise exception 'a redaction cannot be undone' using errcode = 'BTIT0';
    end if;
    return new;
  end if;
  if public._privileged('baton.account_anonymisation')
     and new.redacted_at is not distinct from old.redacted_at
     and new.privacy_hold = old.privacy_hold
     and public._mask_account_label_paths(new.content) = public._mask_account_label_paths(old.content) then
    return new;
  end if;
  raise exception 'publication_points is append-only' using errcode = 'BTIT0';
end $$;

create trigger publication_points_append_only
  before update or delete on public.publication_points
  for each row execute function public._guard_publication_points();

create function public._guard_acknowledgements()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public._privileged('baton.purge') then return old; end if;
    raise exception 'acknowledgements is append-only' using errcode = 'BTIT0';
  end if;
  if not public._privileged('baton.erasure', 'baton.privacy_review')
     or old.invalidated_at is not null
     or new.invalidated_at is null
     or (new.id, new.handover_id, new.publication_id, new.profile_id, new.statement_version, new.acknowledged_at, new.note)
        is distinct from (old.id, old.handover_id, old.publication_id, old.profile_id, old.statement_version, old.acknowledged_at, old.note) then
    raise exception 'acknowledgements is append-only' using errcode = 'BTIT0';
  end if;
  return new;
end $$;

create trigger acknowledgements_append_only
  before update or delete on public.acknowledgements
  for each row execute function public._guard_acknowledgements();

-- ── handovers: state and created_by change only through their functions ──────

create function public._guard_handovers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public._privileged('baton.purge') then return old; end if;
    raise exception 'handovers are soft-deleted, then purged' using errcode = 'BTIT0';
  end if;
  if new.id <> old.id then
    raise exception 'handover id is immutable' using errcode = 'BTIT0';
  end if;
  if new.state <> old.state and not public._privileged('baton.transition') then
    raise exception 'state changes only through transition_handover' using errcode = 'BTIT0';
  end if;
  if new.created_by <> old.created_by then
    if not public._privileged('baton.creator_transfer') then
      raise exception 'created_by changes only through transfer_creator' using errcode = 'BTIT0';
    end if;
    if not exists (
      select 1 from public.handover_members m
      where m.handover_id = new.id and m.profile_id = new.created_by
        and m.removed_at is null and m.role in ('outgoing', 'reviewer')
    ) then
      raise exception 'the creator must be an active outgoing or reviewer member' using errcode = 'BTIT0';
    end if;
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'a soft delete cannot be undone' using errcode = 'BTIT0';
  end if;
  return new;
end $$;

create trigger handovers_guard
  before update or delete on public.handovers
  for each row execute function public._guard_handovers();

-- ── handover_members: the creator's row (§6.3, D23) ──────────────────────────

create function public._guard_handover_members()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_creator uuid;
begin
  if tg_op = 'DELETE' then
    if public._privileged('baton.purge') then return old; end if;
    raise exception 'members are removed with removed_at, never deleted' using errcode = 'BTIT0';
  end if;

  select created_by into v_creator from public.handovers where id = new.handover_id;

  if tg_op = 'UPDATE' and (new.handover_id, new.profile_id) is distinct from (old.handover_id, old.profile_id) then
    raise exception 'membership identity is immutable' using errcode = 'BTIT0';
  end if;

  if new.profile_id = v_creator then
    if new.role not in ('outgoing', 'reviewer') then
      raise exception 'the creator holds the outgoing or reviewer role' using errcode = 'BTIT0';
    end if;
    if new.removed_at is not null then
      raise exception 'the creator cannot be removed' using errcode = 'BTIT0';
    end if;
  end if;
  return new;
end $$;

create trigger handover_members_guard
  before insert or update or delete on public.handover_members
  for each row execute function public._guard_handover_members();

-- ── handover_points: always has a current revision (checked at commit) ───────

create function public._check_point_has_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.handover_points where id = new.id and current_revision_id is null) then
    raise exception 'a point must have a current revision' using errcode = 'BTVF0';
  end if;
  return null;
end $$;

create constraint trigger handover_points_has_revision
  after insert or update on public.handover_points
  deferrable initially deferred
  for each row execute function public._check_point_has_revision();

-- ── access_override only raises; directContact keeps leads_only (§3.1, §8.4) ─

create function public._point_has_direct_contact(p_revision_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select jsonb_typeof(r.attributes -> 'directContact') = 'object'
    from public.point_revisions r where r.id = p_revision_id
  ), false)
$$;

create function public._guard_point_access()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.access_override is distinct from old.access_override then
    if new.access_override is not null
       and public.access_rank(new.access_override) < public.access_rank(new.access_floor) then
      raise exception 'access can only be raised above the evidence floor' using errcode = 'BTIT0';
    end if;
  end if;
  if public.access_rank(public.max_access(new.access_floor, new.access_override)) < 1
     and public._point_has_direct_contact(new.current_revision_id) then
    raise exception 'a point with a direct contact stays at leads_only or stricter' using errcode = 'BTIT0';
  end if;
  return new;
end $$;

create trigger handover_points_access_guard
  before update of access_override, access_floor, current_revision_id on public.handover_points
  for each row execute function public._guard_point_access();

create function public._direct_contact_floor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(new.attributes -> 'directContact') = 'object' then
    update public.handover_points
       set access_override = public.max_access(access_override, 'leads_only')
     where id = new.point_id
       and public.access_rank(public.max_access(access_floor, access_override)) < 1;
  end if;
  return null;
end $$;

-- Runs BEFORE the point's current_revision_id moves to this revision, so the guard above never sees a
-- direct contact below leads_only.
create trigger point_revisions_direct_contact
  after insert on public.point_revisions
  for each row execute function public._direct_contact_floor();

-- ── evidence_quotes integrity (§6.0 exceptions, §6.10, §8.4) ─────────────────

create function public._guard_evidence_quotes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_level text;
  v_answer_text text;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'source_quote' then
      if new.source_id is null then
        raise exception 'a source quote names its source' using errcode = 'BTVF0';
      end if;
      if new.source_message_id is not null and not exists (
        select 1 from public.source_messages m where m.id = new.source_message_id and m.source_id = new.source_id
      ) then
        raise exception 'the quoted message belongs to another source' using errcode = 'BTVF0';
      end if;
      select s.access_level into v_level from public.sources s where s.id = new.source_id;
      new.access_level := v_level; -- §8.4: source_quote access := source access
    elsif new.gap_answer_id is not null then
      select q.access_level, a.answer_text into v_level, v_answer_text
        from public.gap_answers a join public.gap_questions q on q.id = a.gap_question_id
       where a.id = new.gap_answer_id;
      new.access_level := v_level; -- testimony from a gap answer := its question's level
      new.quote_text := v_answer_text;
      new.quote_check := 'exact';
    end if;
    return new;
  end if;

  -- UPDATE
  if (new.id, new.handover_id, new.kind, new.gap_answer_id, new.quote_start, new.quote_end, new.message_sent_at,
      new.author_identity_kind, new.author_identity_hash, new.author_identity_pepper_version, new.source_title, new.location, new.created_at)
     is distinct from (old.id, old.handover_id, old.kind, old.gap_answer_id, old.quote_start, old.quote_end, old.message_sent_at,
      old.author_identity_kind, old.author_identity_hash, old.author_identity_pepper_version, old.source_title, old.location, old.created_at) then
    raise exception 'evidence is immutable' using errcode = 'BTIT0';
  end if;
  if (new.source_id is distinct from old.source_id and new.source_id is not null)
     or (new.source_message_id is distinct from old.source_message_id and new.source_message_id is not null)
     or (new.stated_by_profile_id is distinct from old.stated_by_profile_id and new.stated_by_profile_id is not null) then
    raise exception 'evidence references can only be cleared' using errcode = 'BTIT0';
  end if;
  if new.quote_text is distinct from old.quote_text
     and not (new.kind = 'testimony' and public._privileged('baton.privacy_review')) then
    raise exception 'quote text is immutable' using errcode = 'BTIT0';
  end if;
  if new.author_label is distinct from old.author_label
     and not (new.kind = 'testimony' and public._privileged('baton.account_anonymisation')) then
    raise exception 'author label is immutable' using errcode = 'BTIT0';
  end if;
  if new.access_level is distinct from old.access_level then
    if new.kind = 'source_quote' and new.source_id is not null then
      select s.access_level into v_level from public.sources s where s.id = new.source_id;
      if new.access_level is distinct from v_level then
        raise exception 'source quote access follows its source' using errcode = 'BTIT0';
      end if;
    elsif new.gap_answer_id is not null then
      select q.access_level into v_level
        from public.gap_answers a join public.gap_questions q on q.id = a.gap_question_id where a.id = new.gap_answer_id;
      if new.access_level is distinct from v_level then
        raise exception 'testimony access follows its gap question' using errcode = 'BTIT0';
      end if;
    elsif public.access_rank(new.access_level) < public.access_rank(old.access_level) then
      raise exception 'testimony access can only be raised' using errcode = 'BTIT0';
    end if;
  end if;
  return new;
end $$;

create trigger evidence_quotes_guard
  before insert or update on public.evidence_quotes
  for each row execute function public._guard_evidence_quotes();

-- Testimony text always equals its answer's text (§6.10). Checked at commit, because
-- resolve_privacy_review updates the answer and the testimony one after the other.
create function public._check_testimony_sync_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.evidence_quotes q join public.gap_answers a on a.id = q.gap_answer_id
    where q.id = new.id and q.quote_text is distinct from a.answer_text
  ) then
    raise exception 'testimony text must equal its answer text' using errcode = 'BTVF0';
  end if;
  return null;
end $$;

create constraint trigger evidence_quotes_testimony_sync
  after insert or update on public.evidence_quotes
  deferrable initially deferred
  for each row when (new.gap_answer_id is not null)
  execute function public._check_testimony_sync_quote();

create function public._check_testimony_sync_answer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.evidence_quotes q join public.gap_answers a on a.id = q.gap_answer_id
    where a.id = new.id and q.quote_text is distinct from a.answer_text
  ) then
    raise exception 'testimony text must equal its answer text' using errcode = 'BTVF0';
  end if;
  return null;
end $$;

create constraint trigger gap_answers_testimony_sync
  after update of answer_text on public.gap_answers
  deferrable initially deferred
  for each row execute function public._check_testimony_sync_answer();

-- ── Gap questions inherit at least their point's access (§8.4) ───────────────

create function public._gap_question_access_floor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_level text;
begin
  if new.point_id is not null then
    select p.access_level into v_level from public.handover_points p where p.id = new.point_id;
    new.access_level := public.max_access(new.access_level, v_level);
  end if;
  if tg_op = 'UPDATE' and public.access_rank(new.access_level) < public.access_rank(old.access_level) then
    raise exception 'gap question access can only be raised' using errcode = 'BTIT0';
  end if;
  return new;
end $$;

create trigger gap_questions_access_floor
  before insert or update of point_id, access_level on public.gap_questions
  for each row execute function public._gap_question_access_floor();

create function public._point_access_propagate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.access_rank(new.access_level) > public.access_rank(old.access_level) then
    update public.gap_questions
       set access_level = new.access_level
     where point_id = new.id and public.access_rank(access_level) < public.access_rank(new.access_level);
  end if;
  return null;
end $$;

create trigger handover_points_access_propagate
  after update on public.handover_points
  for each row when (old.access_level is distinct from new.access_level)
  execute function public._point_access_propagate();

create function public._gap_question_access_propagate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.evidence_quotes q
     set access_level = new.access_level
    from public.gap_answers a
   where a.gap_question_id = new.id and q.gap_answer_id = a.id and q.access_level is distinct from new.access_level;
  return null;
end $$;

create trigger gap_questions_access_propagate
  after update of access_level on public.gap_questions
  for each row when (old.access_level is distinct from new.access_level)
  execute function public._gap_question_access_propagate();

create function public._source_access_propagate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.evidence_quotes
     set access_level = new.access_level
   where source_id = new.id and kind = 'source_quote' and access_level is distinct from new.access_level;
  return null;
end $$;

create trigger sources_access_propagate
  after update of access_level on public.sources
  for each row when (old.access_level is distinct from new.access_level)
  execute function public._source_access_propagate();

-- A token's scoped questions are at or below its max_access_level (§6.0 exceptions).
create function public._guard_access_token_questions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.access_tokens t join public.gap_questions q on q.id = new.gap_question_id
    where t.id = new.token_id
      and public.access_rank(q.access_level) <= public.access_rank(t.max_access_level)
  ) then
    raise exception 'question is above the link''s access level' using errcode = 'BTVF0';
  end if;
  return new;
end $$;

create trigger access_token_questions_guard
  before insert on public.access_token_questions
  for each row execute function public._guard_access_token_questions();

-- ── Gap answers: never to a held, closed or unknown question (§5.5, §6.16) ───
-- Triggers run for every role, including service_role, so this covers the token path too.

create function public._guard_gap_answer_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- open, not held, not on an erased/withdrawn point (M2), in a live handover
  if not exists (
    select 1 from public.gap_questions q join public.handovers h on h.id = q.handover_id
    where q.id = new.gap_question_id and h.deleted_at is null
  ) or not public._gap_question_answerable(new.gap_question_id) then
    raise exception 'question not found' using errcode = 'BTNF0';
  end if;
  return new;
end $$;

create trigger gap_answers_insert_guard
  before insert on public.gap_answers
  for each row execute function public._guard_gap_answer_insert();

-- ── Status recompute hooks (§4.2) ────────────────────────────────────────────

create function public._recompute_from_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public._flag('baton.purge') then return null; end if;
  if tg_op = 'DELETE' then
    perform public.recompute_point_status(old.point_id);
  else
    perform public.recompute_point_status(new.point_id);
  end if;
  return null;
end $$;

create trigger point_evidence_recompute
  after insert or update or delete on public.point_evidence
  for each row execute function public._recompute_from_link();

create function public._recompute_from_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_point uuid;
begin
  for v_point in select pe.point_id from public.point_evidence pe where pe.evidence_id = new.id order by pe.point_id loop
    perform public.recompute_point_status(v_point);
  end loop;
  return null;
end $$;

create trigger evidence_quotes_recompute
  after update of quote_check, access_level on public.evidence_quotes
  for each row execute function public._recompute_from_quote();

create function public._recompute_from_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.recompute_point_status(new.point_id);
  return null;
end $$;

create trigger point_revisions_recompute
  after insert on public.point_revisions
  for each row execute function public._recompute_from_revision();

create function public._recompute_from_point()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.recompute_point_status(new.id);
  return null;
end $$;

create trigger handover_points_recompute
  after update of current_revision_id, inference_rationale, extraction_access_level on public.handover_points
  for each row execute function public._recompute_from_point();
