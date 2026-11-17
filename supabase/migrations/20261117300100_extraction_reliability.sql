-- Round 3 Task 03 (EXT-1, EXT-2, EXT-3, VER-2, VER-3): deterministic signals, extraction coverage and
-- point review flags. ADDITIVE ONLY: four new tables, new functions, explicit grants. No existing table,
-- column, function, policy or grant is changed. REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- What it stores (counts, offsets and reason tokens; never a copy of message text):
--   extraction_signals          deterministic "this message looks like handover material" spans
--                               (lib/signals/detect.ts), keyed by message + UTF-16 offsets into the stored
--                               (masked, pseudonymised) body. A signal is never a point or evidence.
--   extraction_source_coverage  per run and source: messages inspected, signal-bearing messages, oversize
--                               and empty skips, chunk total, detector version.
--   extraction_chunk_stats      per run, source and chunk: candidates returned, inserted, merged, and
--                               discards by reason (model-output checks, identity guard, unsupported).
--   point_review_flags          per point revision: possible contradictions (a LATER message that may
--                               change the picture) and person fields that are inferred or unresolved.
--                               Flags never change a point's status, evidence or verdicts.
--
-- Writers are fenced exactly like the other pipeline writers (DB-12: _pipeline_claim, optional claim
-- generation) and granted to service_role only. Readers are SECURITY INVOKER under RLS: a signal or a
-- coverage row is visible with its source (source_visible), a flag with its point (point_visible).
-- Reviewer mutations take the verified actor and re-check role and clearance (H1).
--
-- Worker compatibility: the worker treats a missing writer as "coverage unavailable" and keeps processing
-- (lib/pipeline/coverage.ts), so a database without this migration still processes normally.

-- ── tables ───────────────────────────────────────────────────────────────────

create table public.extraction_signals (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  source_id uuid not null,
  source_message_id uuid not null,
  detector_version text not null check (detector_version ~ '^[a-z0-9_.@-]{1,32}$'),
  kind text not null check (kind in ('deadline', 'date', 'financial_commitment', 'amount', 'assignment', 'ownership', 'decision',
                                     'reversal', 'commitment', 'dependency', 'open_question', 'person_mention', 'url',
                                     'account_identifier')),
  strength text not null check (strength in ('strong', 'weak')),
  span_start int not null check (span_start >= 0),
  span_end int not null,
  value text check (value is null or char_length(value) <= 64),
  review_state text not null default 'unreviewed' check (review_state in ('unreviewed', 'dismissed')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint extraction_signals_span_check check (span_end > span_start and span_end - span_start <= 4000),
  constraint extraction_signals_source_fk foreign key (handover_id, source_id)
    references public.sources (handover_id, id) on delete cascade,
  -- an erased or pruned message takes its signals with it
  constraint extraction_signals_message_fk foreign key (handover_id, source_message_id)
    references public.source_messages (handover_id, id) on delete cascade,
  constraint extraction_signals_unique unique (source_message_id, detector_version, kind, span_start, span_end)
);
create index extraction_signals_source_idx on public.extraction_signals (source_id, detector_version);

create table public.extraction_source_coverage (
  run_id uuid not null references public.processing_runs (id) on delete cascade,
  handover_id uuid not null references public.handovers (id) on delete cascade,
  source_id uuid not null,
  detector_version text not null check (detector_version ~ '^[a-z0-9_.@-]{1,32}$'),
  messages_inspected int not null check (messages_inspected >= 0),
  messages_with_signals int not null check (messages_with_signals >= 0),
  signals_total int not null check (signals_total >= 0),
  oversize_skipped int not null check (oversize_skipped >= 0),
  empty_skipped int not null check (empty_skipped >= 0),
  chunks_total int not null check (chunks_total >= 0),
  updated_at timestamptz not null default now(),
  primary key (run_id, source_id),
  constraint extraction_source_coverage_source_fk foreign key (handover_id, source_id)
    references public.sources (handover_id, id) on delete cascade
);

create table public.extraction_chunk_stats (
  run_id uuid not null references public.processing_runs (id) on delete cascade,
  handover_id uuid not null references public.handovers (id) on delete cascade,
  source_id uuid not null,
  chunk_index int not null check (chunk_index >= 0),
  chunk_total int not null check (chunk_total > chunk_index),
  messages int not null check (messages >= 0),
  candidates int not null check (candidates >= 0),
  inserted int not null check (inserted >= 0),
  merged int not null check (merged >= 0),
  -- counts by reason token, e.g. {"fabricated": 1, "identity_dropped": 2, "unsupported": 1}
  dropped jsonb not null default '{}'::jsonb check (jsonb_typeof(dropped) = 'object'),
  recorded_at timestamptz not null default now(),
  primary key (run_id, source_id, chunk_index),
  constraint extraction_chunk_stats_source_fk foreign key (handover_id, source_id)
    references public.sources (handover_id, id) on delete cascade
);

create table public.point_review_flags (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  point_id uuid not null,
  revision_id uuid not null,
  run_id uuid references public.processing_runs (id) on delete set null,
  kind text not null check (kind in ('possible_contradiction', 'attribution_unresolved', 'attribution_inferred')),
  source_message_id uuid,
  -- reason tokens / field names only, never text
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 128),
  state text not null default 'open' check (state in ('open', 'dismissed', 'confirmed')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint point_review_flags_point_fk foreign key (handover_id, point_id)
    references public.handover_points (handover_id, id) on delete cascade,
  constraint point_review_flags_message_fk foreign key (handover_id, source_message_id)
    references public.source_messages (handover_id, id) on delete cascade,
  constraint point_review_flags_unique unique (point_id, revision_id, kind, dedupe_key),
  constraint point_review_flags_message_kind check ((kind = 'possible_contradiction') = (source_message_id is not null))
);
create index point_review_flags_handover_idx on public.point_review_flags (handover_id, state);

alter table public.extraction_signals enable row level security;
alter table public.extraction_source_coverage enable row level security;
alter table public.extraction_chunk_stats enable row level security;
alter table public.point_review_flags enable row level security;

create policy extraction_signals_select on public.extraction_signals
  for select to authenticated using (public.source_visible(source_id));
create policy extraction_source_coverage_select on public.extraction_source_coverage
  for select to authenticated using (public.source_visible(source_id));
create policy extraction_chunk_stats_select on public.extraction_chunk_stats
  for select to authenticated using (public.source_visible(source_id));
create policy point_review_flags_select on public.point_review_flags
  for select to authenticated using (public.point_visible(point_id));

-- ── fenced worker writers (DB-12) ────────────────────────────────────────────

-- extract job only: the scan of its own source. Coverage is upserted (the scan is deterministic, so a
-- retry writes the same numbers); signals are inserted once and never rewritten, so a reviewer's
-- dismissal survives re-runs. Signals for messages outside the job's source are refused.
create function public.pipeline_store_source_signals(
  p_job_id uuid, p_attempt int, p_coverage jsonb, p_signals jsonb, p_claim_generation bigint default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_version text := p_coverage ->> 'detectorVersion';
  v_bad int;
  v_inserted int;
begin
  if p_claim_generation is not null then
    perform public._pipeline_use_generation(p_claim_generation);
  end if;
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['extract']);
  perform set_config('baton.claim_generation', '', true);
  if v_job.source_id is null or jsonb_typeof(p_coverage) <> 'object' or jsonb_typeof(coalesce(p_signals, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid signal payload' using errcode = 'BTVF0';
  end if;
  if jsonb_array_length(coalesce(p_signals, '[]'::jsonb)) > 5000 then
    raise exception 'too many signals in one call' using errcode = 'BTVF0';
  end if;

  insert into public.extraction_source_coverage as c (run_id, handover_id, source_id, detector_version, messages_inspected,
                                                      messages_with_signals, signals_total, oversize_skipped, empty_skipped, chunks_total)
  values (v_job.run_id, v_job.handover_id, v_job.source_id, v_version,
          (p_coverage ->> 'messagesInspected')::int, (p_coverage ->> 'messagesWithSignals')::int,
          (p_coverage ->> 'signals')::int, (p_coverage ->> 'oversizeSkipped')::int,
          (p_coverage ->> 'emptySkipped')::int, (p_coverage ->> 'chunksTotal')::int)
  on conflict (run_id, source_id) do update
     set detector_version = excluded.detector_version, messages_inspected = excluded.messages_inspected,
         messages_with_signals = excluded.messages_with_signals, signals_total = excluded.signals_total,
         oversize_skipped = excluded.oversize_skipped, empty_skipped = excluded.empty_skipped,
         chunks_total = excluded.chunks_total, updated_at = now();

  -- every signal must name a message of THIS job's source
  select count(*) into v_bad
    from jsonb_to_recordset(coalesce(p_signals, '[]'::jsonb)) as x("messageId" uuid)
   where not exists (select 1 from public.source_messages m
                      where m.id = x."messageId" and m.source_id = v_job.source_id and m.handover_id = v_job.handover_id);
  if v_bad > 0 then
    raise exception 'a signal names a message outside the job''s source' using errcode = 'BTFB0';
  end if;

  insert into public.extraction_signals (handover_id, source_id, source_message_id, detector_version, kind, strength,
                                         span_start, span_end, value)
  select v_job.handover_id, v_job.source_id, x."messageId", v_version, x.kind, x.strength, x.start, x."end", x.value
    from jsonb_to_recordset(coalesce(p_signals, '[]'::jsonb))
         as x("messageId" uuid, kind text, strength text, start int, "end" int, value text)
  on conflict on constraint extraction_signals_unique do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

-- extract job only: one chunk's counts (upsert by chunk index, so a retried chunk replaces its row).
create function public.pipeline_record_extract_chunk_stats(
  p_job_id uuid, p_attempt int, p_chunk_index int, p_stats jsonb, p_claim_generation bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_dropped jsonb := coalesce(p_stats -> 'dropped', '{}'::jsonb);
begin
  if p_claim_generation is not null then
    perform public._pipeline_use_generation(p_claim_generation);
  end if;
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['extract']);
  perform set_config('baton.claim_generation', '', true);
  if v_job.source_id is null or jsonb_typeof(p_stats) <> 'object' or jsonb_typeof(v_dropped) <> 'object' then
    raise exception 'invalid chunk stats' using errcode = 'BTVF0';
  end if;
  -- reason tokens and non-negative integer counts only
  if exists (select 1 from jsonb_each(v_dropped) d
              where d.key !~ '^[a-z0-9_]{1,64}$' or jsonb_typeof(d.value) <> 'number' or (d.value)::numeric < 0
                 or (d.value)::numeric <> trunc((d.value)::numeric)) then
    raise exception 'invalid discard counts' using errcode = 'BTVF0';
  end if;
  insert into public.extraction_chunk_stats as s (run_id, handover_id, source_id, chunk_index, chunk_total, messages, candidates,
                                                  inserted, merged, dropped)
  values (v_job.run_id, v_job.handover_id, v_job.source_id, p_chunk_index, (p_stats ->> 'chunkTotal')::int,
          (p_stats ->> 'messages')::int, (p_stats ->> 'candidates')::int, (p_stats ->> 'inserted')::int,
          (p_stats ->> 'merged')::int, v_dropped)
  on conflict (run_id, source_id, chunk_index) do update
     set chunk_total = excluded.chunk_total, messages = excluded.messages, candidates = excluded.candidates,
         inserted = excluded.inserted, merged = excluded.merged, dropped = excluded.dropped, recorded_at = now();
end $$;

-- analyze job only: review flags for the CURRENT revision of points in the job's handover. Existing flags
-- (and their review state) are never rewritten.
create function public.pipeline_store_point_flags(p_job_id uuid, p_attempt int, p_flags jsonb, p_claim_generation bigint default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_bad int;
  v_inserted int;
begin
  if p_claim_generation is not null then
    perform public._pipeline_use_generation(p_claim_generation);
  end if;
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['analyze']);
  perform set_config('baton.claim_generation', '', true);
  if jsonb_typeof(coalesce(p_flags, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_flags, '[]'::jsonb)) > 5000 then
    raise exception 'invalid flags' using errcode = 'BTVF0';
  end if;

  select count(*) into v_bad
    from jsonb_to_recordset(coalesce(p_flags, '[]'::jsonb)) as x("pointId" uuid, "revisionId" uuid, "messageId" uuid, detail jsonb)
   where not exists (select 1 from public.handover_points p
                      where p.id = x."pointId" and p.handover_id = v_job.handover_id and p.erased_at is null
                        and p.current_revision_id = x."revisionId")
      or (x."messageId" is not null
          and not exists (select 1 from public.source_messages m where m.id = x."messageId" and m.handover_id = v_job.handover_id))
      or jsonb_typeof(coalesce(x.detail, '{}'::jsonb)) <> 'object';
  if v_bad > 0 then
    raise exception 'a flag names a point or message outside the job''s handover, or a stale revision' using errcode = 'BTFB0';
  end if;

  insert into public.point_review_flags (handover_id, point_id, revision_id, run_id, kind, source_message_id, detail, dedupe_key)
  select v_job.handover_id, x."pointId", x."revisionId", v_job.run_id, x.kind, x."messageId", coalesce(x.detail, '{}'::jsonb),
         x."dedupeKey"
    from jsonb_to_recordset(coalesce(p_flags, '[]'::jsonb))
         as x("pointId" uuid, "revisionId" uuid, kind text, "messageId" uuid, detail jsonb, "dedupeKey" text)
  on conflict on constraint point_review_flags_unique do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

-- Service reads for the analyze job: every text message of the handover's included sources is already
-- readable through list_extraction_messages (DB-5); nothing new is needed here.

-- ── reviewer mutations (server-only, verified actor; H1) ─────────────────────

-- Marks every signal of one message as dismissed ("not handover material") or back to unreviewed.
create function public.review_extraction_signals(p_actor_profile_id uuid, p_handover_id uuid, p_message_id uuid, p_state text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_source uuid;
  v_level text;
  v_n int;
begin
  if p_state is null or p_state not in ('unreviewed', 'dismissed') then
    raise exception 'state must be unreviewed or dismissed' using errcode = 'BTVF0';
  end if;
  perform public._lock_handover_for_share(p_handover_id);
  select m.source_id, s.access_level into v_source, v_level
    from public.source_messages m join public.sources s on s.id = m.source_id
   where m.id = p_message_id and m.handover_id = p_handover_id;
  if v_source is null or not public._is_review_role_as(v_actor, p_handover_id)
     or not public._within_clearance_as(v_actor, p_handover_id, v_level) then
    raise exception 'message not found' using errcode = 'BTNF0';
  end if;
  update public.extraction_signals
     set review_state = p_state,
         reviewed_by = case when p_state = 'dismissed' then v_actor end,
         reviewed_at = case when p_state = 'dismissed' then now() end
   where source_message_id = p_message_id and handover_id = p_handover_id and review_state <> p_state;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public._audit(p_handover_id, v_actor, null, 'signals.reviewed', 'source_message', p_message_id, null,
                          jsonb_build_object('state', p_state, 'signals', v_n));
  end if;
  return v_n;
end $$;

-- Dismisses or confirms one review flag (a reviewer looked at it), or reopens it.
create function public.review_point_flag(p_actor_profile_id uuid, p_flag_id uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_flag public.point_review_flags;
begin
  if p_state is null or p_state not in ('open', 'dismissed', 'confirmed') then
    raise exception 'state must be open, dismissed or confirmed' using errcode = 'BTVF0';
  end if;
  select * into v_flag from public.point_review_flags where id = p_flag_id;
  if v_flag.id is null then
    raise exception 'flag not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_flag.handover_id);
  if not public._point_visible_as(v_actor, v_flag.point_id) then
    raise exception 'flag not found' using errcode = 'BTNF0';
  end if;
  update public.point_review_flags
     set state = p_state,
         reviewed_by = case when p_state = 'open' then null else v_actor end,
         reviewed_at = case when p_state = 'open' then null else now() end
   where id = p_flag_id;
  perform public._audit(v_flag.handover_id, v_actor, null, 'point_flag.reviewed', 'point_review_flag', p_flag_id, null,
                        jsonb_build_object('kind', v_flag.kind, 'state', p_state, 'pointId', v_flag.point_id));
end $$;

-- ── user-scoped readers (SECURITY INVOKER, RLS) ──────────────────────────────

-- Coverage of the latest run, per source the caller may see. Counts only; NULL for non-reviewers.
create function public.api_get_extraction_report(p_handover_id uuid)
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
           'discarded', st.dropped
         ) order by s.created_at, s.id), '[]'::jsonb)
    into v_sources
    from public.sources s -- RLS: review role and clearance
    left join lateral (
      select jb.status, jb.error_message, jb.progress_done, jb.progress_total
        from public.processing_jobs jb
       where jb.run_id = v_run.id and jb.source_id = s.id and jb.stage = 'extract'
       order by jb.created_at desc limit 1) j on true
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

-- Signal-bearing messages nobody has reviewed: not cited by a live point and not dismissed. Strongest and
-- newest first. The body is the stored masked, pseudonymised text (visible under source RLS).
create function public.api_list_unreviewed_signals(p_handover_id uuid, p_limit int default 50)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'sourceId', t.source_id, 'messageId', t.id, 'sentAt', t.sent_at, 'authorLabel', t.author_label, 'body', t.body,
           'signals', t.signals) order by t.strong desc, t.sent_at desc nulls last, t.id), '[]'::jsonb)
    from (
      select m.id, m.source_id, m.sent_at, sp.display_label as author_label, m.body,
             count(*) filter (where es.strength = 'strong') as strong,
             jsonb_agg(jsonb_build_object('kind', es.kind, 'strength', es.strength, 'start', es.span_start, 'end', es.span_end)
                       order by es.span_start, es.kind) as signals
        from public.extraction_signals es
        join public.source_messages m on m.id = es.source_message_id
        left join public.source_participants sp on sp.id = m.participant_id
       where es.handover_id = p_handover_id and es.review_state = 'unreviewed'
         and public.is_review_role(p_handover_id)
         and not exists (select 1 from public.evidence_quotes q
                           join public.point_evidence pe on pe.evidence_id = q.id and pe.excluded_at is null
                           join public.handover_points hp on hp.id = pe.point_id and hp.erased_at is null
                                                         and hp.review_state <> 'rejected'
                          where q.source_message_id = m.id)
       group by m.id, m.source_id, m.sent_at, sp.display_label, m.body
       order by count(*) filter (where es.strength = 'strong') desc, m.sent_at desc nulls last, m.id
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) t
$$;

-- Review flags on the current revision of every point the caller may see (open first).
create function public.api_list_point_flags(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'pointId', f.point_id, 'kind', f.kind, 'state', f.state, 'sourceMessageId', f.source_message_id,
           'detail', f.detail, 'messageExcerpt', left(m.body, 500), 'messageSentAt', m.sent_at)
         order by (f.state = 'open') desc, f.created_at, f.id), '[]'::jsonb)
    from public.point_review_flags f -- RLS: point_visible
    join public.handover_points p on p.id = f.point_id and p.current_revision_id = f.revision_id and p.erased_at is null
    left join public.source_messages m on m.id = f.source_message_id -- RLS: source_visible (null when hidden)
   where f.handover_id = p_handover_id
$$;

-- ── grants ───────────────────────────────────────────────────────────────────

grant select on public.extraction_signals, public.extraction_source_coverage, public.extraction_chunk_stats,
                public.point_review_flags to authenticated, service_role;

revoke execute on function
  public.pipeline_store_source_signals(uuid, int, jsonb, jsonb, bigint),
  public.pipeline_record_extract_chunk_stats(uuid, int, int, jsonb, bigint),
  public.pipeline_store_point_flags(uuid, int, jsonb, bigint),
  public.review_extraction_signals(uuid, uuid, uuid, text),
  public.review_point_flag(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.pipeline_store_source_signals(uuid, int, jsonb, jsonb, bigint),
  public.pipeline_record_extract_chunk_stats(uuid, int, int, jsonb, bigint),
  public.pipeline_store_point_flags(uuid, int, jsonb, bigint),
  public.review_extraction_signals(uuid, uuid, uuid, text),
  public.review_point_flag(uuid, uuid, text)
  to service_role;

revoke execute on function
  public.api_get_extraction_report(uuid), public.api_list_unreviewed_signals(uuid, int), public.api_list_point_flags(uuid)
  from public, anon;
grant execute on function
  public.api_get_extraction_report(uuid), public.api_list_unreviewed_signals(uuid, int), public.api_list_point_flags(uuid)
  to authenticated, service_role;
