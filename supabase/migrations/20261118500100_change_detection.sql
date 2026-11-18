-- Round 3 Task 05D (Living Handover, stage 3): deterministic change detection and change-review items.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY (docs/round3/living-handover-versions.md). Requires 20261117500200.
-- ADDITIVE: new columns on source_version_changes (backfilled), one new table, CREATE OR REPLACE of functions with
-- unchanged signatures, new functions. No existing row is deleted; no published snapshot is touched.
--
-- 1. BASELINE. source_version_changes.base_publication_id: the handover's current publication when the version became
--    current (set by a BEFORE INSERT trigger, so every activation path records it; backfilled for existing rows with
--    the latest publication not newer than the change). NULL: the handover had never been published, and its newly
--    extracted points stay in the ordinary initial review (no new_information items).
--
-- 2. REVIEW ITEMS. source_change_review_items: one row per detected impact of a source update. It REFERENCES
--    existing objects (point, base revision, base publication, old/new evidence, new message and offsets, candidate
--    point, Task 03 review flag) and stores no message text: `detail` holds only tokens, numbers and booleans
--    (checked). Kinds: evidence_missing, evidence_moved, possible_contradiction, support_changed, new_information.
--    States: open, investigating, accepted, rejected, stale. Items are created `open` by the detector only; the only
--    automatic transition is open|investigating → stale (a newer version superseded the update, or the source was
--    removed). Reviewer decisions (Task 05E) are reserved to a checked function setting `baton.change_review`; no
--    function sets it yet and no API role can write the table. Idempotency: unique (change_id, dedupe_key).
--
-- 3. DETECTION LIFECYCLE. The `analyze` job of the run that processed the update compares the previous version's
--    retained evidence with the new version (lib/signals/change-detection.ts) and records the result with
--    pipeline_record_change_detection, ONE transaction per update: fenced claim (analyze, exact generation), the
--    update must still be `processing` in THIS run and its version still current; all items are validated and
--    inserted (ON CONFLICT DO NOTHING); the detection fields are set; audited. Then, when the run closes:
--      processing → ready     the run SUCCEEDED, the new version was fully extracted AND detection was recorded
--                             by this run (detection_run_id = run)
--      processing → failed    otherwise; error_code extraction_partial / extraction_failed / run_failed /
--                             run_cancelled as in 05C, or detection_incomplete (a succeeded run without detection)
--    awaiting_detection (05C, before this migration) is retried by the next scoped run (→ processing).
--    ready | … → superseded   a newer version became current; the update's open/investigating items become stale.
--
-- 4. PUBLICATION GATE (same two trigger points as Task 04/05C, so every publication path is covered): besides the
--    blocking updates, any open or investigating item of a current version's update blocks publication
--    (BTPF0 change_review_open). Accepted, rejected and stale items do not. Items about an erased point are moot and
--    do not block. Task 04's acknowledgement covers extraction gaps only: it never lifts an open item.
--    readiness_report gains two blockers (source_updates_pending, change_reviews_open), so the dashboard and the
--    review panel never say "ready" while the gate would refuse.
--
-- 5. READS. list_change_detection_input (service only, for the analyze job); api_list_change_review_items and the
--    extended api_get_extraction_report / _source_json (SECURITY INVOKER, RLS: review role, both versions visible,
--    the point(s) and the evidence visible to the viewer).

-- ── 1. source_version_changes: baseline and detection record ────────────────

alter table public.source_version_changes
  add column base_publication_id uuid,
  add column detection_run_id uuid,
  add column detected_at timestamptz,
  add column detection_counts jsonb,
  add constraint source_version_changes_handover_id_key unique (handover_id, id),
  add constraint source_version_changes_base_publication_fk foreign key (handover_id, base_publication_id)
    references public.handover_publications (handover_id, id),
  add constraint source_version_changes_detection_run_fk foreign key (handover_id, detection_run_id)
    references public.processing_runs (handover_id, id) on delete set null (detection_run_id),
  add constraint source_version_changes_detection_counts_check
    check (detection_counts is null or (jsonb_typeof(detection_counts) = 'object' and pg_column_size(detection_counts) <= 2048)),
  add constraint source_version_changes_detection_pair
    check ((detected_at is null) = (detector_version is null)),
  drop constraint source_version_changes_state_check,
  add constraint source_version_changes_state_check
    check (state in ('awaiting_processing', 'processing', 'awaiting_detection', 'ready', 'failed', 'superseded')),
  add constraint source_version_changes_ready_detected
    check (state <> 'ready' or detected_at is not null);

-- Backfill: the publication that was current when each existing update was recorded (never a later one).
alter table public.source_version_changes disable trigger source_version_changes_guard;
update public.source_version_changes c
   set base_publication_id = (select p.id from public.handover_publications p
                               where p.handover_id = c.handover_id and p.published_at <= c.created_at
                               order by p.version desc limit 1);
alter table public.source_version_changes enable trigger source_version_changes_guard;

-- Every activation path records the baseline: the handover's current publication at that moment.
create function public._trg_source_version_change_baseline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select h.current_publication_id into new.base_publication_id from public.handovers h where h.id = new.handover_id;
  return new;
end $$;

create trigger source_version_changes_baseline
  before insert on public.source_version_changes
  for each row execute function public._trg_source_version_change_baseline();

-- Written only by the activation (insert), the 05C lifecycle and the detection record; every transition is listed.
create or replace function public._guard_source_version_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public._privileged('baton.versioning') then return new; end if;
    raise exception 'source_version_changes is written only by the version transition' using errcode = 'BTIT0';
  elsif tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'source_version_changes is written only by the version transition' using errcode = 'BTIT0';
  end if;

  if (new.id, new.handover_id, new.lineage_id, new.from_source_id, new.to_source_id, new.from_version, new.to_version, new.created_at)
     is distinct from
     (old.id, old.handover_id, old.lineage_id, old.from_source_id, old.to_source_id, old.from_version, old.to_version, old.created_at) then
    raise exception 'source_version_changes is written only by the version transition' using errcode = 'BTIT0';
  end if;

  -- ON DELETE SET NULL side effects (a deleted profile, a purged run): references only ever become NULL
  if (new.state, new.state_changed_at, new.error_code, new.detector_version, new.detected_at, new.detection_counts,
      new.base_publication_id)
     is not distinct from
     (old.state, old.state_changed_at, old.error_code, old.detector_version, old.detected_at, old.detection_counts,
      old.base_publication_id)
     and (new.created_by is not distinct from old.created_by or new.created_by is null)
     and (new.run_id is not distinct from old.run_id or new.run_id is null)
     and (new.detection_run_id is not distinct from old.detection_run_id or new.detection_run_id is null) then
    return new;
  end if;

  -- the detection record (pipeline_record_change_detection): while processing, only the detection fields
  if public._privileged('baton.change_detection') and old.state = 'processing' and new.state = 'processing'
     and (new.state_changed_at, new.error_code, new.created_by, new.run_id, new.base_publication_id)
         is not distinct from (old.state_changed_at, old.error_code, old.created_by, old.run_id, old.base_publication_id)
     and new.detected_at is not null and new.detector_version is not null and new.detection_run_id is not null
     and new.detection_run_id = old.run_id then
    return new;
  end if;

  -- the lifecycle (activation, 05C triggers, this migration's run close): listed transitions, detection untouched
  if public._privileged('baton.versioning')
     and (new.created_by, new.base_publication_id, new.detector_version, new.detected_at, new.detection_counts, new.detection_run_id)
         is not distinct from
         (old.created_by, old.base_publication_id, old.detector_version, old.detected_at, old.detection_counts, old.detection_run_id)
     and (old.state, new.state) in (('awaiting_processing', 'processing'), ('failed', 'processing'), ('awaiting_detection', 'processing'),
                                    ('processing', 'awaiting_detection'), ('processing', 'ready'), ('processing', 'failed'),
                                    ('awaiting_processing', 'superseded'), ('failed', 'superseded'),
                                    ('awaiting_detection', 'superseded'), ('ready', 'superseded')) then
    return new;
  end if;
  raise exception 'source_version_changes is written only by the version transition' using errcode = 'BTIT0';
end $$;

-- ── 2. change-review items ───────────────────────────────────────────────────

-- `detail` is deterministic, non-sensitive metadata: an object of at most 1 kB whose strings are all short tokens
-- (no message text, names, dates or quotes can be stored in it).
create function public.change_review_detail_safe(p_detail jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_detail is not null and jsonb_typeof(p_detail) = 'object' and pg_column_size(p_detail) <= 1024
     and not exists (select 1 from jsonb_path_query(p_detail, 'strict $.**') v
                      where jsonb_typeof(v) = 'string' and (v #>> '{}') !~ '^[a-z0-9_.-]{0,64}$')
     and not exists (select 1 from jsonb_path_query(p_detail, 'strict $.**') v
                      join lateral jsonb_object_keys(case when jsonb_typeof(v) = 'object' then v else '{}'::jsonb end) k on true
                      where k !~ '^[A-Za-z0-9_]{1,40}$')
$$;

create table public.source_change_review_items (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  change_id uuid not null,
  kind text not null check (kind in ('evidence_missing', 'evidence_moved', 'possible_contradiction', 'support_changed', 'new_information')),
  state text not null default 'open' check (state in ('open', 'investigating', 'accepted', 'rejected', 'stale')),
  -- the existing point the item is about (NULL only for new_information) and its baseline
  point_id uuid,
  base_revision_id uuid,
  base_publication_id uuid,
  -- the previous version's evidence, and where the new version has it (offsets: UTF-16 units into the new body)
  old_evidence_id uuid,
  new_evidence_id uuid,
  new_source_message_id uuid,
  new_quote_start int,
  new_quote_end int,
  -- new_information: the newly extracted point (pending review, never approved here)
  candidate_point_id uuid,
  -- possible_contradiction: the Task 03 review flag for the same point and message, when one exists
  review_flag_id uuid,
  detail jsonb not null default '{}'::jsonb,
  dedupe_key text not null check (dedupe_key ~ '^[a-z_]{1,32}:[0-9a-f:-]{36,80}$'),
  detector_version text not null check (detector_version ~ '^[a-z0-9_.@-]{1,32}$'),
  run_id uuid,
  stale_reason text check (stale_reason in ('superseded', 'source_removed')),
  created_at timestamptz not null default now(),
  state_changed_at timestamptz not null default now(),
  constraint source_change_review_items_change_fk foreign key (handover_id, change_id)
    references public.source_version_changes (handover_id, id) on delete cascade,
  constraint source_change_review_items_point_fk foreign key (handover_id, point_id)
    references public.handover_points (handover_id, id) on delete cascade,
  constraint source_change_review_items_base_revision_fk foreign key (point_id, base_revision_id)
    references public.point_revisions (point_id, id),
  constraint source_change_review_items_base_publication_fk foreign key (handover_id, base_publication_id)
    references public.handover_publications (handover_id, id),
  constraint source_change_review_items_old_evidence_fk foreign key (handover_id, old_evidence_id)
    references public.evidence_quotes (handover_id, id) on delete cascade,
  constraint source_change_review_items_new_evidence_fk foreign key (handover_id, new_evidence_id)
    references public.evidence_quotes (handover_id, id) on delete cascade,
  -- an uncited message is pruned at publication (§12.6): the item keeps its decision, the position stays in detail
  constraint source_change_review_items_new_message_fk foreign key (handover_id, new_source_message_id)
    references public.source_messages (handover_id, id) on delete set null (new_source_message_id),
  constraint source_change_review_items_candidate_fk foreign key (handover_id, candidate_point_id)
    references public.handover_points (handover_id, id) on delete cascade,
  constraint source_change_review_items_flag_fk foreign key (review_flag_id)
    references public.point_review_flags (id) on delete set null,
  constraint source_change_review_items_run_fk foreign key (handover_id, run_id)
    references public.processing_runs (handover_id, id) on delete set null (run_id),
  constraint source_change_review_items_offsets
    check ((new_quote_start is null) = (new_quote_end is null) and (new_quote_start is null or (new_quote_start >= 0 and new_quote_end > new_quote_start))),
  constraint source_change_review_items_detail_check check (public.change_review_detail_safe(detail)),
  constraint source_change_review_items_stale_reason check ((state = 'stale') = (stale_reason is not null)),
  -- the references each kind is about (the writer checks presence at creation; see the FK note on messages)
  constraint source_change_review_items_kind_refs check (
    case kind
      when 'evidence_missing' then point_id is not null and old_evidence_id is not null and candidate_point_id is null
                                   and new_evidence_id is null and new_quote_start is null
      when 'evidence_moved' then point_id is not null and old_evidence_id is not null and candidate_point_id is null
      when 'possible_contradiction' then point_id is not null and old_evidence_id is null and candidate_point_id is null
      when 'support_changed' then point_id is not null and old_evidence_id is not null and new_evidence_id is not null
                                  and candidate_point_id is null
      when 'new_information' then point_id is null and old_evidence_id is null and candidate_point_id is not null
                                  and new_evidence_id is not null and base_revision_id is null
    end),
  constraint source_change_review_items_dedupe_key unique (change_id, dedupe_key)
);
create index source_change_review_items_handover_idx on public.source_change_review_items (handover_id, state);
create index source_change_review_items_change_idx on public.source_change_review_items (change_id, state);
create index source_change_review_items_point_idx on public.source_change_review_items (point_id) where point_id is not null;
create index source_change_review_items_candidate_idx on public.source_change_review_items (candidate_point_id) where candidate_point_id is not null;
create index source_change_review_items_old_evidence_idx on public.source_change_review_items (old_evidence_id) where old_evidence_id is not null;
create index source_change_review_items_new_evidence_idx on public.source_change_review_items (new_evidence_id) where new_evidence_id is not null;
create index source_change_review_items_message_idx on public.source_change_review_items (new_source_message_id) where new_source_message_id is not null;
create index source_change_review_items_flag_idx on public.source_change_review_items (review_flag_id) where review_flag_id is not null;

alter table public.source_change_review_items enable row level security;
-- A review role sees an item only when it can see both versions of the source (the update record's own policy),
-- the point(s) it is about and the evidence it references (each subquery is filtered by that table's RLS).
create policy source_change_review_items_select on public.source_change_review_items
  for select to authenticated
  using (public.is_review_role(handover_id)
         and exists (select 1 from public.source_version_changes c where c.id = change_id)
         and (point_id is null or public.point_visible(point_id))
         and (candidate_point_id is null or public.point_visible(candidate_point_id))
         and (old_evidence_id is null or exists (select 1 from public.evidence_quotes q where q.id = old_evidence_id))
         and (new_evidence_id is null or exists (select 1 from public.evidence_quotes q where q.id = new_evidence_id)));

-- Inserted only by the detector (open), made stale only by the lifecycle, decided only by Task 05E's checked function.
create function public._guard_source_change_review_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public._privileged('baton.change_detection') and new.state = 'open' and new.stale_reason is null then
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

  -- ON DELETE SET NULL side effects only (a pruned message, a removed flag, a purged run)
  if (new.state, new.state_changed_at, new.stale_reason) is not distinct from (old.state, old.state_changed_at, old.stale_reason)
     and (new.new_source_message_id is not distinct from old.new_source_message_id or new.new_source_message_id is null)
     and (new.review_flag_id is not distinct from old.review_flag_id or new.review_flag_id is null)
     and (new.run_id is not distinct from old.run_id or new.run_id is null) then
    return new;
  end if;

  if (new.new_source_message_id, new.review_flag_id, new.run_id) is distinct from (old.new_source_message_id, old.review_flag_id, old.run_id) then
    raise exception 'a change-review item''s references are immutable' using errcode = 'BTIT0';
  end if;
  -- automatic invalidation: a newer version superseded the update, or the source was removed
  if public._privileged('baton.change_detection') and old.state in ('open', 'investigating') and new.state = 'stale'
     and new.stale_reason is not null then
    return new;
  end if;
  -- reviewer decisions (Task 05E): only through a checked function that sets baton.change_review
  if public._privileged('baton.change_review') and new.stale_reason is null
     and (old.state, new.state) in (('open', 'investigating'), ('investigating', 'open'), ('open', 'accepted'), ('open', 'rejected'),
                                    ('investigating', 'accepted'), ('investigating', 'rejected')) then
    return new;
  end if;
  raise exception 'this change-review state change is not allowed' using errcode = 'BTIT0';
end $$;

create trigger source_change_review_items_guard
  before insert or update or delete on public.source_change_review_items
  for each row execute function public._guard_source_change_review_items();

-- ── 3. lifecycle triggers (same names, extended) ─────────────────────────────

-- An extract job for the new version: the update is being processed (first time, a retry, or — for an update
-- processed before this migration — the change detection it never had).
create or replace function public._trg_source_update_extract_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text := coalesce(current_setting('baton.versioning', true), '');
begin
  perform set_config('baton.versioning', 'on', true);
  update public.source_version_changes
     set state = 'processing', run_id = new.run_id, error_code = null, state_changed_at = now()
   where to_source_id = new.source_id and state in ('awaiting_processing', 'failed', 'awaiting_detection');
  perform set_config('baton.versioning', v_flag, true);
  return null;
end $$;

-- The run that processed the update closed: ready only when extraction was complete, the run succeeded AND this
-- run recorded the change detection; failed (with the reason) otherwise. Never a falsely complete update.
create or replace function public._trg_source_update_run_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text := coalesce(current_setting('baton.versioning', true), '');
  c record;
  v_gap text;
  v_state text;
  v_error text;
  v_open int;
begin
  perform set_config('baton.versioning', 'on', true);
  for c in select ch.id, ch.to_source_id, ch.detection_run_id, ch.detected_at from public.source_version_changes ch
            where ch.run_id = new.id and ch.state = 'processing' order by ch.id for update loop
    select public.extraction_gap_state(j.id is not null, j.status, coalesce(j.progress_done, 0), coalesce(j.progress_total, 0))
      into v_gap
      from (select 1) one
      left join lateral (
        select jb.id, jb.status, jb.progress_done, jb.progress_total from public.processing_jobs jb
         where jb.run_id = new.id and jb.source_id = c.to_source_id and jb.stage = 'extract'
         order by jb.created_at desc, jb.id desc limit 1) j on true;
    if v_gap = 'complete' and new.status = 'succeeded' and c.detection_run_id = new.id and c.detected_at is not null then
      v_state := 'ready';
      v_error := null;
    else
      v_state := 'failed';
      v_error := case
        when v_gap = 'partial' then 'extraction_partial'
        when v_gap = 'failed' then 'extraction_failed'
        when new.status = 'cancelled' then 'run_cancelled'
        when new.status = 'failed' then 'run_failed'
        else 'detection_incomplete' end;
    end if;
    update public.source_version_changes
       set state = v_state, error_code = v_error, state_changed_at = now()
     where id = c.id;
    select count(*) into v_open from public.source_change_review_items i where i.change_id = c.id and i.state = 'open';
    perform public._audit(new.handover_id, null, null, 'source_update.evaluated', 'source_version_change', c.id, null,
                          jsonb_strip_nulls(jsonb_build_object('state', v_state, 'reason', v_error, 'runId', new.id,
                                                               'openReviewItems', v_open)));
  end loop;
  perform set_config('baton.versioning', v_flag, true);
  return null;
end $$;

-- Marks the unresolved items of the updates TO this source stale (internal; the callers hold the source row).
create function public._stale_change_review_items(p_source_id uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text := coalesce(current_setting('baton.change_detection', true), '');
  r record;
  v_total int := 0;
begin
  perform set_config('baton.change_detection', 'on', true);
  for r in
    with staled as (
      update public.source_change_review_items i
         set state = 'stale', stale_reason = p_reason, state_changed_at = now()
        from public.source_version_changes c
       where c.id = i.change_id and c.to_source_id = p_source_id and i.state in ('open', 'investigating')
      returning i.handover_id, i.change_id)
    select st.handover_id, st.change_id, count(*)::int as n from staled st group by st.handover_id, st.change_id
  loop
    v_total := v_total + r.n;
    perform public._audit(r.handover_id, null, null, 'source_update.review_items_stale', 'source_version_change', r.change_id, null,
                          jsonb_build_object('reason', p_reason, 'items', r.n));
  end loop;
  perform set_config('baton.change_detection', v_flag, true);
  return v_total;
end $$;

-- A newer version became current: the earlier update is superseded, whatever it had reached, and its unresolved
-- review items are stale (history and every decision are kept).
create or replace function public._trg_source_update_superseded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text := coalesce(current_setting('baton.versioning', true), '');
begin
  perform set_config('baton.versioning', 'on', true);
  update public.source_version_changes
     set state = 'superseded', state_changed_at = now()
   where to_source_id = new.id and state in ('awaiting_processing', 'failed', 'awaiting_detection', 'ready');
  perform set_config('baton.versioning', v_flag, true);
  perform public._stale_change_review_items(new.id, 'superseded');
  return null;
end $$;

-- A removed source (every version, or a discarded update) leaves nothing to decide.
create function public._trg_source_removed_change_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._stale_change_review_items(new.id, 'source_removed');
  return null;
end $$;

create trigger sources_removed_change_reviews
  after update of deleted_at on public.sources
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public._trg_source_removed_change_reviews();

-- A pending update still awaiting detection (05C) is part of the next scoped run.
create or replace function public._source_update_scope(p_handover_id uuid)
returns table (source_id uuid, pending_update boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         exists (select 1 from public.source_version_changes c
                  where c.to_source_id = s.id and c.state in ('awaiting_processing', 'failed', 'awaiting_detection'))
    from public.sources s
   where s.handover_id = p_handover_id and s.deleted_at is null
     and s.version_number is not null and s.superseded_at is null
     and (s.state = 'parsed' or (s.state in ('uploaded', 'failed') and s.raw_storage_path is not null))
     and (exists (select 1 from public.source_version_changes c
                   where c.to_source_id = s.id and c.state in ('awaiting_processing', 'failed', 'awaiting_detection'))
          or not exists (select 1 from public.processing_jobs j where j.source_id = s.id and j.stage = 'extract'))
$$;

-- ── 4. the publication gate ──────────────────────────────────────────────────

-- Open or investigating items of the updates of a handover's CURRENT versions (internal). Items about an erased
-- point are moot. Stale, accepted and rejected items never block.
create function public._blocking_change_reviews(p_handover_id uuid)
returns table (item_id uuid, change_id uuid, kind text, state text, point_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.change_id, i.kind, i.state, coalesce(i.point_id, i.candidate_point_id)
    from public.source_change_review_items i
    join public.source_version_changes c on c.id = i.change_id
    join public.sources s on s.id = c.to_source_id
   where i.handover_id = p_handover_id and i.state in ('open', 'investigating')
     and c.state <> 'superseded'
     and s.deleted_at is null and s.superseded_at is null and s.version_number is not null
     and not exists (select 1 from public.handover_points p
                      where p.id = coalesce(i.point_id, i.candidate_point_id) and p.erased_at is not null)
$$;

create or replace function public._assert_source_updates_settled(p_handover_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  select count(*) into v_n from public._blocking_source_updates(p_handover_id);
  if v_n > 0 then
    raise exception 'source_update_pending: % source update(s) are not processed and checked yet', v_n
      using errcode = 'BTPF0';
  end if;
  -- Task 05D: every open (or investigating) change-review item needs a decision first
  select count(*) into v_n from public._blocking_change_reviews(p_handover_id);
  if v_n > 0 then
    raise exception 'change_review_open: % change(s) found in source updates need a decision', v_n
      using errcode = 'BTPF0';
  end if;
end $$;

-- readiness_report (same signature, SECURITY INVOKER): identical to 20261111000400 plus the two source-update
-- blockers, so "ready to publish" is never shown while the gate would refuse. Under a client session the counts
-- are the viewer's RLS view; review roles see every row (full clearance), and publish_handover calls it as owner.
create or replace function public.readiness_report(p_handover_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_state text;
  v_blockers jsonb := '[]'::jsonb;
  v_ids uuid[];
  v_n int;
  v_by_status jsonb;
  v_by_review jsonb;
  v_outdated int;
  v_approved int;
  v_active int;
  v_recipient boolean;
begin
  if p_actor is null then
    if not public.is_review_role(p_handover_id) then
      return null;
    end if;
    v_recipient := coalesce(public.has_incoming_recipient(p_handover_id), false);
  else
    if public._is_api_role() or not public._is_review_role_as(p_actor, p_handover_id) then
      return null;
    end if;
    v_recipient := public._has_incoming_recipient(p_handover_id);
  end if;
  select h.state into v_state from public.handovers h where h.id = p_handover_id;
  if v_state is null then
    return null;
  end if;

  if v_state in ('draft', 'processing') then
    v_blockers := v_blockers || jsonb_build_object('kind', 'processing_incomplete', 'count', 1, 'pointIds', '[]'::jsonb);
  end if;

  select array_agg(p.id order by p.sort_key, p.id) into v_ids from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and p.review_state = 'pending';
  if v_ids is not null then
    v_blockers := v_blockers || jsonb_build_object('kind', 'pending_points', 'count', cardinality(v_ids), 'pointIds', to_jsonb(v_ids));
  end if;

  select array_agg(p.id order by p.sort_key, p.id) into v_ids from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and p.review_state = 'pending'
     and p.evidence_status = 'inferred' and p.inferred_confirmed_at is null;
  if v_ids is not null then
    v_blockers := v_blockers || jsonb_build_object('kind', 'unconfirmed_inferred', 'count', cardinality(v_ids), 'pointIds', to_jsonb(v_ids));
  end if;

  select array_agg(p.id order by p.sort_key, p.id) into v_ids from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and p.review_state = 'pending'
     and p.evidence_status = 'conflicting' and p.conflict_resolution_note is null;
  if v_ids is not null then
    v_blockers := v_blockers || jsonb_build_object('kind', 'unresolved_conflicts', 'count', cardinality(v_ids), 'pointIds', to_jsonb(v_ids));
  end if;

  select count(*), array_remove(array_agg(distinct q.point_id), null) into v_n, v_ids from public.gap_questions q
   where q.handover_id = p_handover_id and q.status = 'open' and q.priority = 'required';
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_object('kind', 'open_required_gaps', 'count', v_n, 'pointIds', to_jsonb(coalesce(v_ids, '{}')));
  end if;

  if not v_recipient then
    v_blockers := v_blockers || jsonb_build_object('kind', 'no_incoming_recipient', 'count', 1, 'pointIds', '[]'::jsonb);
  end if;

  select count(*) filter (where p.review_state = 'approved'), count(*) filter (where p.review_state <> 'rejected'),
         count(*) filter (where p.is_potentially_outdated)
    into v_approved, v_active, v_outdated
    from public.handover_points p where p.handover_id = p_handover_id and p.erased_at is null;
  if v_approved = 0 then
    v_blockers := v_blockers || jsonb_build_object('kind', 'no_approved_points', 'count', 1, 'pointIds', '[]'::jsonb);
  end if;

  select array_agg(p.id order by p.sort_key, p.id) into v_ids from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and p.privacy_review = 'required';
  if v_ids is not null then
    v_blockers := v_blockers || jsonb_build_object('kind', 'privacy_review_required', 'count', cardinality(v_ids), 'pointIds', to_jsonb(v_ids));
  end if;

  -- R3 Task 05D: a source update that is not processed and checked yet (the 05C gate), the viewer's RLS view
  select count(*) into v_n
    from public.source_version_changes c
    join public.sources s on s.id = c.to_source_id
   where c.handover_id = p_handover_id
     and s.deleted_at is null and s.superseded_at is null and s.version_number is not null
     and public.source_update_blocks_publication(c.state, c.error_code);
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_object('kind', 'source_updates_pending', 'count', v_n, 'pointIds', '[]'::jsonb);
  end if;

  -- R3 Task 05D: open change-review items (same rule as _blocking_change_reviews, the viewer's RLS view)
  select count(*), array_remove(array_agg(distinct coalesce(i.point_id, i.candidate_point_id)), null) into v_n, v_ids
    from public.source_change_review_items i
    join public.source_version_changes c on c.id = i.change_id
    join public.sources s on s.id = c.to_source_id
   where i.handover_id = p_handover_id and i.state in ('open', 'investigating')
     and c.state <> 'superseded'
     and s.deleted_at is null and s.superseded_at is null and s.version_number is not null
     and not exists (select 1 from public.handover_points p
                      where p.id = coalesce(i.point_id, i.candidate_point_id) and p.erased_at is not null);
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_object('kind', 'change_reviews_open', 'count', v_n, 'pointIds', to_jsonb(coalesce(v_ids, '{}')));
  end if;

  select jsonb_build_object(
           'sourced', count(*) filter (where p.evidence_status = 'sourced'),
           'inferred', count(*) filter (where p.evidence_status = 'inferred'),
           'conflicting', count(*) filter (where p.evidence_status = 'conflicting'),
           'missing', count(*) filter (where p.evidence_status = 'missing')),
         jsonb_build_object(
           'pending', count(*) filter (where p.review_state = 'pending'),
           'approved', count(*) filter (where p.review_state = 'approved'),
           'rejected', count(*) filter (where p.review_state = 'rejected'))
    into v_by_status, v_by_review
    from public.handover_points p where p.handover_id = p_handover_id and p.erased_at is null;

  return jsonb_build_object(
    'canPublish', jsonb_array_length(v_blockers) = 0 and v_state = 'in_review',
    'blockers', v_blockers,
    'counts', jsonb_build_object('byStatus', v_by_status, 'byReviewState', v_by_review, 'outdated', v_outdated),
    'score', case when v_active = 0 then 0 else round(100.0 * v_approved / v_active)::int end
  );
end $$;

-- ── 5. detection: the analyze job's input and its single atomic record ──────

-- The previous version's retained evidence, the new version's evidence and positions, and the cited messages of
-- the handover's live points, for every update the run is processing (service only; the analyze job).
create function public.list_change_detection_input(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'changeId', c.id, 'fromSourceId', c.from_source_id, 'toSourceId', c.to_source_id,
               'fromVersion', c.from_version, 'toVersion', c.to_version,
               'sourceKind', ts.kind, 'toSourceState', ts.state,
               'fromLastMessageAt', (select max(e.last_message_at) from public.sources e
                                      where e.lineage_id = c.lineage_id and e.version_number < c.to_version), 'basePublicationId', c.base_publication_id,
               'basePoints', coalesce((select jsonb_object_agg(pp.point_id, pp.revision_id) from public.publication_points pp
                                        where pp.publication_id = c.base_publication_id), '{}'::jsonb),
               'oldEvidence', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'evidenceId', q.id, 'pointId', pe.point_id, 'linkVerdict', pe.support_verdict,
                          'quoteText', q.quote_text, 'messageId', q.source_message_id,
                          'sentAt', q.message_sent_at, 'authorLabel', q.author_label,
                          'heading', q.location ->> 'heading') order by q.id, pe.point_id)
                   from public.evidence_quotes q
                   join public.point_evidence pe on pe.evidence_id = q.id and pe.excluded_at is null
                   join public.handover_points p on p.id = pe.point_id and p.erased_at is null and p.review_state <> 'rejected'
                  join public.sources e on e.id = q.source_id and e.lineage_id = c.lineage_id and e.version_number < c.to_version
                  where q.kind = 'source_quote' and q.quote_check in ('exact', 'normalized')),
                 '[]'::jsonb),
               'newLinks', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'evidenceId', q.id, 'pointId', pe.point_id, 'messageId', q.source_message_id,
                          'quoteStart', q.quote_start, 'quoteEnd', q.quote_end, 'verdict', pe.support_verdict,
                          'quoteCheck', q.quote_check,
                          'pointHasOtherEvidence', exists (
                            select 1 from public.point_evidence pe2 join public.evidence_quotes q2 on q2.id = pe2.evidence_id
                             where pe2.point_id = pe.point_id and pe2.excluded_at is null
                               and q2.source_id is distinct from c.to_source_id)) order by q.id, pe.point_id)
                   from public.evidence_quotes q
                   join public.point_evidence pe on pe.evidence_id = q.id and pe.excluded_at is null
                   join public.handover_points p on p.id = pe.point_id and p.erased_at is null
                  where q.source_id = c.to_source_id and q.kind = 'source_quote'), '[]'::jsonb),
               'headings', coalesce((
                 select jsonb_object_agg(m.id, m.location ->> 'heading')
                   from public.source_messages m
                  where m.source_id = c.to_source_id and m.kind = 'document_block' and m.location ? 'heading'), '{}'::jsonb)
             ) order by c.id)
        from public.source_version_changes c
        join public.processing_runs r on r.id = c.run_id
        join public.sources ts on ts.id = c.to_source_id
       where c.run_id = p_run_id and c.state = 'processing'
         and ts.deleted_at is null and ts.superseded_at is null), '[]'::jsonb),
    'anchors', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'sourceId', m.source_id, 'seq', m.seq, 'sentAt', m.sent_at,
                                          'authorLabel', sp.display_label, 'body', m.body) order by m.id)
        from public.source_messages m
        left join public.source_participants sp on sp.id = m.participant_id
       where m.handover_id = (select handover_id from public.processing_runs where id = p_run_id)
         and m.id in (select q.source_message_id from public.evidence_quotes q
                        join public.point_evidence pe on pe.evidence_id = q.id and pe.excluded_at is null
                        join public.handover_points p on p.id = pe.point_id and p.erased_at is null
                       where q.handover_id = m.handover_id and q.source_message_id is not null)
         and exists (select 1 from public.source_version_changes c where c.run_id = p_run_id and c.state = 'processing')),
      '[]'::jsonb))
$$;

-- Records the detection of one update, atomically. Returns {inserted, items}. Refusals:
--   BTLL0  the claim is no longer this worker's, or the update is no longer processed by this run / its version is
--          no longer current (a stale detector never creates fresh items)
--   BTVF0  malformed input;  BTFB0  an item names something outside the update, the handover or the kind's shape
create function public.pipeline_record_change_detection(p_job_id uuid, p_attempt int, p_change_id uuid,
  p_detector_version text, p_items jsonb, p_counts jsonb, p_claim_generation bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_c public.source_version_changes;
  v_to public.sources;
  v_bad int;
  v_total int;
  v_inserted int;
  v_repeat boolean;
begin
  if p_claim_generation is not null then
    perform public._pipeline_use_generation(p_claim_generation);
  end if;
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['analyze']);
  perform set_config('baton.claim_generation', '', true);

  if p_detector_version is null or p_detector_version !~ '^[a-z0-9_.@-]{1,32}$' then
    raise exception 'invalid detector version' using errcode = 'BTVF0';
  end if;
  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_items) > 5000
     or exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object') then
    raise exception 'invalid items' using errcode = 'BTVF0';
  end if;
  if jsonb_typeof(coalesce(p_counts, 'null'::jsonb)) <> 'object' or pg_column_size(p_counts) > 2048
     or exists (select 1 from jsonb_each(p_counts) e where jsonb_typeof(e.value) <> 'number' or e.key !~ '^[A-Za-z]{1,40}$') then
    raise exception 'invalid counts' using errcode = 'BTVF0';
  end if;

  select * into v_c from public.source_version_changes where id = p_change_id and handover_id = v_job.handover_id for update;
  if not found then
    raise exception 'source update not found' using errcode = 'BTNF0';
  end if;
  select * into v_to from public.sources where id = v_c.to_source_id;
  if v_c.state <> 'processing' or v_c.run_id is distinct from v_job.run_id
     or v_to.deleted_at is not null or v_to.superseded_at is not null then
    raise exception 'this source update is no longer processed by this run' using errcode = 'BTLL0';
  end if;
  v_repeat := v_c.detection_run_id is not distinct from v_job.run_id;

  select count(*) into v_total from jsonb_array_elements(p_items);
  select count(*) into v_bad
    from jsonb_to_recordset(p_items) as x(kind text, "dedupeKey" text, "pointId" uuid, "baseRevisionId" uuid,
                                          "oldEvidenceId" uuid, "newEvidenceId" uuid, "newMessageId" uuid,
                                          "newQuoteStart" int, "newQuoteEnd" int, "candidatePointId" uuid, detail jsonb)
   where x.kind is null or x."dedupeKey" is null or x."dedupeKey" !~ '^[a-z_]{1,32}:[0-9a-f:-]{36,80}$'
      or split_part(x."dedupeKey", ':', 1) <> x.kind
      or not public.change_review_detail_safe(coalesce(x.detail, '{}'::jsonb))
      -- the kind's shape (the table constraint, plus what must exist at creation)
      or not coalesce(case x.kind
           when 'evidence_missing' then x."pointId" is not null and x."oldEvidenceId" is not null and x."baseRevisionId" is not null
                                        and x."newMessageId" is null and x."newEvidenceId" is null and x."candidatePointId" is null
           when 'evidence_moved' then x."pointId" is not null and x."oldEvidenceId" is not null and x."baseRevisionId" is not null
                                      and x."candidatePointId" is null
                                      and ((x."newMessageId" is not null and x."newQuoteStart" is not null)
                                           or (x."newMessageId" is null and x.detail ->> 'match' = 'ambiguous'))
           when 'possible_contradiction' then x."pointId" is not null and x."baseRevisionId" is not null and x."newMessageId" is not null
                                              and x."oldEvidenceId" is null and x."candidatePointId" is null
           when 'support_changed' then x."pointId" is not null and x."baseRevisionId" is not null and x."oldEvidenceId" is not null
                                       and x."newEvidenceId" is not null and x."candidatePointId" is null
           when 'new_information' then x."candidatePointId" is not null and x."newEvidenceId" is not null and x."pointId" is null
                                       and x."oldEvidenceId" is null and x."baseRevisionId" is null
                                       and v_c.base_publication_id is not null -- never for a never-published handover
         end, false)
      or (x."newQuoteStart" is null) <> (x."newQuoteEnd" is null)
      -- the point: live, of this handover, and the base revision is one of its own
      or (x."pointId" is not null and not exists (
            select 1 from public.handover_points p join public.point_revisions r on r.point_id = p.id and r.id = x."baseRevisionId"
             where p.id = x."pointId" and p.handover_id = v_job.handover_id and p.erased_at is null))
      -- the previous version's evidence, linked to that point
      or (x."oldEvidenceId" is not null and not exists (
            select 1 from public.evidence_quotes q join public.point_evidence pe on pe.evidence_id = q.id and pe.point_id = x."pointId"
             join public.sources e on e.id = q.source_id and e.lineage_id = v_c.lineage_id and e.version_number < v_c.to_version
             where q.id = x."oldEvidenceId"))
      -- the new version's evidence, linked to the item's point (or candidate)
      or (x."newEvidenceId" is not null and not exists (
            select 1 from public.evidence_quotes q
              join public.point_evidence pe on pe.evidence_id = q.id and pe.point_id = coalesce(x."pointId", x."candidatePointId")
             where q.id = x."newEvidenceId" and q.source_id = v_c.to_source_id))
      -- a position in the new version (UTF-16 offsets never exceed the UTF-8 byte length)
      or (x."newMessageId" is not null and not exists (
            select 1 from public.source_messages m
             where m.id = x."newMessageId" and m.source_id = v_c.to_source_id
               and (x."newQuoteStart" is null or (x."newQuoteStart" >= 0 and x."newQuoteEnd" > x."newQuoteStart"
                                                    and x."newQuoteEnd" <= octet_length(m.body)))))
      -- a candidate: a live, pending, extracted point
      or (x."candidatePointId" is not null and not exists (
            select 1 from public.handover_points p
             where p.id = x."candidatePointId" and p.handover_id = v_job.handover_id and p.erased_at is null
               and p.review_state = 'pending' and p.origin = 'extracted'));
  if v_bad > 0 then
    raise exception 'a change-review item names something outside this source update' using errcode = 'BTFB0';
  end if;
  if (select count(distinct e ->> 'dedupeKey') from jsonb_array_elements(p_items) e) <> v_total then
    raise exception 'duplicate change-review items' using errcode = 'BTVF0';
  end if;

  perform set_config('baton.change_detection', 'on', true);
  insert into public.source_change_review_items (handover_id, change_id, kind, point_id, base_revision_id, base_publication_id,
                                                 old_evidence_id, new_evidence_id, new_source_message_id, new_quote_start,
                                                 new_quote_end, candidate_point_id, review_flag_id, detail, dedupe_key,
                                                 detector_version, run_id)
  select v_job.handover_id, v_c.id, x.kind, x."pointId", x."baseRevisionId", v_c.base_publication_id,
         x."oldEvidenceId", x."newEvidenceId", x."newMessageId", x."newQuoteStart", x."newQuoteEnd", x."candidatePointId",
         case when x.kind = 'possible_contradiction' then (
           select f.id from public.point_review_flags f
            where f.point_id = x."pointId" and f.kind = 'possible_contradiction' and f.source_message_id = x."newMessageId"
            order by f.created_at desc, f.id limit 1) end,
         coalesce(x.detail, '{}'::jsonb), x."dedupeKey", p_detector_version, v_job.run_id
    from jsonb_to_recordset(p_items) as x(kind text, "dedupeKey" text, "pointId" uuid, "baseRevisionId" uuid,
                                          "oldEvidenceId" uuid, "newEvidenceId" uuid, "newMessageId" uuid,
                                          "newQuoteStart" int, "newQuoteEnd" int, "candidatePointId" uuid, detail jsonb)
  on conflict on constraint source_change_review_items_dedupe_key do nothing;
  get diagnostics v_inserted = row_count;

  update public.source_version_changes
     set detector_version = p_detector_version, detected_at = now(), detection_counts = p_counts, detection_run_id = v_job.run_id
   where id = v_c.id;
  perform set_config('baton.change_detection', 'off', true);

  perform public._audit(v_job.handover_id, null, null, 'source_update.changes_detected', 'source_version_change', v_c.id, null,
                        jsonb_build_object('detectorVersion', p_detector_version, 'runId', v_job.run_id, 'items', v_total,
                                           'inserted', v_inserted, 'repeat', v_repeat, 'counts', p_counts));
  return jsonb_build_object('inserted', v_inserted, 'items', v_total);
end $$;

-- ── 6. read API (SECURITY INVOKER, RLS) ──────────────────────────────────────

-- The change-review items of a handover the viewer may see (no message text; Task 05F renders them).
create function public.api_list_change_review_items(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case when p_handover_id is null or not public.is_review_role(p_handover_id) then null else coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'changeId', i.change_id, 'kind', i.kind, 'state', i.state, 'staleReason', i.stale_reason,
             'pointId', i.point_id, 'baseRevisionId', i.base_revision_id, 'basePublicationId', i.base_publication_id,
             'oldEvidenceId', i.old_evidence_id, 'newEvidenceId', i.new_evidence_id,
             'newSourceMessageId', i.new_source_message_id, 'newQuoteStart', i.new_quote_start, 'newQuoteEnd', i.new_quote_end,
             'candidatePointId', i.candidate_point_id, 'reviewFlagId', i.review_flag_id, 'detail', i.detail,
             'detectorVersion', i.detector_version, 'sourceId', c.to_source_id, 'previousSourceId', c.from_source_id,
             'fromVersion', c.from_version, 'toVersion', c.to_version, 'createdAt', i.created_at)
             order by c.created_at, i.kind, i.created_at, i.id)
      from public.source_change_review_items i
      join public.source_version_changes c on c.id = i.change_id
     where i.handover_id = p_handover_id), '[]'::jsonb) end
$$;

-- api_get_extraction_report (same signature): identical to 20261117500200 except the update list, which gains the
-- `ready` state, each update's open review items and detection time, and blocks publication while items are open.
create or replace function public.api_get_extraction_report(p_handover_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_run public.processing_runs;
  v_sources jsonb;
  v_flags jsonb;
  v_updates jsonb;
begin
  if p_handover_id is null or not public.is_review_role(p_handover_id) then
    return null;
  end if;
  select * into v_run from public.processing_runs where handover_id = p_handover_id order by created_at desc, id desc limit 1;

  select jsonb_build_object(
           'possibleContradictions', count(*) filter (where f.kind = 'possible_contradiction'),
           'unresolvedAttribution', count(*) filter (where f.kind = 'attribution_unresolved'),
           'inferredAttribution', count(*) filter (where f.kind = 'attribution_inferred'))
    into v_flags
    from public.point_review_flags f
    join public.handover_points p on p.id = f.point_id and p.current_revision_id = f.revision_id
                                 and p.erased_at is null and p.review_state = 'pending'
   where f.handover_id = p_handover_id and f.state = 'open';

  -- R3 Task 05C/05D: the updates of current versions, their open change reviews, and whether each blocks publication
  select coalesce(jsonb_agg(jsonb_build_object(
           'sourceId', c.to_source_id, 'previousSourceId', c.from_source_id, 'title', s.title,
           'fromVersion', c.from_version, 'toVersion', c.to_version, 'state', c.state, 'errorCode', c.error_code,
           'detectedAt', c.detected_at, 'openReviewItems', oi.n,
           'blocksPublication', public.source_update_blocks_publication(c.state, c.error_code) or oi.n > 0)
           order by c.created_at, c.id), '[]'::jsonb)
    into v_updates
    from public.source_version_changes c -- RLS: both versions visible
    join public.sources s on s.id = c.to_source_id
    cross join lateral (
      select count(*)::int as n from public.source_change_review_items i -- RLS: points and evidence visible
       where i.change_id = c.id and i.state in ('open', 'investigating')
         and not exists (select 1 from public.handover_points p
                          where p.id = coalesce(i.point_id, i.candidate_point_id) and p.erased_at is not null)) oi
   where c.handover_id = p_handover_id
     and s.deleted_at is null and s.superseded_at is null and s.version_number is not null;

  if v_run.id is null then
    return jsonb_build_object('available', true, 'runId', null, 'runStatus', null, 'sources', '[]'::jsonb, 'flags', v_flags,
                              'sourceUpdates', v_updates);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sourceId', s.id, 'title', s.title,
           'runId', ev.run_id,
           'jobStatus', j.status, 'jobError', j.error_message,
           'chunksDone', coalesce(j.progress_done, 0), 'chunksTotal', coalesce(c.chunks_total, j.progress_total, 0),
           'coverageRecorded', c.run_id is not null,
           'messagesInspected', c.messages_inspected, 'messagesWithSignals', c.messages_with_signals,
           'oversizeSkipped', c.oversize_skipped, 'emptySkipped', c.empty_skipped,
           'signals', c.signals_total,
           'signalMessagesLinked', sg.linked, 'signalMessagesDismissed', sg.dismissed, 'signalMessagesUnreviewed', sg.unreviewed,
           'candidatesReturned', st.candidates, 'pointsCreated', st.inserted, 'pointsMerged', st.merged,
           'discarded', st.dropped,
           'gapState', gp.state,
           'coverageFingerprint', case when gp.state in ('partial', 'failed') then gp.fingerprint end,
           'gapAcknowledged', gp.state in ('partial', 'failed')
                              and exists (select 1 from public.publication_source_acknowledgements a
                                           where a.source_id = s.id and a.run_id = ev.run_id and a.coverage_fingerprint = gp.fingerprint)
         ) order by s.created_at, s.id), '[]'::jsonb)
    into v_sources
    from public.sources s -- RLS: review role and clearance
    left join lateral (
      select jb.id, jb.run_id, jb.status, jb.error_message, jb.progress_done, jb.progress_total, jb.attempt
        from public.processing_jobs jb
        join public.processing_runs r on r.id = jb.run_id
       where jb.source_id = s.id and jb.stage = 'extract' and r.handover_id = p_handover_id
       order by r.created_at desc, r.id desc, jb.created_at desc, jb.id desc limit 1) j on true
    cross join lateral (select coalesce(j.run_id, v_run.id) as run_id) ev
    cross join lateral (
      select public.extraction_gap_state(j.id is not null, j.status, coalesce(j.progress_done, 0), coalesce(j.progress_total, 0)) as state,
             public.extraction_coverage_fingerprint(ev.run_id, j.id, j.status, coalesce(j.progress_done, 0), coalesce(j.progress_total, 0),
                                                    j.attempt, j.error_message) as fingerprint) gp
    left join public.extraction_source_coverage c on c.run_id = ev.run_id and c.source_id = s.id
    left join lateral (
      select coalesce(sum(x.candidates), 0)::int as candidates, coalesce(sum(x.inserted), 0)::int as inserted,
             coalesce(sum(x.merged), 0)::int as merged,
             coalesce((select jsonb_object_agg(d.key, d.total)
                         from (select e.key, sum((e.value)::numeric)::int as total
                                 from public.extraction_chunk_stats y, jsonb_each(y.dropped) e
                                where y.run_id = ev.run_id and y.source_id = s.id
                                group by e.key) d), '{}'::jsonb) as dropped
        from public.extraction_chunk_stats x
       where x.run_id = ev.run_id and x.source_id = s.id) st on true
    left join lateral (
      select count(*) filter (where z.linked)::int as linked,
             count(*) filter (where not z.linked and z.dismissed)::int as dismissed,
             count(*) filter (where not z.linked and not z.dismissed)::int as unreviewed
        from (
          select es.source_message_id,
                 bool_and(es.review_state = 'dismissed') as dismissed,
                 exists (select 1 from public.evidence_quotes q
                           join public.point_evidence pe on pe.evidence_id = q.id and pe.excluded_at is null
                           join public.handover_points hp on hp.id = pe.point_id and hp.erased_at is null
                                                         and hp.review_state <> 'rejected'
                          where q.source_message_id = es.source_message_id) as linked
            from public.extraction_signals es
           where es.source_id = s.id and es.detector_version = c.detector_version
           group by es.source_message_id) z) sg on true
   where s.handover_id = p_handover_id
     and (s.id = any (v_run.source_ids)
          or (s.deleted_at is null and s.version_number is not null and s.superseded_at is null and j.id is not null));

  return jsonb_build_object('available', true, 'runId', v_run.id, 'runStatus', v_run.status, 'sources', v_sources, 'flags', v_flags,
                            'sourceUpdates', v_updates);
end $$;

-- _source_json (same signature, SECURITY INVOKER): the version object gains the open review items of its update.
create or replace function public._source_json(s public.sources)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'handover_id', s.handover_id, 'kind', s.kind, 'title', s.title, 'state', s.state,
    'access_level', s.access_level, 'size_bytes', s.size_bytes, 'consent_recorded_at', s.consent_recorded_at,
    'raw_deleted_at', s.raw_deleted_at, 'first_message_at', s.first_message_at, 'last_message_at', s.last_message_at,
    'message_count', s.message_count, 'masking_counts', s.masking_counts, 'error_code', s.error_code,
    'version', jsonb_build_object(
      'lineage_id', s.lineage_id, 'version_number', s.version_number, 'supersedes_source_id', s.supersedes_source_id,
      'superseded_at', s.superseded_at, 'superseded_by_source_id', s.superseded_by_source_id,
      'update_state', (select c.state from public.source_version_changes c where c.to_source_id = s.id),
      'update_error', (select c.error_code from public.source_version_changes c where c.to_source_id = s.id),
      'open_reviews', (select count(*)::int from public.source_change_review_items i
                         join public.source_version_changes c on c.id = i.change_id
                        where c.to_source_id = s.id and i.state in ('open', 'investigating'))))
$$;

-- ── 7. grants ────────────────────────────────────────────────────────────────

revoke all on public.source_change_review_items from public, anon, authenticated, service_role;
grant select on public.source_change_review_items to authenticated, service_role;
-- no INSERT/UPDATE/DELETE for any API role: items are written only by the checked detector function

revoke execute on function
  public._trg_source_version_change_baseline(), public._guard_source_change_review_items(),
  public._stale_change_review_items(uuid, text), public._trg_source_removed_change_reviews(),
  public._blocking_change_reviews(uuid),
  public.list_change_detection_input(uuid),
  public.pipeline_record_change_detection(uuid, int, uuid, text, jsonb, jsonb, bigint),
  public.api_list_change_review_items(uuid), public.change_review_detail_safe(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.list_change_detection_input(uuid),
  public.pipeline_record_change_detection(uuid, int, uuid, text, jsonb, jsonb, bigint) to service_role;
grant execute on function public.api_list_change_review_items(uuid) to authenticated, service_role;
-- change_review_detail_safe (the CHECK constraint's helper) stays executable by no API role: rows are inserted only
-- inside the owner's checked function, and no API role can write the table.
