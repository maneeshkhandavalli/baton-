-- Round 3 Task 05B (Living Handover, stage 1): the source version model.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY (docs/round3/living-handover-versions.md).
--
-- A source can receive a new, immutable VERSION. A version is an ordinary `sources` row linked to the row it
-- replaces, so every existing link keeps working unchanged: messages, evidence, jobs, RLS (`source_visible`),
-- retention, the identity vault and the exclusion rules all stay keyed by the source id. No second source
-- identity is introduced.
--
--   lineage_id               the version-1 row of the chain (itself for version 1)
--   version_number           1, 2, 3 …; NULL only for a CANDIDATE (an update being uploaded, not yet active)
--   supersedes_source_id     the version this one replaces (NULL for version 1)
--   superseded_at / _by      set once, when the next version becomes current
--
-- CURRENT version: version_number is not null, superseded_at is null and deleted_at is null (at most one per
-- lineage, unique index). Superseded versions stay live rows: their evidence, quotes and published snapshots
-- are untouched and they keep counting as the evidence's source. Only the current version is processed.
--
-- Two phases (decision: every new version needs fresh consent):
--   1. create_source_version(actor, previous, …)  creator only, draft/in_review only. Locks the lineage (the
--      current row FOR UPDATE), refuses a stale/removed/ineligible base, treats identical content as a no-op,
--      and inserts a CANDIDATE row (pending_upload, version_number NULL, access level of the previous version).
--      The existing upload signing, confirm_source_uploaded and storage policy are reused unchanged.
--   2. record_source_consent on a candidate ACTIVATES it, atomically: re-checks that the previous version is
--      still current (stale → conflict), refuses a broader visibility than the previous version, supersedes
--      the previous version, numbers the new one, records one source_version_changes row, carries the
--      previous version's source-scoped participant and date-range exclusions over, and audits it all.
--      Any failure rolls back the whole activation; the previous version stays current.
--
-- Changed in place (same signatures, grants and security mode):
--   * start_processing   includes only current versions.
--   * create_source      the 10-source cap counts current versions only (a superseded version or a pending
--                        update takes no slot); a handover-wide ceiling of 100 live rows still bounds history.
--   * record_source_consent  activation of a candidate, and refuses changes to a superseded version.
--   * remove_source      on a candidate: discards that pending update only; on the current version: removes
--                        the whole source (every version, with the existing evidence exclusion); a superseded
--                        version cannot be removed on its own (a removal is never a version change).
--   * _source_json       adds a `version` object (read API; the upgrade test ignores only that key).
--
-- Not stored (decision 11): no message hashes or digests beyond what already exists. Change detection, the
-- review queue and scoped processing are later stages (05C–05E); source_version_changes only records the
-- transition (state awaiting_processing, or superseded when a newer version replaces it first).
--
-- Privacy: handover-wide exclusions (including every participant erasure) already apply to every new source.
-- Source-scoped participant and date-range exclusions of the previous version are copied to the new version.
-- Source-scoped CONVERSATION exclusions are positional (c_N within one file, D32) and the excluded
-- conversation's bounds are never stored, so they cannot be carried over exactly: a version of such a source
-- is refused (fail closed) instead of risking that excluded content returns.

-- ── 1. columns, backfill, invariants ─────────────────────────────────────────

alter table public.sources
  add column lineage_id uuid,
  add column version_number int,
  add column supersedes_source_id uuid,
  add column superseded_at timestamptz,
  add column superseded_by_source_id uuid;

-- Every existing source becomes version 1 of its own lineage. updated_at is not touched (the backfill is not a
-- change of the source), so the touch trigger is paused for this one statement.
alter table public.sources disable trigger sources_touch;
update public.sources set lineage_id = id, version_number = 1;
alter table public.sources enable trigger sources_touch;

alter table public.sources
  alter column lineage_id set not null,
  add constraint sources_version_number_check check (version_number is null or version_number >= 1),
  -- version 1 is its own lineage root; every later version names its predecessor
  add constraint sources_version_root check ((supersedes_source_id is null) = (lineage_id = id)),
  add constraint sources_version_one check (supersedes_source_id is not null or version_number = 1),
  add constraint sources_version_successor check (supersedes_source_id is null or version_number is null or version_number >= 2),
  add constraint sources_version_not_self check (supersedes_source_id <> id and superseded_by_source_id <> id),
  add constraint sources_superseded_pair check ((superseded_at is null) = (superseded_by_source_id is null)),
  add constraint sources_superseded_versioned check (superseded_at is null or version_number is not null),
  -- same handover as the predecessor, the successor and the lineage root (composite keys)
  add constraint sources_lineage_fk foreign key (handover_id, lineage_id) references public.sources (handover_id, id),
  add constraint sources_supersedes_fk foreign key (handover_id, supersedes_source_id) references public.sources (handover_id, id),
  add constraint sources_superseded_by_fk foreign key (handover_id, superseded_by_source_id) references public.sources (handover_id, id),
  add constraint sources_lineage_version_key unique (lineage_id, version_number);

-- at most one current version per lineage
create unique index sources_lineage_current_key on public.sources (lineage_id)
  where version_number is not null and superseded_at is null and deleted_at is null;
-- at most one pending update (candidate) per lineage
create unique index sources_lineage_candidate_key on public.sources (lineage_id)
  where version_number is null and deleted_at is null;
-- a version is replaced by at most one activated successor
create unique index sources_supersedes_key on public.sources (supersedes_source_id)
  where supersedes_source_id is not null and version_number is not null;

-- The chain is immutable. Only create_source_version (insert of a candidate) and the activation inside
-- record_source_consent (number the candidate, supersede its predecessor) may touch the version columns, and
-- only forward. Holds for every role, the table owner included (no API role can write sources anyway).
create function public._guard_source_versions()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pred public.sources;
begin
  if tg_op = 'INSERT' then
    if new.supersedes_source_id is null then
      new.lineage_id := coalesce(new.lineage_id, new.id);
      new.version_number := coalesce(new.version_number, 1);
      if new.lineage_id <> new.id or new.version_number <> 1 then
        raise exception 'a first version is its own lineage' using errcode = 'BTIT0';
      end if;
    else
      if not public._privileged('baton.versioning') then
        raise exception 'source versions are created only by create_source_version' using errcode = 'BTIT0';
      end if;
      select * into v_pred from public.sources where id = new.supersedes_source_id;
      if not found or v_pred.handover_id <> new.handover_id then
        raise exception 'a version must replace a source of the same handover' using errcode = 'BTIT0';
      end if;
      new.lineage_id := coalesce(new.lineage_id, v_pred.lineage_id);
      if new.lineage_id <> v_pred.lineage_id or new.version_number is not null then
        raise exception 'a new version starts as a candidate of its predecessor''s lineage' using errcode = 'BTIT0';
      end if;
    end if;
    if new.superseded_at is not null or new.superseded_by_source_id is not null then
      raise exception 'a new source cannot already be superseded' using errcode = 'BTIT0';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.lineage_id is distinct from old.lineage_id or new.supersedes_source_id is distinct from old.supersedes_source_id then
    raise exception 'the version chain of a source is immutable' using errcode = 'BTIT0';
  end if;
  if new.version_number is distinct from old.version_number then
    if old.version_number is not null or not public._privileged('baton.versioning') then
      raise exception 'a version number is assigned once, on activation' using errcode = 'BTIT0';
    end if;
    select * into v_pred from public.sources where id = new.supersedes_source_id;
    if new.version_number is null or v_pred.version_number is null or new.version_number <> v_pred.version_number + 1
       or v_pred.superseded_by_source_id is distinct from new.id then
      raise exception 'a version is numbered right after the version it supersedes' using errcode = 'BTIT0';
    end if;
  end if;
  if (new.superseded_at, new.superseded_by_source_id) is distinct from (old.superseded_at, old.superseded_by_source_id) then
    if old.superseded_at is not null or not public._privileged('baton.versioning') or old.version_number is null
       or not exists (select 1 from public.sources s
                       where s.id = new.superseded_by_source_id and s.supersedes_source_id = old.id) then
      raise exception 'a version is superseded once, by its own successor' using errcode = 'BTIT0';
    end if;
  end if;
  return new;
end $$;

create trigger sources_version_guard
  before insert or update on public.sources
  for each row execute function public._guard_source_versions();

-- ── 2. the version transition record ────────────────────────────────────────

create table public.source_version_changes (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  lineage_id uuid not null,
  from_source_id uuid not null,
  to_source_id uuid not null,
  from_version int not null check (from_version >= 1),
  to_version int not null,
  -- 05B reaches awaiting_processing and superseded only; detecting / ready / failed come with 05D.
  state text not null default 'awaiting_processing' check (state in ('awaiting_processing', 'superseded')),
  detector_version text check (detector_version is null or detector_version ~ '^[a-z0-9_.@-]{1,32}$'),
  error_code text check (error_code is null or error_code ~ '^[a-z_]{1,64}$'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  state_changed_at timestamptz not null default now(),
  constraint source_version_changes_consecutive check (to_version = from_version + 1),
  constraint source_version_changes_distinct check (from_source_id <> to_source_id),
  constraint source_version_changes_lineage_fk foreign key (handover_id, lineage_id)
    references public.sources (handover_id, id) on delete cascade,
  constraint source_version_changes_from_fk foreign key (handover_id, from_source_id)
    references public.sources (handover_id, id) on delete cascade,
  constraint source_version_changes_to_fk foreign key (handover_id, to_source_id)
    references public.sources (handover_id, id) on delete cascade,
  -- one record per transition, whichever side it is looked up from
  constraint source_version_changes_to_key unique (to_source_id),
  constraint source_version_changes_from_key unique (from_source_id)
);
create index source_version_changes_handover_idx on public.source_version_changes (handover_id, state);

alter table public.source_version_changes enable row level security;
create policy source_version_changes_select on public.source_version_changes
  for select to authenticated
  using (public.source_visible(from_source_id) and public.source_visible(to_source_id));

-- Written only by the activation; afterwards only awaiting_processing → superseded (a newer version won), and
-- the creator reference may be cleared by account deletion. Cascades from a purged handover/source apply.
create function public._guard_source_version_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if public._privileged('baton.versioning') then return new; end if;
  elsif tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
  elsif (new.id, new.handover_id, new.lineage_id, new.from_source_id, new.to_source_id, new.from_version, new.to_version,
         new.detector_version, new.error_code, new.created_at)
        is not distinct from
        (old.id, old.handover_id, old.lineage_id, old.from_source_id, old.to_source_id, old.from_version, old.to_version,
         old.detector_version, old.error_code, old.created_at) then
    if new.state = old.state and new.state_changed_at = old.state_changed_at
       and new.created_by is null and old.created_by is not null then
      return new; -- ON DELETE SET NULL of the profile
    end if;
    if old.state = 'awaiting_processing' and new.state = 'superseded'
       and new.created_by is not distinct from old.created_by and public._privileged('baton.versioning') then
      return new;
    end if;
  end if;
  raise exception 'source_version_changes is written only by the version transition' using errcode = 'BTIT0';
end $$;

create trigger source_version_changes_guard
  before insert or update or delete on public.source_version_changes
  for each row execute function public._guard_source_version_changes();

-- ── 3. create_source_version ─────────────────────────────────────────────────
-- Returns {handover_id, outcome, source_id}. Writes nothing for the refusals that need a specific explanation:
--   created | resumed          a candidate awaits its upload (sign an upload ticket for source_id)
--   awaiting_confirmation      the candidate's file already arrived: confirm it (no new upload)
--   awaiting_consent           the candidate is confirmed: record consent to activate it
--   unchanged                  the file is identical to the current version: nothing to do (idempotent)
--   stale                      p_previous_source_id is no longer the current version (source_id = the current one)
--   update_in_progress         another update of this source (different file) is pending (source_id = that candidate)
--   exclusions_not_portable    the source has conversation exclusions, which cannot be carried to a new file
-- Raises: not_found (unknown, removed or invisible source), forbidden (not the creator), invalid_transition
-- (handover not in draft/review, or the base is not a finished upload), validation_failed (checksum, a different
-- kind of source, size), precondition_failed (history ceiling), conflict (the file is another live source).
create function public.create_source_version(p_actor_profile_id uuid,
  p_previous_source_id uuid, p_kind text, p_file_name text, p_mime_type text, p_size_bytes bigint, p_sha256_hex text,
  p_timezone text default 'Asia/Kolkata'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_prev public.sources;
  v_cand public.sources;
  v_h public.handovers;
  v_sha bytea;
  v_id uuid := gen_random_uuid();
  v_current uuid;
begin
  select * into v_prev from public.sources where id = p_previous_source_id;
  if not found then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_share(v_prev.handover_id);
  if not public._is_member_as(v_actor, v_prev.handover_id) then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, v_prev.handover_id) then
    raise exception 'only the creator can upload a new version of a source' using errcode = 'BTFB0';
  end if;
  if v_h.state not in ('draft', 'in_review') then
    raise exception 'a new version can be added in draft or review only' using errcode = 'BTIT0';
  end if;
  if p_sha256_hex is null or p_sha256_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid checksum' using errcode = 'BTVF0';
  end if;
  v_sha := decode(p_sha256_hex, 'hex');

  -- The lineage lock: the base row, FOR UPDATE. Every writer of a lineage's versions takes it first.
  select * into v_prev from public.sources where id = p_previous_source_id for update;
  if v_prev.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0'; -- a removed source is never a version base
  end if;
  if v_prev.version_number is null then
    raise exception 'a pending update cannot itself be replaced' using errcode = 'BTIT0';
  end if;
  if v_prev.superseded_at is not null then
    select s.id into v_current from public.sources s
     where s.lineage_id = v_prev.lineage_id and s.version_number is not null and s.superseded_at is null and s.deleted_at is null;
    return jsonb_build_object('handover_id', v_prev.handover_id, 'outcome', 'stale', 'source_id', v_current);
  end if;
  if v_prev.state not in ('uploaded', 'parsed', 'failed') then
    raise exception 'this source has not finished uploading' using errcode = 'BTIT0';
  end if;
  if p_kind is distinct from v_prev.kind then
    raise exception 'a new version must be the same kind of source' using errcode = 'BTVF0';
  end if;
  if v_sha = v_prev.sha256 then
    return jsonb_build_object('handover_id', v_prev.handover_id, 'outcome', 'unchanged', 'source_id', v_prev.id);
  end if;
  if exists (select 1 from public.source_exclusions e where e.source_id = v_prev.id and e.kind = 'conversation') then
    return jsonb_build_object('handover_id', v_prev.handover_id, 'outcome', 'exclusions_not_portable', 'source_id', v_prev.id);
  end if;

  select * into v_cand from public.sources s
   where s.lineage_id = v_prev.lineage_id and s.version_number is null and s.deleted_at is null
   for update;
  if found then
    if v_cand.sha256 <> v_sha then
      return jsonb_build_object('handover_id', v_prev.handover_id, 'outcome', 'update_in_progress', 'source_id', v_cand.id);
    end if;
    if v_cand.state = 'uploaded' then
      return jsonb_build_object('handover_id', v_prev.handover_id, 'outcome', 'awaiting_consent', 'source_id', v_cand.id);
    end if;
    if v_cand.state <> 'pending_upload' then
      return jsonb_build_object('handover_id', v_prev.handover_id, 'outcome', 'update_in_progress', 'source_id', v_cand.id);
    end if;
    if exists (select 1 from storage.objects o where o.bucket_id = 'source-uploads' and o.name = v_cand.raw_storage_path) then
      return jsonb_build_object('handover_id', v_prev.handover_id, 'outcome', 'awaiting_confirmation', 'source_id', v_cand.id);
    end if;
    -- the same update retried before its file arrived: reuse the row and its path (like create_source)
    update public.sources
       set original_filename = p_file_name, mime_type = p_mime_type, size_bytes = p_size_bytes, timezone = p_timezone
     where id = v_cand.id;
    perform public._audit(v_cand.handover_id, v_actor, null, 'source.version_upload_restarted', 'source', v_cand.id, null,
                          jsonb_build_object('previousSourceId', v_prev.id, 'sizeBytes', p_size_bytes));
    return jsonb_build_object('handover_id', v_prev.handover_id, 'outcome', 'resumed', 'source_id', v_cand.id);
  end if;

  -- History ceiling (superseded versions take no slot of the 10-source cap, but they are still bounded).
  if (select count(*) from public.sources where handover_id = v_prev.handover_id and deleted_at is null) >= 100 then
    raise exception 'this handover has too many source versions' using errcode = 'BTPF0';
  end if;

  perform set_config('baton.versioning', 'on', true);
  begin
    insert into public.sources (id, handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256,
                                state, access_level, timezone, raw_storage_path, lineage_id, supersedes_source_id, version_number)
    values (v_id, v_prev.handover_id, v_actor, p_kind, v_prev.title, p_file_name, p_mime_type, p_size_bytes, v_sha,
            'pending_upload', v_prev.access_level, p_timezone,
            'raw/' || v_prev.handover_id::text || '/' || v_id::text, v_prev.lineage_id, v_prev.id, null);
  exception when unique_violation then
    perform set_config('baton.versioning', 'off', true);
    raise exception 'this file was already uploaded' using errcode = 'BTCF0'; -- the same file is another live source
  end;
  perform set_config('baton.versioning', 'off', true);

  perform public._audit(v_prev.handover_id, v_actor, null, 'source.version_upload_started', 'source', v_id, null,
                        jsonb_build_object('previousSourceId', v_prev.id, 'lineageId', v_prev.lineage_id,
                                           'kind', p_kind, 'sizeBytes', p_size_bytes));
  return jsonb_build_object('handover_id', v_prev.handover_id, 'outcome', 'created', 'source_id', v_id);
end $$;

-- ── 4. activation: record_source_consent (same signature) ────────────────────

create or replace function public.record_source_consent(p_actor_profile_id uuid,
  p_source_id uuid, p_statement_version text, p_ai_provider text, p_access_level text, p_timezone text,
  p_date_order text default null, p_document_date date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_s public.sources;
  v_h public.handovers;
  v_prev public.sources;
  v_candidate boolean;
  v_carried int := 0;
begin
  select * into v_s from public.sources where id = p_source_id;
  if not found or v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_share(v_s.handover_id);
  perform public._require_source_manager(p_actor_profile_id, v_s.handover_id);
  -- Lock order of every version writer: the lineage's current row first, then the candidate.
  if v_s.version_number is null then
    select * into v_prev from public.sources where id = v_s.supersedes_source_id for update;
  end if;
  select * into v_s from public.sources where id = p_source_id for update;
  if v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  if v_s.superseded_at is not null then
    raise exception 'an earlier version of a source cannot be changed' using errcode = 'BTIT0';
  end if;
  if coalesce(btrim(p_statement_version), '') = '' or coalesce(btrim(p_ai_provider), '') = '' then
    raise exception 'consent statement and provider are required' using errcode = 'BTVF0';
  end if;
  if public.access_rank(p_access_level) is null then
    raise exception 'unknown access level' using errcode = 'BTVF0';
  end if;
  if public.access_rank(p_access_level) < public.access_rank(v_s.access_level)
     and v_s.consent_recorded_at is not null and not public._is_creator_as(v_actor, v_s.handover_id) then
    raise exception 'only the creator can lower a source''s access level' using errcode = 'BTFB0';
  end if;

  v_candidate := v_s.version_number is null;
  if v_candidate then
    if not public._is_creator_as(v_actor, v_s.handover_id) then
      raise exception 'only the creator can add a new version of a source' using errcode = 'BTFB0';
    end if;
    if v_h.state not in ('draft', 'in_review') then
      raise exception 'a new version can be activated in draft or review only' using errcode = 'BTIT0';
    end if;
    if v_s.state <> 'uploaded' then
      raise exception 'the new version has not finished uploading' using errcode = 'BTIT0';
    end if;
    -- revalidated at activation, not only when the upload started
    if v_prev.id is null or v_prev.deleted_at is not null or v_prev.superseded_at is not null or v_prev.version_number is null then
      raise exception 'the source changed since this version was started' using errcode = 'BTCF0';
    end if;
    if public.access_rank(p_access_level) < public.access_rank(v_prev.access_level) then
      raise exception 'a new version cannot be visible to more people than the version it replaces' using errcode = 'BTVF0';
    end if;
    if exists (select 1 from public.source_exclusions e where e.source_id = v_prev.id and e.kind = 'conversation') then
      raise exception 'conversation exclusions cannot be carried to a new version' using errcode = 'BTPF0';
    end if;

    perform set_config('baton.versioning', 'on', true);
    -- predecessor first: the current-version index never sees two current rows
    update public.sources set superseded_at = now(), superseded_by_source_id = v_s.id where id = v_prev.id;
    update public.sources set version_number = v_prev.version_number + 1 where id = v_s.id;
    update public.source_version_changes set state = 'superseded', state_changed_at = now()
     where to_source_id = v_prev.id and state = 'awaiting_processing';
    insert into public.source_version_changes (handover_id, lineage_id, from_source_id, to_source_id, from_version, to_version, created_by)
    values (v_s.handover_id, v_s.lineage_id, v_prev.id, v_s.id, v_prev.version_number, v_prev.version_number + 1, v_actor);
    perform set_config('baton.versioning', 'off', true);

    -- The previous version's source-scoped exclusions apply to the new file too (handover-wide ones already do).
    insert into public.source_exclusions (handover_id, source_id, requested_by, kind, participant_identity_kind,
                                          participant_identity_hash, participant_identity_pepper_version,
                                          range_start, range_end, reason, requested_via)
    select e.handover_id, v_s.id, e.requested_by, e.kind, e.participant_identity_kind, e.participant_identity_hash,
           e.participant_identity_pepper_version, e.range_start, e.range_end, e.reason, e.requested_via
      from public.source_exclusions e
     where e.source_id = v_prev.id and e.kind in ('participant', 'date_range');
    get diagnostics v_carried = row_count;

    perform public._audit(v_s.handover_id, v_actor, null, 'source.superseded', 'source', v_prev.id,
                          jsonb_build_object('versionNumber', v_prev.version_number),
                          jsonb_build_object('supersededBy', v_s.id));
    perform public._audit(v_s.handover_id, v_actor, null, 'source.version_created', 'source', v_s.id, null,
                          jsonb_build_object('previousSourceId', v_prev.id, 'lineageId', v_s.lineage_id,
                                             'versionNumber', v_prev.version_number + 1, 'exclusionsCarried', v_carried,
                                             'accessLevel', p_access_level));
  end if;

  -- a new version keeps the previous version's parse settings unless the caller names new ones
  update public.sources
     set consent_statement_version = p_statement_version, consent_ai_provider = p_ai_provider,
         consent_recorded_at = now(), consent_recorded_by = v_actor, access_level = p_access_level,
         timezone = p_timezone,
         date_order = case when v_candidate then coalesce(p_date_order, v_prev.date_order) else p_date_order end,
         document_date = case when v_candidate then coalesce(p_document_date, v_prev.document_date) else p_document_date end
   where id = p_source_id;
  perform public._audit(v_s.handover_id, v_actor, null, 'source.consent_recorded', 'source', p_source_id,
                        jsonb_build_object('accessLevel', v_s.access_level),
                        jsonb_build_object('accessLevel', p_access_level, 'statementVersion', p_statement_version,
                                           'provider', p_ai_provider));
end $$;

-- ── 5. remove_source (same signature): never a version change ───────────────

create or replace function public.remove_source(p_actor_profile_id uuid, p_source_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_s public.sources;
  v_h public.handovers;
  v_ids uuid[];
begin
  select * into v_s from public.sources where id = p_source_id;
  if not found or v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_share(v_s.handover_id);
  perform public._require_source_manager(p_actor_profile_id, v_s.handover_id);
  if v_h.state = 'processing' then
    raise exception 'sources cannot be removed while processing' using errcode = 'BTIT0';
  end if;
  -- same lock order as the version writers: the lineage's current row first
  perform 1 from public.sources s
   where s.lineage_id = v_s.lineage_id and s.version_number is not null and s.superseded_at is null and s.deleted_at is null
   for update;
  select * into v_s from public.sources where id = p_source_id for update;
  if v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  if v_s.superseded_at is not null then
    raise exception 'an earlier version cannot be removed on its own; remove the current version' using errcode = 'BTIT0';
  end if;

  if v_s.version_number is null then
    v_ids := array[v_s.id]; -- a pending update: discard it, the current version is untouched
  else
    -- the current version: the source as a whole (every version and any pending update)
    select array_agg(s.id) into v_ids from public.sources s where s.lineage_id = v_s.lineage_id and s.deleted_at is null;
  end if;

  update public.sources set deleted_at = now(), state = 'removed' where id = any (v_ids);
  update public.point_evidence pe
     set excluded_at = now(), excluded_by = v_actor, exclusion_reason = 'source_removed'
    from public.evidence_quotes q
   where q.id = pe.evidence_id and q.source_id = any (v_ids) and pe.excluded_at is null;
  perform public._audit(v_s.handover_id, v_actor, null, 'source.removed', 'source', p_source_id,
                        jsonb_build_object('state', v_s.state),
                        jsonb_strip_nulls(jsonb_build_object('state', 'removed',
                          'versionsRemoved', case when cardinality(v_ids) > 1 then cardinality(v_ids) end,
                          'pendingVersionDiscarded', case when v_s.version_number is null then true end)));
  return v_s.raw_storage_path;
end $$;

-- ── 6. start_processing (same signature): current versions only ─────────────
-- Identical to 20261113300400 except the source scope: a superseded version or a pending update is never
-- included. Their evidence stays attached to their own ids.

create or replace function public.start_processing(p_actor_profile_id uuid,
  p_handover_id uuid, p_pipeline_version text, p_ai_config jsonb, p_jobs jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_provider text := p_ai_config ->> 'provider';
  v_included uuid[];
  v_run uuid;
  v_job jsonb;
  v_source uuid;
begin
  v_h := public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not (public._is_creator_as(v_actor, p_handover_id) or public._member_role_as(v_actor, p_handover_id) = 'outgoing') then
    raise exception 'only the creator or an outgoing member can start processing' using errcode = 'BTFB0';
  end if;
  if v_h.state not in ('draft', 'in_review') then
    raise exception 'processing cannot start from %', v_h.state using errcode = 'BTIT0';
  end if;
  if exists (select 1 from public.processing_runs where handover_id = p_handover_id and status in ('queued', 'running')) then
    raise exception 'a run is already active' using errcode = 'BTCF0';
  end if;
  if v_provider is null or coalesce(btrim(p_pipeline_version), '') = '' then
    raise exception 'pipeline version and AI provider are required' using errcode = 'BTVF0';
  end if;

  select array_agg(s.id order by s.created_at, s.id) into v_included
    from public.sources s
   where s.handover_id = p_handover_id and s.deleted_at is null
     and s.version_number is not null and s.superseded_at is null -- Task 05B: the current version of each source
     and (s.state = 'parsed' or (s.state in ('uploaded', 'failed') and s.raw_storage_path is not null));
  if v_included is null then
    raise exception 'no source is ready for processing' using errcode = 'BTPF0';
  end if;
  if exists (select 1 from public.sources s where s.id = any (v_included)
             and (s.consent_recorded_at is null or s.consent_ai_provider is distinct from v_provider)) then
    raise exception 'every source needs consent for the configured AI provider' using errcode = 'BTPF0';
  end if;

  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'a processing run needs at least one job' using errcode = 'BTVF0';
  end if;

  insert into public.processing_runs (handover_id, triggered_by, status, source_ids, pipeline_version, ai_provider, ai_config)
  values (p_handover_id, v_actor, 'queued', v_included, p_pipeline_version, v_provider, p_ai_config)
  returning id into v_run;

  for v_job in select * from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) loop
    v_source := nullif(v_job ->> 'sourceId', '')::uuid;
    if v_source is not null and not (v_source = any (v_included)) then
      raise exception 'job source is not part of this run' using errcode = 'BTVF0';
    end if;
    if v_job ->> 'stage' = 'parse' and (v_source is null
        or exists (select 1 from public.sources where id = v_source and state = 'parsed')) then
      raise exception 'parse jobs are only for sources that are not parsed yet' using errcode = 'BTVF0';
    end if;
    insert into public.processing_jobs (handover_id, run_id, source_id, stage, input_hash, next_attempt_at)
    values (p_handover_id, v_run, v_source, v_job ->> 'stage', decode(v_job ->> 'inputHash', 'hex'), now());
  end loop;

  perform public.transition_handover(p_handover_id, 'processing', v_actor);
  perform public._audit(p_handover_id, v_actor, null, 'processing.started', 'processing_run', v_run, null,
                        jsonb_build_object('sourceCount', cardinality(v_included)));
  return v_run;
end $$;

-- ── 7. create_source (same signature): the cap counts current versions ───────
-- Identical to 20261113100300 except the cap: current versions and new uploads count; superseded versions and
-- pending updates do not. The 100-row history ceiling still bounds accumulation.

create or replace function public.create_source(p_actor_profile_id uuid,
  p_handover_id uuid, p_kind text, p_file_name text, p_mime_type text, p_size_bytes bigint, p_sha256_hex text,
  p_timezone text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_id uuid := gen_random_uuid();
  v_prev public.sources;
  v_replaces uuid;
begin
  v_h := public._lock_handover_for_share(p_handover_id);
  perform public._require_source_manager(p_actor_profile_id, p_handover_id);
  if v_h.state not in ('draft', 'in_review') then
    raise exception 'sources can be added in draft or review only' using errcode = 'BTIT0';
  end if;
  if p_sha256_hex is null or p_sha256_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid checksum' using errcode = 'BTVF0';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('baton.create_source:' || p_handover_id::text || ':' || p_sha256_hex, 0));

  select * into v_prev
    from public.sources s
   where s.handover_id = p_handover_id and s.sha256 = decode(p_sha256_hex, 'hex') and s.deleted_at is null
     and s.state = 'pending_upload' and s.uploaded_by = v_actor
     and s.version_number is not null -- a pending update of another source is not this upload's earlier attempt
   for update;

  if found then
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'source-uploads' and o.name = v_prev.raw_storage_path) then
      update public.sources
         set kind = p_kind, title = left(p_file_name, 255), original_filename = p_file_name, mime_type = p_mime_type,
             size_bytes = p_size_bytes, timezone = p_timezone,
             raw_storage_path = 'raw/' || p_handover_id::text || '/' || v_prev.id::text
       where id = v_prev.id;
      perform public._audit(p_handover_id, v_actor, null, 'source.upload_restarted', 'source', v_prev.id, null,
                            jsonb_build_object('kind', p_kind, 'sizeBytes', p_size_bytes));
      return v_prev.id;
    end if;
    update public.sources set deleted_at = now(), state = 'removed' where id = v_prev.id;
    perform public._audit(p_handover_id, v_actor, null, 'source.removed', 'source', v_prev.id,
                          jsonb_build_object('state', 'pending_upload'),
                          jsonb_build_object('state', 'removed', 'reason', 'upload_retried'));
    v_replaces := v_prev.id;
  end if;

  if (select count(*) from public.sources
       where handover_id = p_handover_id and deleted_at is null
         and version_number is not null and superseded_at is null) >= 10 then
    raise exception 'a handover has at most 10 sources' using errcode = 'BTPF0'; -- D15 (current versions)
  end if;
  if (select count(*) from public.sources where handover_id = p_handover_id and deleted_at is null) >= 100 then
    raise exception 'this handover has too many source versions' using errcode = 'BTPF0';
  end if;
  begin
    insert into public.sources (id, handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256,
                                state, timezone, raw_storage_path)
    values (v_id, p_handover_id, v_actor, p_kind, left(p_file_name, 255), p_file_name, p_mime_type, p_size_bytes,
            decode(p_sha256_hex, 'hex'), 'pending_upload', p_timezone,
            'raw/' || p_handover_id::text || '/' || v_id::text);
  exception when unique_violation then
    raise exception 'this file was already uploaded' using errcode = 'BTCF0';
  end;
  perform public._audit(p_handover_id, v_actor, null, 'source.created', 'source', v_id, null,
                        jsonb_strip_nulls(jsonb_build_object('kind', p_kind, 'sizeBytes', p_size_bytes, 'replaces', v_replaces)));
  return v_id;
end $$;

-- ── 8. read API: the version of each source (same signature, SECURITY INVOKER) ─

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
      'superseded_at', s.superseded_at, 'superseded_by_source_id', s.superseded_by_source_id))
$$;

-- ── 9. grants ────────────────────────────────────────────────────────────────

grant select on public.source_version_changes to authenticated, service_role;
-- no INSERT/UPDATE/DELETE for any API role: the record is written only by the activation

revoke execute on function
  public._guard_source_versions(), public._guard_source_version_changes(),
  public.create_source_version(uuid, uuid, text, text, text, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_source_version(uuid, uuid, text, text, text, bigint, text, text) to service_role;
