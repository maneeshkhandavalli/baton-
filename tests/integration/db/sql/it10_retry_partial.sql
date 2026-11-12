-- IT-10 (database part): retry, partial failure and run outcome (§9.1, §9.3, QA-M3/M4/M5, QA-L8).
--   * stage ordering never costs an attempt (M5); retries back off and stop at max_attempts;
--   * one source failing does not block the other; per-handover stages wait for every source;
--   * stale or cancelled claims cannot complete or heartbeat (M4); expired last leases are reaped (M3);
--   * a failed run returns the handover to draft, or to in_review keeping earlier points.
\set ON_ERROR_STOP 1

select tests.user('ann');
select tests.handover('h', 'ann', 'outgoing');
select it.raw_source('h', 'sa');
select it.raw_source('h', 'sb');

select tests.as_user('ann');
select tests.put('run', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}', (
  select jsonb_agg(jsonb_build_object('stage', st, 'sourceId', src, 'inputHash', md5(st || coalesce(src::text, 'h'))))
    from (values ('parse', tests.id('sa')), ('parse', tests.id('sb')), ('extract', tests.id('sa')), ('extract', tests.id('sb')),
                 ('verify_quotes', tests.id('sa')), ('verify_quotes', tests.id('sb')), ('verify_support', null::uuid),
                 ('analyze', null::uuid), ('prepare_review', null::uuid)) v (st, src))));
select tests.as_owner();
select tests.put(stage || coalesce('_' || case source_id when tests.id('sa') then 'a' when tests.id('sb') then 'b' end, ''), id)
  from public.processing_jobs where run_id = tests.id('run');

create function pg_temp.job(p text) returns public.processing_jobs language sql as $$
  select * from public.processing_jobs where id = tests.id(p)
$$;

-- ── M5: only parse is ready; waiting jobs keep attempt 0 ─────────────────────
select tests.as_service();
create temp table c1 as select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select array_agg(stage order by stage) from c1), array['parse', 'parse'], 'only the parse jobs are claimable first');
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(10, 300)), 0, 'nothing else is ready');
select tests.eq((select max(attempt) from public.processing_jobs where run_id = tests.id('run') and stage <> 'parse'), 0,
                'claims that found nothing ready consumed no attempt (M5)');

-- ── retry with backoff until max_attempts (parse of source a) ────────────────
do $$
declare
  v_attempt int;
  v_status text;
  v_claim int;
begin
  perform tests.as_service();
  for v_attempt in 1..3 loop
    perform tests.eq((pg_temp.job('parse_a')).attempt, v_attempt, 'attempt ' || v_attempt || ' is the current claim');
    v_status := public.complete_processing_job(tests.id('parse_a'), v_attempt, 'retry',
                  jsonb_build_object('attempt', v_attempt, 'outcome', 'timed_out', 'errorCode', 'processing_failed'),
                  'processing_failed', 'provider_timeout', now() + interval '30 seconds');
    if v_attempt < 3 then
      perform tests.eq(v_status, 'queued', 'retry ' || v_attempt || ' re-queues');
      perform tests.ok((pg_temp.job('parse_a')).next_attempt_at > now(), 'backoff is respected');
      select count(*) into v_claim from public.claim_ready_processing_jobs(10, 300) c where c.id = tests.id('parse_a');
      perform tests.eq(v_claim, 0, 'not claimable before its backoff');
      perform tests.as_owner();
      update public.processing_jobs set next_attempt_at = now() - interval '1 second' where id = tests.id('parse_a');
      perform tests.as_service();
      select count(*) into v_claim from public.claim_ready_processing_jobs(10, 300) c where c.id = tests.id('parse_a');
      perform tests.eq(v_claim, 1, 'claimable again after its backoff');
    else
      perform tests.eq(v_status, 'failed', 'the last retry fails the job');
    end if;
  end loop;
  perform tests.eq(jsonb_array_length((pg_temp.job('parse_a')).attempt_log), 3, 'one attempt record per attempt');
  perform tests.eq((pg_temp.job('parse_a')).error_message, 'provider_timeout', 'only the reason token is kept');
end $$;

-- ── M4 fencing ───────────────────────────────────────────────────────────────
select tests.throws(format('select public.complete_processing_job(%L, 1, %L)', tests.id('parse_a'), 'succeeded'), 'BTCF0',
                    'a stale attempt cannot complete a failed job');
select tests.throws(format('select public.complete_processing_job(%L, 3, %L)', tests.id('parse_a'), 'succeeded'), 'BTCF0',
                    'a finished job cannot be revived');
select tests.eq(public.heartbeat_processing_job(tests.id('parse_b'), 2, 300), 'lost', 'heartbeat with another attempt is lost');
select tests.throws(format('select public.complete_processing_job(%L, 1, %L, null, %L, %L)', tests.id('parse_b'), 'failed',
                           'parse_failed', 'Asha Rao 99999 00004'), 'BTVF0', 'error messages are reason tokens, never content');
select tests.throws(format($q$select public.complete_processing_job(%L, 1, 'failed', '"text"', 'parse_failed')$q$, tests.id('parse_b')),
                    'BTVF0', 'attempt records are objects');

-- ── partial failure: source b continues, per-handover stages wait ────────────
select tests.eq(public.complete_processing_job(tests.id('parse_b'), 1, 'succeeded'), 'succeeded', 'parse b succeeded');
do $$
declare
  v_job public.processing_jobs;
  v_order text[] := '{}';
  v_guard int := 0;
begin
  perform tests.as_service();
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 20;
    select * into v_job from public.claim_ready_processing_jobs(1, 300) limit 1;
    exit when v_job.id is null;
    -- a claimed job never has an unfinished earlier-stage job of its source, or any if it is per-handover
    perform tests.ok(not exists (
      select 1 from public.processing_jobs d
       where d.run_id = v_job.run_id and d.id <> v_job.id
         and array_position(array['parse', 'extract', 'verify_quotes', 'verify_support', 'analyze', 'prepare_review'], d.stage)
           < array_position(array['parse', 'extract', 'verify_quotes', 'verify_support', 'analyze', 'prepare_review'], v_job.stage)
         and (d.source_id is not distinct from v_job.source_id or d.source_id is null or v_job.source_id is null)
         and d.status not in ('succeeded', 'failed', 'cancelled')), 'claimed ' || v_job.stage || ' only after its predecessors');
    v_order := v_order || (v_job.stage || coalesce(':' || case v_job.source_id when tests.id('sa') then 'a' when tests.id('sb') then 'b' end, ''));
    -- the worker skips work downstream of the failed parse, and succeeds the rest
    perform public.complete_processing_job(v_job.id, v_job.attempt,
              case when v_job.source_id = tests.id('sa') then 'skipped' else 'succeeded' end);
  end loop;
  perform tests.eq(v_order[array_length(v_order, 1) - 2:], array['verify_support', 'analyze', 'prepare_review'],
                   'per-handover stages run last and in order');
  perform tests.ok('extract:b' = any (v_order) and 'verify_quotes:b' = any (v_order), 'source b was processed despite a failing');
  perform tests.eq((select count(*)::int from public.processing_jobs where run_id = tests.id('run') and status not in ('succeeded', 'failed', 'cancelled')),
                   0, 'every job is terminal');
  perform tests.eq((pg_temp.job('extract_a')).error_message, 'upstream_failed', 'skipped jobs carry only a reason token');
end $$;

-- the failed parse keeps the raw upload for a retry (§9.3, §10.3 step 5)
select public.mark_source_parse_failed(tests.id('sa'), 'parse_failed');
select tests.as_owner();
select tests.eq((select state from public.sources where id = tests.id('sa')), 'failed', 'source a failed');
select tests.ok((select raw_storage_path is not null and raw_deleted_at is null from public.sources where id = tests.id('sa')),
                'its raw upload is kept');

-- run outcome with no prior success → draft (§9.1)
select tests.as_service();
select public.finish_processing_run(tests.id('run'), 'failed', 'processing_failed', 'all_extracts_failed');
select tests.as_owner();
select tests.eq((select state from public.handovers where id = tests.id('h')), 'draft', 'a failed first run returns to draft');
select tests.eq((select last_error_message from public.handovers where id = tests.id('h')), 'all_extracts_failed', 'reason token only');

-- a retry is a NEW run; the failed source with its raw upload is included again
select tests.as_user('ann');
select tests.put('run2', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'parse', 'sourceId', tests.id('sa'), 'inputHash', md5('retry-a')))));
select tests.as_owner();
select tests.ok((select tests.id('sa') = any (source_ids) from public.processing_runs where id = tests.id('run2')), 'failed source re-included');

-- ── cancellation fences the in-flight claim (M4) ─────────────────────────────
select tests.as_service();
select tests.put('j2', (select id from public.claim_ready_processing_jobs(5, 300) limit 1));
select tests.as_user('ann');
select public.cancel_processing(tests.actor(), tests.id('h'));
select tests.as_service();
select tests.throws(format('select public.complete_processing_job(%L, 1, %L)', tests.id('j2'), 'succeeded'), 'BTCF0',
                    'a cancelled job cannot be completed by the worker that held it');
select tests.eq(public.heartbeat_processing_job(tests.id('j2'), 1, 300), 'lost', 'its heartbeat reports the lease lost');
select tests.as_owner();
select tests.eq((select status from public.processing_jobs where id = tests.id('j2')), 'cancelled', 'still cancelled');

-- ── a failed run after a successful one keeps the earlier points (§9.1, §9.3) ─
select tests.handover('h2', 'ann', 'outgoing');
select tests.source('h2', 'sp');
select tests.as_user('ann');
select tests.put('ra', public.start_processing(tests.actor(), tests.id('h2'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sp'), 'inputHash', md5('same')))));
select tests.as_owner(); -- DB-12-LEGACY: unfenced writer, owner-only since 20261113300500
select tests.put('pa', public.insert_extracted_point(tests.id('h2'), tests.id('ra'), 'decision', 'Kept', 'Kept statement', '{}', null,
                                                     'everyone', '{"provider":"fake"}'));
select tests.as_service();
select tests.put('ja', (select id from public.claim_ready_processing_jobs(5, 300) limit 1));
select public.complete_processing_job(tests.id('ja'), 1, 'succeeded');
select public.finish_processing_run(tests.id('ra'), 'succeeded');
select tests.as_owner();
select tests.eq((select state from public.handovers where id = tests.id('h2')), 'in_review', 'successful run → in_review');

select tests.as_user('ann');
select tests.put('rb', public.start_processing(tests.actor(), tests.id('h2'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sp'), 'inputHash', md5('same')))));
select tests.as_service();
select tests.put('jb', (select id from public.processing_jobs where run_id = tests.id('rb')));
select tests.eq(public.get_processing_job_context(tests.id('jb')) ->> 'priorSucceeded', 'true',
                'idempotency: the same stage, source and input hash already succeeded in an earlier run');

-- QA-L8 (fixed in 20261112000400): finish_processing_run accepts ERROR_CODES and reason tokens only, because
-- the message is copied to handovers.last_error_message, which every member can read.
select tests.as_service();
select tests.throws(format('select public.finish_processing_run(%L, %L, %L, %L)', tests.id('rb'), 'failed', 'processing_failed',
                           'Asha Rao said the PIN is 4321'), 'BTVF0', 'QA-L8: free-text run error messages are refused');
select tests.throws(format('select public.finish_processing_run(%L, %L, %L, %L)', tests.id('rb'), 'failed', 'provider said 500',
                           'stage_exhausted'), 'BTVF0', 'QA-L8: error codes must be ERROR_CODES');
select tests.eq((select status from public.processing_runs where id = tests.id('rb')), 'queued', 'the refused calls changed nothing');
select public.finish_processing_run(tests.id('rb'), 'failed', 'processing_failed', 'all_extracts_failed');
select tests.as_owner();
select tests.eq((select last_error_message from public.handovers where id = tests.id('h2')), 'all_extracts_failed',
                'members only ever see the reason token');
select tests.as_owner();
select tests.eq((select state from public.handovers where id = tests.id('h2')), 'in_review', 'a failed later run returns to in_review');
select tests.ok((select erased_at is null and review_state = 'pending' from public.handover_points where id = tests.id('pa')),
                'points from the earlier successful run are untouched');
select tests.eq((select count(*)::int from public.point_revisions where point_id = tests.id('pa')), 1, 'no revision was added');
select tests.ok(not exists (select 1 from public.handover_points where handover_id = tests.id('h2') and review_state = 'approved'),
                'nothing was approved by the pipeline');
select tests.eq((select count(*)::int from public.handover_publications where handover_id = tests.id('h2')), 0, 'nothing was published');

-- ── M3: a lease that expired on the last attempt is reaped, the run can close ─
select tests.as_user('ann');
select tests.put('rc', public.start_processing(tests.actor(), tests.id('h2'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'analyze', 'sourceId', null, 'inputHash', md5('reap')))));
select tests.as_owner();
update public.processing_jobs set status = 'running', attempt = max_attempts, lease_expires_at = now() - interval '1 second'
 where run_id = tests.id('rc');
select tests.as_service();
select count(*) from public.claim_ready_processing_jobs(5, 300);
select tests.eq((select status || ':' || error_message from public.processing_jobs where run_id = tests.id('rc')), 'failed:lease_expired',
                'the reaper fails the abandoned job');
select public.finish_processing_run(tests.id('rc'), 'failed', 'processing_failed', 'stage_exhausted');
select tests.as_owner();
select tests.eq((select state from public.handovers where id = tests.id('h2')), 'in_review', 'the handover is not stuck in processing');
