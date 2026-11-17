-- Round 3 Task 04: partial-source publishing acknowledgement, ENFORCED IN THE DATABASE, with an audit record.
-- ADDITIVE / forward-only. REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- Before: Task 03 refused to publish a handover with a partly analysed or failed source unless the reviewer
-- acknowledged it, but only in the server action (lib/actions/core/handovers.ts). Any other service-role path could
-- publish without it, and the acknowledgement was not recorded.
--
-- Policy (same as the Task 03 report; computed here from processing_jobs only, so it never depends on the optional
-- coverage tables):
--   for each source of the handover's LATEST processing run, its extract job decides the state:
--     succeeded with every chunk done            → complete           (no acknowledgement)
--     (complete_with_skips is a coverage-table refinement of complete: no acknowledgement, as in Task 03)
--     succeeded with chunks missing              → partial            (acknowledgement required)
--     failed / cancelled / skipped, ≥ 1 chunk    → partial            (acknowledgement required)
--     failed / cancelled / skipped, no chunk     → failed             (acknowledgement required)
--     no extract job for the source in that run  → not_processed      (as Task 03; never happens in a planned run:
--                                                  plan.ts gives every included source an extract job, and a
--                                                  source whose parse failed gets a cancelled one = failed)
--     queued / running                           → in progress        (publishing is impossible then anyway)
--   Every partial/failed state has a FINGERPRINT over (run, job, status, chunks done/total, attempt, reason). An
--   acknowledgement covers exactly one fingerprint: a new run, a retry, or any change of that state yields a new
--   fingerprint, so an old acknowledgement never carries over.
--
-- Enforcement (triggers, so EVERY publication path is gated, including the existing 3-argument publish_handover and
-- direct table writes by any role that can write these tables):
--   * BEFORE INSERT ON handover_publications, and
--   * BEFORE UPDATE OF state ON handovers when the new state is 'approved' and the old one is neither 'approved' nor
--     'acknowledged' ('acknowledged' → 'approved' is the incoming-member lifecycle, not a publication),
--   refuse with BTPF0 ("extraction_incomplete") while any partial/failed source of the latest run has no
--   acknowledgement for its CURRENT fingerprint. The check runs in the publishing transaction, under the
--   publish lock (FOR UPDATE on the handover), so publication and its acknowledgement check are consistent.
--
-- Acknowledgement path: publish_handover(actor, handover, summary, p_acknowledgements jsonb) (service_role only,
-- verified actor as every mutation, H1). It re-checks membership and the creator rule exactly as publish_handover,
-- refuses any acknowledgement whose (source, fingerprint) is not a current gap (BTCF0: the coverage changed since the
-- reviewer saw it), records the acknowledgements, audits them, then publishes through the unchanged 3-argument
-- function, all in ONE transaction: if publishing fails, no acknowledgement remains.
-- The acknowledgement table has no write grant for any API role (RLS on; reads under source visibility).
--
-- Security boundary: this prevents application paths (including service-role ones) from publishing past the gate.
-- A database owner or superuser can always disable triggers or alter objects; that is outside this guarantee.
--
-- Also: api_get_extraction_report (same signature, grants, SECURITY INVOKER) adds per-source `gapState`,
-- `coverageFingerprint` and `gapAcknowledged`, from the same helpers, so the interface acknowledges exactly what
-- the database enforces. Existing published handovers and their reads are not modified.

-- ── pure helpers (immutable; no table access; safe for any caller) ───────────

create function public.extraction_gap_state(p_has_job boolean, p_status text, p_done int, p_total int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not p_has_job then 'not_processed'
    when p_status in ('queued', 'running') then 'in_progress'
    when p_status = 'succeeded' then
      case when coalesce(p_total, 0) > 0 and coalesce(p_done, 0) < p_total then 'partial' else 'complete' end
    else case when coalesce(p_done, 0) > 0 then 'partial' else 'failed' end
  end
$$;

create function public.extraction_coverage_fingerprint(p_run_id uuid, p_job_id uuid, p_status text, p_done int, p_total int,
                                                       p_attempt int, p_error text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'cov1:' || md5(concat_ws('|', p_run_id::text, coalesce(p_job_id::text, 'no-job'), coalesce(p_status, ''),
                                  coalesce(p_done, 0)::text, coalesce(p_total, 0)::text, coalesce(p_attempt, 0)::text,
                                  coalesce(p_error, '')))
$$;

-- ── the gaps of a handover's latest run (internal) ──────────────────────────

create function public._extraction_publish_gaps(p_handover_id uuid)
returns table (source_id uuid, run_id uuid, job_id uuid, gap_state text, chunks_done int, chunks_total int, fingerprint text)
language sql
stable
security definer
set search_path = ''
as $$
  with run as (
    select r.id, r.source_ids from public.processing_runs r
     where r.handover_id = p_handover_id order by r.created_at desc, r.id desc limit 1
  ), per_source as (
    select s.source_id, run.id as run_id, j.id as job_id, j.status, coalesce(j.progress_done, 0) as done,
           coalesce(j.progress_total, 0) as total, j.attempt, j.error_message
      from run cross join lateral unnest(run.source_ids) as s(source_id)
      left join lateral (
        select jb.* from public.processing_jobs jb
         where jb.run_id = run.id and jb.source_id = s.source_id and jb.stage = 'extract'
         order by jb.created_at desc, jb.id desc limit 1) j on true
  )
  select ps.source_id, ps.run_id, ps.job_id,
         public.extraction_gap_state(ps.job_id is not null, ps.status, ps.done, ps.total),
         ps.done, ps.total,
         public.extraction_coverage_fingerprint(ps.run_id, ps.job_id, ps.status, ps.done, ps.total, ps.attempt, ps.error_message)
    from per_source ps
   where public.extraction_gap_state(ps.job_id is not null, ps.status, ps.done, ps.total) in ('partial', 'failed')
$$;

-- ── acknowledgement audit record ─────────────────────────────────────────────

create table public.publication_source_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  source_id uuid not null,
  run_id uuid not null references public.processing_runs (id) on delete cascade,
  extract_job_id uuid references public.processing_jobs (id) on delete set null,
  gap_state text not null check (gap_state in ('partial', 'failed')),
  chunks_done int not null check (chunks_done >= 0),
  chunks_total int not null check (chunks_total >= 0),
  coverage_fingerprint text not null check (coverage_fingerprint ~ '^cov1:[0-9a-f]{32}$'),
  acknowledged_by uuid references public.profiles (id) on delete set null, -- the verified actor at the time
  acknowledged_at timestamptz not null default now(),
  constraint publication_source_acknowledgements_source_fk foreign key (handover_id, source_id)
    references public.sources (handover_id, id) on delete cascade,
  constraint publication_source_acknowledgements_once unique (source_id, run_id, coverage_fingerprint)
);
create index publication_source_acknowledgements_handover_idx on public.publication_source_acknowledgements (handover_id, run_id);

alter table public.publication_source_acknowledgements enable row level security;
create policy publication_source_acknowledgements_select on public.publication_source_acknowledgements
  for select to authenticated using (public.source_visible(source_id));

-- Append-only: the record of who accepted what cannot be edited or removed by any application role (cascades
-- from a purged handover/source/run still apply, as for every other handover row).
create function public._guard_publication_source_acknowledgements()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.acknowledged_by is null and old.acknowledged_by is not null
     and (new.id, new.handover_id, new.source_id, new.run_id, new.gap_state, new.coverage_fingerprint, new.acknowledged_at)
         is not distinct from (old.id, old.handover_id, old.source_id, old.run_id, old.gap_state, old.coverage_fingerprint, old.acknowledged_at) then
    return new; -- ON DELETE SET NULL of the profile (account deletion) is allowed
  end if;
  if tg_op = 'UPDATE' and new.extract_job_id is null and old.extract_job_id is not null
     and (new.id, new.handover_id, new.source_id, new.run_id, new.gap_state, new.coverage_fingerprint, new.acknowledged_at, new.acknowledged_by)
         is not distinct from (old.id, old.handover_id, old.source_id, old.run_id, old.gap_state, old.coverage_fingerprint, old.acknowledged_at, old.acknowledged_by) then
    return new; -- ON DELETE SET NULL of the job is allowed
  end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old; -- cascade from a deleted handover, source or run
  end if;
  raise exception 'publication_source_acknowledgements is append-only' using errcode = 'BTIT0';
end $$;

create trigger publication_source_acknowledgements_append_only
  before update or delete on public.publication_source_acknowledgements
  for each row execute function public._guard_publication_source_acknowledgements();

-- ── the gate ────────────────────────────────────────────────────────────────

create function public._assert_extraction_gaps_acknowledged(p_handover_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_missing int;
begin
  select count(*) into v_missing
    from public._extraction_publish_gaps(p_handover_id) g
   where not exists (select 1 from public.publication_source_acknowledgements a
                      where a.source_id = g.source_id and a.run_id = g.run_id and a.coverage_fingerprint = g.fingerprint);
  if v_missing > 0 then
    raise exception 'extraction_incomplete: % source(s) of the latest run were only partly analysed or failed and are not acknowledged', v_missing
      using errcode = 'BTPF0';
  end if;
end $$;

create function public._trg_publication_extraction_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._assert_extraction_gaps_acknowledged(new.handover_id);
  return new;
end $$;

create function public._trg_handover_approved_extraction_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._assert_extraction_gaps_acknowledged(new.id);
  return new;
end $$;

create trigger handover_publications_extraction_gate
  before insert on public.handover_publications
  for each row execute function public._trg_publication_extraction_gate();

create trigger handovers_approved_extraction_gate
  before update of state on public.handovers
  for each row
  when (new.state = 'approved' and old.state not in ('approved', 'acknowledged'))
  execute function public._trg_handover_approved_extraction_gate();

-- ── acknowledge + publish, in one transaction ───────────────────────────────

create function public.publish_handover(p_actor_profile_id uuid, p_handover_id uuid, p_summary text, p_acknowledgements jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_ack record;
  v_gap record;
  v_sources jsonb := '[]'::jsonb;
begin
  if p_acknowledgements is null or jsonb_typeof(p_acknowledgements) <> 'array' or jsonb_array_length(p_acknowledgements) > 500 then
    raise exception 'acknowledgements must be an array' using errcode = 'BTVF0';
  end if;
  v_h := public._lock_handover_for_update(p_handover_id); -- first lock, as publish_handover
  -- the same authority as publishing (checked here BEFORE anything is recorded)
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, p_handover_id) then
    raise exception 'only the creator can publish' using errcode = 'BTFB0';
  end if;
  if v_h.state <> 'in_review' then
    raise exception 'publish requires in_review' using errcode = 'BTIT0';
  end if;

  for v_ack in select * from jsonb_to_recordset(p_acknowledgements) as x("sourceId" uuid, fingerprint text) loop
    if v_ack."sourceId" is null or v_ack.fingerprint is null then
      raise exception 'each acknowledgement needs a sourceId and a fingerprint' using errcode = 'BTVF0';
    end if;
    select * into v_gap from public._extraction_publish_gaps(p_handover_id) g
     where g.source_id = v_ack."sourceId" and g.fingerprint = v_ack.fingerprint;
    if not found then
      raise exception 'the coverage of a source changed since it was reviewed' using errcode = 'BTCF0';
    end if;
    insert into public.publication_source_acknowledgements (handover_id, source_id, run_id, extract_job_id, gap_state,
                                                            chunks_done, chunks_total, coverage_fingerprint, acknowledged_by)
    values (p_handover_id, v_gap.source_id, v_gap.run_id, v_gap.job_id, v_gap.gap_state, v_gap.chunks_done, v_gap.chunks_total,
            v_gap.fingerprint, v_actor)
    on conflict on constraint publication_source_acknowledgements_once do nothing;
    v_sources := v_sources || jsonb_build_object('sourceId', v_gap.source_id, 'runId', v_gap.run_id, 'state', v_gap.gap_state,
                                                 'chunksDone', v_gap.chunks_done, 'chunksTotal', v_gap.chunks_total);
  end loop;
  if jsonb_array_length(v_sources) > 0 then
    perform public._audit(p_handover_id, v_actor, null, 'publication.extraction_gaps_acknowledged', 'handover', p_handover_id, null,
                          jsonb_build_object('sources', v_sources));
  end if;

  -- The unchanged publish; the triggers above verify every gap is acknowledged in THIS transaction.
  return public.publish_handover(p_actor_profile_id, p_handover_id, p_summary);
end $$;

-- ── the report exposes what the gate enforces (same signature, grants, SECURITY INVOKER) ─

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

  if v_run.id is null then
    return jsonb_build_object('available', true, 'runId', null, 'runStatus', null, 'sources', '[]'::jsonb, 'flags', v_flags);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'sourceId', s.id, 'title', s.title,
           'jobStatus', j.status, 'jobError', j.error_message,
           'chunksDone', coalesce(j.progress_done, 0), 'chunksTotal', coalesce(c.chunks_total, j.progress_total, 0),
           'coverageRecorded', c.run_id is not null,
           'messagesInspected', c.messages_inspected, 'messagesWithSignals', c.messages_with_signals,
           'oversizeSkipped', c.oversize_skipped, 'emptySkipped', c.empty_skipped,
           'signals', c.signals_total,
           'signalMessagesLinked', sg.linked, 'signalMessagesDismissed', sg.dismissed, 'signalMessagesUnreviewed', sg.unreviewed,
           'candidatesReturned', st.candidates, 'pointsCreated', st.inserted, 'pointsMerged', st.merged,
           'discarded', st.dropped,
           -- R3 Task 04: the database's own publish-gap view of this source
           'gapState', gp.state,
           'coverageFingerprint', case when gp.state in ('partial', 'failed') then gp.fingerprint end,
           'gapAcknowledged', gp.state in ('partial', 'failed')
                              and exists (select 1 from public.publication_source_acknowledgements a
                                           where a.source_id = s.id and a.run_id = v_run.id and a.coverage_fingerprint = gp.fingerprint)
         ) order by s.created_at, s.id), '[]'::jsonb)
    into v_sources
    from public.sources s -- RLS: review role and clearance
    left join lateral (
      select jb.id, jb.status, jb.error_message, jb.progress_done, jb.progress_total, jb.attempt
        from public.processing_jobs jb
       where jb.run_id = v_run.id and jb.source_id = s.id and jb.stage = 'extract'
       order by jb.created_at desc, jb.id desc limit 1) j on true
    cross join lateral (
      select public.extraction_gap_state(j.id is not null, j.status, coalesce(j.progress_done, 0), coalesce(j.progress_total, 0)) as state,
             public.extraction_coverage_fingerprint(v_run.id, j.id, j.status, coalesce(j.progress_done, 0), coalesce(j.progress_total, 0),
                                                    j.attempt, j.error_message) as fingerprint) gp
    left join public.extraction_source_coverage c on c.run_id = v_run.id and c.source_id = s.id
    left join lateral (
      select coalesce(sum(x.candidates), 0)::int as candidates, coalesce(sum(x.inserted), 0)::int as inserted,
             coalesce(sum(x.merged), 0)::int as merged,
             coalesce((select jsonb_object_agg(d.key, d.total)
                         from (select e.key, sum((e.value)::numeric)::int as total
                                 from public.extraction_chunk_stats y, jsonb_each(y.dropped) e
                                where y.run_id = v_run.id and y.source_id = s.id
                                group by e.key) d), '{}'::jsonb) as dropped
        from public.extraction_chunk_stats x
       where x.run_id = v_run.id and x.source_id = s.id) st on true
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
   where s.id = any (v_run.source_ids);

  return jsonb_build_object('available', true, 'runId', v_run.id, 'runStatus', v_run.status, 'sources', v_sources, 'flags', v_flags);
end $$;

-- ── grants ────────────────────────────────────────────────────────────────────

grant select on public.publication_source_acknowledgements to authenticated, service_role;
-- no INSERT/UPDATE/DELETE for any API role: acknowledgements are written only by publish_handover (4 arguments)

revoke execute on function
  public._extraction_publish_gaps(uuid), public._assert_extraction_gaps_acknowledged(uuid),
  public._trg_publication_extraction_gate(), public._trg_handover_approved_extraction_gate(),
  public._guard_publication_source_acknowledgements(),
  public.publish_handover(uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_handover(uuid, uuid, text, jsonb) to service_role;

-- pure, table-free helpers used by the SECURITY INVOKER report
revoke execute on function public.extraction_gap_state(boolean, text, int, int),
  public.extraction_coverage_fingerprint(uuid, uuid, text, int, int, int, text) from public, anon;
grant execute on function public.extraction_gap_state(boolean, text, int, int),
  public.extraction_coverage_fingerprint(uuid, uuid, text, int, int, int, text) to authenticated, service_role;
