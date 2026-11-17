-- Round 3 Task 05C (Living Handover, stage 2): scoped processing of source updates and the publication gate.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY (docs/round3/living-handover-versions.md). Requires 20261117500100.
--
-- 1. SCOPED RUN. start_source_update_processing(actor, handover, …) starts a run whose SOURCE-SPECIFIC jobs
--    (parse, extract, verify_quotes) are only for the sources that need them, derived by the database under the
--    handover lock (`_source_update_scope`): current versions with a pending update (change awaiting_processing
--    or failed), plus current sources never extracted at all. Every other current source is left alone. The
--    handover-wide stages (verify_support, analyze, prepare_review) are REQUIRED, exactly once each. The run's
--    source_ids are all current included sources, so analyze compares against every current source and
--    verify_support keeps covering every unverified link of the handover, as in a full run. Only in review,
--    after a succeeded run, with at least one pending update; otherwise the full start_processing applies.
--    start_processing (full) is unchanged.
--
-- 2. TRUTHFUL UPDATE LIFECYCLE (source_version_changes.state), driven by triggers so every path (full or
--    scoped runs, worker closes, cancel, delete) records it:
--      awaiting_processing → processing          an extract job for the new version is created (any run)
--      failed              → processing          a retry: a later run extracts it again (same record)
--      processing          → awaiting_detection  the run SUCCEEDED and the new version was fully extracted
--      processing          → failed              otherwise; error_code says why:
--                                                  extraction_partial / extraction_failed  (Task 04 gap)
--                                                  run_failed / run_cancelled              (extraction complete,
--                                                  but the handover-wide checks did not finish)
--      awaiting_processing | failed | awaiting_detection → superseded   a newer version became current
--    awaiting_detection is NOT "ready": deterministic impact detection is Task 05D.
--
-- 3. PUBLICATION GATE (_assert_source_updates_settled), on the same two triggers points as Task 04 (a new
--    publication row; in_review → approved), so every publication path is covered. A current version whose update
--    is awaiting_processing, processing or awaiting_detection blocks publication (BTPF0 source_update_pending);
--    so does a failed update whose extraction was complete (run_failed / run_cancelled: reprocess it). A failed
--    update with an extraction gap goes through Task 04's explicit acknowledgement instead (unchanged), and the
--    update stays `failed`: publishing never marks it verified, and the publication audit records it
--    (publication.source_updates_unverified). 05D adds open review items to the same assertion.
--
-- 4. TASK 04 SCOPE (same signatures): a scoped run extracts only some sources, so "the latest run" no longer
--    describes every source. _extraction_publish_gaps and api_get_extraction_report now judge each source of the
--    latest run AND each current source by ITS OWN latest extraction (its latest extract job in any run). For a
--    full run this is exactly the previous result; it is never weaker (an older unacknowledged gap of a source
--    the scoped run did not touch is still a gap). The report also lists the source updates.

-- ── 0. lookups ───────────────────────────────────────────────────────────────

create index processing_jobs_source_stage_idx on public.processing_jobs (source_id, stage) where source_id is not null;

-- ── 1. the update lifecycle ──────────────────────────────────────────────────

alter table public.source_version_changes
  add column run_id uuid,
  add constraint source_version_changes_run_fk foreign key (handover_id, run_id)
    references public.processing_runs (handover_id, id) on delete set null (run_id),
  drop constraint source_version_changes_state_check,
  add constraint source_version_changes_state_check
    check (state in ('awaiting_processing', 'processing', 'awaiting_detection', 'failed', 'superseded')),
  add constraint source_version_changes_failed_reason
    check ((state <> 'failed' or error_code is not null) and (error_code is null or state in ('failed', 'superseded')));

-- Written only by the activation (insert) and by the lifecycle below; every transition is listed.
create or replace function public._guard_source_version_changes()
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
         new.detector_version, new.created_at)
        is not distinct from
        (old.id, old.handover_id, old.lineage_id, old.from_source_id, old.to_source_id, old.from_version, old.to_version,
         old.detector_version, old.created_at) then
    if (new.state, new.state_changed_at, new.error_code) is not distinct from (old.state, old.state_changed_at, old.error_code)
       and new.created_by is null and old.created_by is not null and new.run_id is not distinct from old.run_id then
      return new; -- ON DELETE SET NULL of the profile
    end if;
    if new.run_id is null and old.run_id is not null
       and (new.state, new.state_changed_at, new.error_code, new.created_by)
           is not distinct from (old.state, old.state_changed_at, old.error_code, old.created_by) then
      return new; -- ON DELETE SET NULL of a purged run
    end if;
    if new.created_by is not distinct from old.created_by and public._privileged('baton.versioning')
       and (old.state, new.state) in (('awaiting_processing', 'processing'), ('failed', 'processing'),
                                      ('processing', 'awaiting_detection'), ('processing', 'failed'),
                                      ('awaiting_processing', 'superseded'), ('failed', 'superseded'),
                                      ('awaiting_detection', 'superseded')) then
      return new;
    end if;
  end if;
  raise exception 'source_version_changes is written only by the version transition' using errcode = 'BTIT0';
end $$;

-- An extract job for the new version: the update is being processed (first time or a retry).
create function public._trg_source_update_extract_started()
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
   where to_source_id = new.source_id and state in ('awaiting_processing', 'failed');
  perform set_config('baton.versioning', v_flag, true); -- the caller's value (the activation keeps it on)
  return null;
end $$;

create trigger processing_jobs_source_update_started
  after insert on public.processing_jobs
  for each row when (new.stage = 'extract' and new.source_id is not null)
  execute function public._trg_source_update_extract_started();

-- The run that processed the update closed: record what really happened.
create function public._trg_source_update_run_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text := coalesce(current_setting('baton.versioning', true), '');
  c record;
  v_gap text;
begin
  perform set_config('baton.versioning', 'on', true);
  for c in select ch.id, ch.to_source_id from public.source_version_changes ch
            where ch.run_id = new.id and ch.state = 'processing' order by ch.id for update loop
    select public.extraction_gap_state(j.id is not null, j.status, coalesce(j.progress_done, 0), coalesce(j.progress_total, 0))
      into v_gap
      from (select 1) one
      left join lateral (
        select jb.id, jb.status, jb.progress_done, jb.progress_total from public.processing_jobs jb
         where jb.run_id = new.id and jb.source_id = c.to_source_id and jb.stage = 'extract'
         order by jb.created_at desc, jb.id desc limit 1) j on true;
    update public.source_version_changes
       set state = case when v_gap = 'complete' and new.status = 'succeeded' then 'awaiting_detection' else 'failed' end,
           error_code = case
             when v_gap = 'complete' and new.status = 'succeeded' then null
             when v_gap = 'partial' then 'extraction_partial'
             when v_gap = 'failed' then 'extraction_failed'
             when new.status = 'cancelled' then 'run_cancelled'
             else 'run_failed' end,
           state_changed_at = now()
     where id = c.id;
  end loop;
  perform set_config('baton.versioning', v_flag, true); -- the caller's value (the activation keeps it on)
  return null;
end $$;

create trigger processing_runs_source_update_closed
  after update of status on public.processing_runs
  for each row when (new.status in ('succeeded', 'failed', 'cancelled') and old.status is distinct from new.status)
  execute function public._trg_source_update_run_closed();

-- A newer version became current: the earlier update is superseded, whatever it had reached.
create function public._trg_source_update_superseded()
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
   where to_source_id = new.id and state in ('awaiting_processing', 'failed', 'awaiting_detection');
  perform set_config('baton.versioning', v_flag, true); -- the caller's value (the activation keeps it on)
  return null;
end $$;

create trigger sources_source_update_superseded
  after update of superseded_at on public.sources
  for each row when (old.superseded_at is null and new.superseded_at is not null)
  execute function public._trg_source_update_superseded();

-- ── 2. the publication gate ──────────────────────────────────────────────────

-- Pure: does an update in this state keep the handover from being published? (Used by the gate and the report.)
-- A failed update WITH an extraction gap is not blocked here: Task 04's acknowledgement decides it.
create function public.source_update_blocks_publication(p_state text, p_error_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_state in ('awaiting_processing', 'processing', 'awaiting_detection')
      or (p_state = 'failed' and coalesce(p_error_code, '') not in ('extraction_partial', 'extraction_failed'))
$$;

-- Updates of a handover's CURRENT versions that block publication (internal).
create function public._blocking_source_updates(p_handover_id uuid)
returns table (change_id uuid, source_id uuid, state text, error_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.to_source_id, c.state, c.error_code
    from public.source_version_changes c
    join public.sources s on s.id = c.to_source_id
   where c.handover_id = p_handover_id
     and s.deleted_at is null and s.superseded_at is null and s.version_number is not null
     and public.source_update_blocks_publication(c.state, c.error_code)
$$;

create function public._assert_source_updates_settled(p_handover_id uuid)
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
  -- Task 05D: open change-review items are asserted here too.
end $$;

create function public._trg_publication_source_update_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._assert_source_updates_settled(new.handover_id);
  return new;
end $$;

create function public._trg_handover_approved_source_update_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._assert_source_updates_settled(new.id);
  return new;
end $$;

create trigger handover_publications_source_update_gate
  before insert on public.handover_publications
  for each row execute function public._trg_publication_source_update_gate();

create trigger handovers_approved_source_update_gate
  before update of state on public.handovers
  for each row when (new.state = 'approved' and old.state not in ('approved', 'acknowledged'))
  execute function public._trg_handover_approved_source_update_gate();

-- A publication that went out with a failed (acknowledged) update says so in the audit log: it is never fresh.
create function public._trg_publication_unverified_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
begin
  select jsonb_agg(jsonb_build_object('sourceId', c.to_source_id, 'changeId', c.id, 'state', c.state, 'reason', c.error_code)
                   order by c.id)
    into v_items
    from public.source_version_changes c
    join public.sources s on s.id = c.to_source_id
   where c.handover_id = new.handover_id and c.state = 'failed'
     and s.deleted_at is null and s.superseded_at is null and s.version_number is not null;
  if v_items is not null then
    perform public._audit(new.handover_id, new.published_by, null, 'publication.source_updates_unverified',
                          'handover_publication', new.id, null, jsonb_build_object('updates', v_items));
  end if;
  return null;
end $$;

create trigger handover_publications_unverified_updates
  after insert on public.handover_publications
  for each row execute function public._trg_publication_unverified_updates();

-- ── 3. Task 04 scope: each source by its own latest extraction (same signatures) ─

create or replace function public._extraction_publish_gaps(p_handover_id uuid)
returns table (source_id uuid, run_id uuid, job_id uuid, gap_state text, chunks_done int, chunks_total int, fingerprint text)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select r.id, r.source_ids from public.processing_runs r
     where r.handover_id = p_handover_id order by r.created_at desc, r.id desc limit 1
  ), considered as (
    -- every source of the latest run (as before), and every current source (a scoped run does not touch them all)
    select unnest(latest.source_ids) as source_id from latest
    union
    select s.id from public.sources s
     where s.handover_id = p_handover_id and s.deleted_at is null and s.version_number is not null and s.superseded_at is null
  ), per_source as (
    select cs.source_id, coalesce(j.run_id, latest.id) as run_id, j.id as job_id, j.status,
           coalesce(j.progress_done, 0) as done, coalesce(j.progress_total, 0) as total, j.attempt, j.error_message
      from considered cs
      left join latest on true
      left join lateral (
        select jb.* from public.processing_jobs jb
          join public.processing_runs r on r.id = jb.run_id
         where jb.source_id = cs.source_id and jb.stage = 'extract' and r.handover_id = p_handover_id
         order by r.created_at desc, r.id desc, jb.created_at desc, jb.id desc limit 1) j on true
  )
  select ps.source_id, ps.run_id, ps.job_id,
         public.extraction_gap_state(ps.job_id is not null, ps.status, ps.done, ps.total),
         ps.done, ps.total,
         public.extraction_coverage_fingerprint(ps.run_id, ps.job_id, ps.status, ps.done, ps.total, ps.attempt, ps.error_message)
    from per_source ps
   where ps.run_id is not null
     and public.extraction_gap_state(ps.job_id is not null, ps.status, ps.done, ps.total) in ('partial', 'failed')
$$;

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

  -- R3 Task 05C: the updates of current versions, and whether each one keeps the handover from being published
  select coalesce(jsonb_agg(jsonb_build_object(
           'sourceId', c.to_source_id, 'previousSourceId', c.from_source_id, 'title', s.title,
           'fromVersion', c.from_version, 'toVersion', c.to_version, 'state', c.state, 'errorCode', c.error_code,
           'blocksPublication', public.source_update_blocks_publication(c.state, c.error_code))
           order by c.created_at, c.id), '[]'::jsonb)
    into v_updates
    from public.source_version_changes c -- RLS: both versions visible
    join public.sources s on s.id = c.to_source_id
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
    -- the source's own latest extraction (Task 05C: a scoped run does not extract every source)
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

-- ── 4. scoped processing ─────────────────────────────────────────────────────

-- The current versions a scoped run processes (internal): pending updates, and current sources never extracted.
create function public._source_update_scope(p_handover_id uuid)
returns table (source_id uuid, pending_update boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         exists (select 1 from public.source_version_changes c
                  where c.to_source_id = s.id and c.state in ('awaiting_processing', 'failed'))
    from public.sources s
   where s.handover_id = p_handover_id and s.deleted_at is null
     and s.version_number is not null and s.superseded_at is null
     and (s.state = 'parsed' or (s.state in ('uploaded', 'failed') and s.raw_storage_path is not null))
     and (exists (select 1 from public.source_version_changes c
                   where c.to_source_id = s.id and c.state in ('awaiting_processing', 'failed'))
          or not exists (select 1 from public.processing_jobs j where j.source_id = s.id and j.stage = 'extract'))
$$;

-- What the server should start (read-only): 'scoped' with the source ids to process, or 'full'.
create function public.source_update_processing_scope(p_actor_profile_id uuid, p_handover_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_ids uuid[];
  v_pending boolean;
begin
  select * into v_h from public.handovers where id = p_handover_id and deleted_at is null;
  if not found or not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not (public._is_creator_as(v_actor, p_handover_id) or public._member_role_as(v_actor, p_handover_id) = 'outgoing') then
    raise exception 'only the creator or an outgoing member can start processing' using errcode = 'BTFB0';
  end if;
  select array_agg(sc.source_id order by sc.source_id), coalesce(bool_or(sc.pending_update), false)
    into v_ids, v_pending
    from public._source_update_scope(p_handover_id) sc;
  if v_h.state = 'in_review' and v_pending
     and exists (select 1 from public.processing_runs r where r.handover_id = p_handover_id and r.status = 'succeeded') then
    return jsonb_build_object('mode', 'scoped', 'sourceIds', to_jsonb(v_ids));
  end if;
  return jsonb_build_object('mode', 'full', 'sourceIds', '[]'::jsonb);
end $$;

create function public.start_source_update_processing(p_actor_profile_id uuid,
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
  v_scope uuid[];
  v_pending boolean;
  v_run uuid;
  v_job jsonb;
  v_source uuid;
  v_stage text;
  v_wide text[] := '{}';
  s uuid;
begin
  v_h := public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not (public._is_creator_as(v_actor, p_handover_id) or public._member_role_as(v_actor, p_handover_id) = 'outgoing') then
    raise exception 'only the creator or an outgoing member can start processing' using errcode = 'BTFB0';
  end if;
  if v_h.state <> 'in_review' then
    raise exception 'a source update is processed in review only' using errcode = 'BTIT0';
  end if;
  if exists (select 1 from public.processing_runs where handover_id = p_handover_id and status in ('queued', 'running')) then
    raise exception 'a run is already active' using errcode = 'BTCF0';
  end if;
  if v_provider is null or coalesce(btrim(p_pipeline_version), '') = '' then
    raise exception 'pipeline version and AI provider are required' using errcode = 'BTVF0';
  end if;
  if not exists (select 1 from public.processing_runs r where r.handover_id = p_handover_id and r.status = 'succeeded') then
    raise exception 'the handover has never been processed: process it in full' using errcode = 'BTPF0';
  end if;

  -- the scope, derived here under the handover lock (never from the caller)
  select array_agg(sc.source_id), coalesce(bool_or(sc.pending_update), false) into v_scope, v_pending
    from public._source_update_scope(p_handover_id) sc;
  if not v_pending then
    raise exception 'there is no source update to process' using errcode = 'BTPF0';
  end if;
  -- every current included source is part of the run (handover-wide stages read them); only the scope gets jobs
  select array_agg(s2.id order by s2.created_at, s2.id) into v_included
    from public.sources s2
   where s2.handover_id = p_handover_id and s2.deleted_at is null
     and s2.version_number is not null and s2.superseded_at is null
     and (s2.state = 'parsed' or (s2.state in ('uploaded', 'failed') and s2.raw_storage_path is not null));
  if exists (select 1 from public.sources s3 where s3.id = any (v_included)
             and (s3.consent_recorded_at is null or s3.consent_ai_provider is distinct from v_provider)) then
    raise exception 'every source needs consent for the configured AI provider' using errcode = 'BTPF0';
  end if;

  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'a processing run needs at least one job' using errcode = 'BTVF0';
  end if;
  -- the job set must be exactly: per scoped source [parse when not parsed] + extract + verify_quotes, and each
  -- handover-wide stage once. Anything else means the caller's view is stale or the request is not ours.
  for v_job in select * from jsonb_array_elements(p_jobs) loop
    v_source := nullif(v_job ->> 'sourceId', '')::uuid;
    v_stage := v_job ->> 'stage';
    if v_stage in ('verify_support', 'analyze', 'prepare_review') then
      if v_source is not null or v_stage = any (v_wide) then
        raise exception 'unexpected handover-wide job' using errcode = 'BTVF0';
      end if;
      v_wide := v_wide || v_stage;
    elsif v_stage in ('parse', 'extract', 'verify_quotes') then
      if v_source is null or not (v_source = any (v_scope)) then
        raise exception 'job source is not part of this update' using errcode = 'BTCF0';
      end if;
      if v_stage = 'parse' and exists (select 1 from public.sources where id = v_source and state = 'parsed') then
        raise exception 'parse jobs are only for sources that are not parsed yet' using errcode = 'BTVF0';
      end if;
    else
      raise exception 'unknown stage' using errcode = 'BTVF0';
    end if;
  end loop;
  if cardinality(v_wide) <> 3 then
    raise exception 'every handover-wide stage is required' using errcode = 'BTVF0';
  end if;
  foreach s in array v_scope loop
    if (select count(*) from jsonb_array_elements(p_jobs) e
         where nullif(e ->> 'sourceId', '')::uuid = s and e ->> 'stage' in ('extract', 'verify_quotes')) <> 2
       or ((select state from public.sources where id = s) <> 'parsed'
           and not exists (select 1 from jsonb_array_elements(p_jobs) e
                            where nullif(e ->> 'sourceId', '')::uuid = s and e ->> 'stage' = 'parse')) then
      raise exception 'a source in this update has no complete job set' using errcode = 'BTCF0';
    end if;
  end loop;

  insert into public.processing_runs (handover_id, triggered_by, status, source_ids, pipeline_version, ai_provider, ai_config)
  values (p_handover_id, v_actor, 'queued', v_included, p_pipeline_version, v_provider, p_ai_config)
  returning id into v_run;
  for v_job in select * from jsonb_array_elements(p_jobs) loop
    insert into public.processing_jobs (handover_id, run_id, source_id, stage, input_hash, next_attempt_at)
    values (p_handover_id, v_run, nullif(v_job ->> 'sourceId', '')::uuid, v_job ->> 'stage', decode(v_job ->> 'inputHash', 'hex'), now());
  end loop;

  perform public.transition_handover(p_handover_id, 'processing', v_actor);
  perform public._audit(p_handover_id, v_actor, null, 'processing.started', 'processing_run', v_run, null,
                        jsonb_build_object('sourceCount', cardinality(v_included), 'scoped', true,
                                           'processedSourceCount', cardinality(v_scope)));
  return v_run;
end $$;

-- ── 5. the read API: each source's update state (same signature, SECURITY INVOKER) ─

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
      'update_error', (select c.error_code from public.source_version_changes c where c.to_source_id = s.id)))
$$;

-- ── 6. grants ────────────────────────────────────────────────────────────────

revoke execute on function
  public._trg_source_update_extract_started(), public._trg_source_update_run_closed(), public._trg_source_update_superseded(),
  public._blocking_source_updates(uuid), public._assert_source_updates_settled(uuid),
  public._trg_publication_source_update_gate(), public._trg_handover_approved_source_update_gate(),
  public._trg_publication_unverified_updates(), public._source_update_scope(uuid),
  public.source_update_processing_scope(uuid, uuid), public.start_source_update_processing(uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.source_update_processing_scope(uuid, uuid),
  public.start_source_update_processing(uuid, uuid, text, jsonb, jsonb) to service_role;

-- pure, table-free helper used by the SECURITY INVOKER report
revoke execute on function public.source_update_blocks_publication(text, text) from public, anon;
grant execute on function public.source_update_blocks_publication(text, text) to authenticated, service_role;
