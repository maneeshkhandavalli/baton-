-- IT-20 (Round 3 Task 01B): global worker slots and the scheduler's work-due gate
-- (migration 20261117100100_pipeline_worker_slots.sql).
--   * only service_role may use the slot functions and the gate; nobody reads the slot table directly;
--   * acquisition is atomic and never waits: a slot being taken in another open transaction is skipped;
--   * an expired slot is recovered by the next acquisition; the stale holder can neither renew nor release it;
--   * pipeline_work_due() is true exactly when a drain has something to do: a due job (same predicate as
--     claim_ready_processing_jobs), an expired lease, or a run that can be finalised now; it is false for a
--     run that is only waiting (live lease, retry backoff).
\set ON_ERROR_STOP 1

-- ── privileges ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  r text;
  f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach f in array array['public.acquire_pipeline_worker_slot(int,int,text)', 'public.renew_pipeline_worker_slot(int,uuid,int)',
                             'public.release_pipeline_worker_slot(int,uuid)', 'public.pipeline_work_due()'] loop
      perform tests.ok(not has_function_privilege(r, f, 'EXECUTE'), r || ' cannot execute ' || f);
    end loop;
    perform tests.ok(not has_table_privilege(r, 'public.pipeline_worker_slots', 'SELECT'), r || ' cannot read the slot table');
  end loop;
  perform tests.ok(has_function_privilege('service_role', 'public.acquire_pipeline_worker_slot(int,int,text)', 'EXECUTE'), 'service_role acquires');
  perform tests.ok(has_function_privilege('service_role', 'public.pipeline_work_due()', 'EXECUTE'), 'service_role reads the gate');
  perform tests.ok(not has_table_privilege('service_role', 'public.pipeline_worker_slots', 'SELECT'), 'service_role only through the functions');
end $$;

-- ── parameters ─────────────────────────────────────────────────────────────────────────────────────────
select tests.as_service();
select tests.throws($q$select public.acquire_pipeline_worker_slot(0, 300, 'pg_cron')$q$, 'BTVF0', 'max slots below 1');
select tests.throws($q$select public.acquire_pipeline_worker_slot(17, 300, 'pg_cron')$q$, 'BTVF0', 'max slots above 16');
select tests.throws($q$select public.acquire_pipeline_worker_slot(1, 10, 'pg_cron')$q$, 'BTVF0', 'lease below 30 s');
select tests.throws($q$select public.acquire_pipeline_worker_slot(1, 300, 'Not A Token')$q$, 'BTVF0', 'trigger must be a token');

-- ── one slot: acquire, refuse, fenced release ─────────────────────────────────────────────────────────
do $$
declare
  a jsonb;
  b jsonb;
begin
  perform tests.as_service();
  a := public.acquire_pipeline_worker_slot(1, 300, 'pg_cron');
  perform tests.eq((a ->> 'slot')::int, 1, 'first sweep gets slot 1');
  perform tests.eq((a ->> 'generation')::int, 1, 'generation 1');
  perform tests.ok(public.acquire_pipeline_worker_slot(1, 300, 'after_drain') is null, 'second sweep: no slot (limit 1)');
  perform tests.ok(not public.release_pipeline_worker_slot(1, gen_random_uuid()), 'a wrong token cannot release');
  perform tests.ok(public.acquire_pipeline_worker_slot(1, 300, 'after_drain') is null, 'still held after the wrong release');
  perform tests.ok(public.renew_pipeline_worker_slot(1, (a ->> 'token')::uuid, 300), 'the holder renews');
  perform tests.ok(public.release_pipeline_worker_slot(1, (a ->> 'token')::uuid), 'the holder releases');
  perform tests.ok(not public.release_pipeline_worker_slot(1, (a ->> 'token')::uuid), 'a second release is a no-op');
  b := public.acquire_pipeline_worker_slot(1, 300, 'dev_loop');
  perform tests.eq((b ->> 'generation')::int, 2, 'the next sweep gets it, generation 2');
  perform tests.ok((b ->> 'token') <> (a ->> 'token'), 'with a new token');
  perform tests.ok(public.acquire_pipeline_worker_slot(2, 300, 'pg_cron') ->> 'slot' = '2', 'a higher limit opens slot 2');
  perform tests.ok(public.acquire_pipeline_worker_slot(2, 300, 'pg_cron') is null, 'and no third');
  perform tests.ok(public.acquire_pipeline_worker_slot(1, 300, 'pg_cron') is null, 'limit 1 ignores slot 2 and slot 1 is held');
end $$;

-- ── expiry: recovered by the next sweep; the stale holder is fenced out ───────────────────────────────
select tests.as_owner();
update public.pipeline_worker_slots set holder = null, lease_expires_at = null, trigger = null, acquired_at = null;
do $$
declare
  stale jsonb;
  fresh jsonb;
begin
  perform tests.as_service();
  stale := public.acquire_pipeline_worker_slot(1, 30, 'after_drain');
  perform tests.as_owner();
  update public.pipeline_worker_slots set lease_expires_at = now() - interval '1 second' where slot = 1;
  perform tests.as_service();
  perform tests.ok(not public.renew_pipeline_worker_slot(1, (stale ->> 'token')::uuid, 300), 'an expired holder cannot renew itself back');
  fresh := public.acquire_pipeline_worker_slot(1, 300, 'pg_cron');
  perform tests.ok(fresh is not null and (fresh ->> 'slot')::int = 1, 'the expired slot is recovered');
  perform tests.ok(not public.renew_pipeline_worker_slot(1, (stale ->> 'token')::uuid, 300), 'the stale holder cannot renew the new lease');
  perform tests.ok(not public.release_pipeline_worker_slot(1, (stale ->> 'token')::uuid), 'the stale holder cannot release the new lease');
  perform tests.ok(public.acquire_pipeline_worker_slot(1, 300, 'pg_cron') is null, 'the new holder still holds it');
  perform tests.ok(public.release_pipeline_worker_slot(1, (fresh ->> 'token')::uuid), 'the new holder releases');
end $$;

-- ── atomicity across sessions: a slot being taken in an open transaction is skipped, never waited on ──
select tests.as_owner();
select tests.c_open('a', 'service');
select tests.c_open('b', 'service');
select tests.c_exec('a', 'begin');
select tests.ok(tests.c_try('a', $q$select public.acquire_pipeline_worker_slot(1, 300, 'pg_cron')::text$q$) like 'OK:{%', 'A takes slot 1 (uncommitted)');
select tests.eq(tests.c_try('b', $q$select public.acquire_pipeline_worker_slot(1, 300, 'after_drain')::text$q$), 'OK:', 'B gets no slot at once (skip locked, no wait)');
select tests.ok(tests.c_try('b', $q$select public.acquire_pipeline_worker_slot(2, 300, 'after_drain')::text$q$) like 'OK:{"slot": 2%', 'with limit 2, B gets slot 2');
select tests.c_exec('a', 'commit');
select tests.eq(tests.c_try('b', $q$select public.acquire_pipeline_worker_slot(1, 300, 'after_drain')::text$q$), 'OK:', 'after A commits, slot 1 is held');
select tests.c_close('a');
select tests.c_close('b');
select tests.as_owner();
update public.pipeline_worker_slots set holder = null, lease_expires_at = null, trigger = null, acquired_at = null;

-- ── pipeline_work_due() ──────────────────────────────────────────────────────────────────────────────
-- it.due_check(label, expected): asserts the gate, and that it agrees with what a drain would really do:
-- claim_ready_processing_jobs returning a job, or a finishable run (run in a rolled-back subtransaction).
create function it.due_check(p_label text, p_expected boolean) returns void language plpgsql as $$
declare
  v_due boolean;
  v_claimable int := 0;
  v_finishable boolean;
begin
  perform tests.as_service();
  v_due := public.pipeline_work_due();
  begin
    select count(*) into v_claimable from public.claim_ready_processing_jobs(50, 300);
    raise exception 'rollback' using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    null;
  end;
  perform tests.as_owner();
  select exists (
    select 1 from public.processing_runs r
     where r.status in ('queued', 'running')
       and (not exists (select 1 from public.processing_jobs j where j.run_id = r.id and j.status in ('queued', 'running'))
            or exists (select 1 from public.processing_jobs j where j.run_id = r.id and j.status = 'failed'
                         and (j.error_message in ('provider_not_configured', 'ai_config_changed', 'db_schema_outdated')
                              or j.stage in ('verify_support', 'analyze', 'prepare_review'))))) into v_finishable;
  perform tests.eq(v_due, p_expected, p_label);
  perform tests.eq(v_due, v_claimable > 0 or v_finishable, p_label || ' (agrees with claim/finish)');
end $$;

select tests.user(u) from unnest(array['ann']) u;
select tests.handover('h', 'ann', 'outgoing');
select it.raw_source('h', 'sa');
select it.raw_source('h', 'sb');

select it.due_check('no runs: nothing due', false);

select tests.as_user('ann');
select tests.put('run', public.start_processing(tests.actor(), tests.id('h'), 'it-20', '{"provider":"fake"}',
  jsonb_build_array(
    jsonb_build_object('stage', 'parse', 'sourceId', tests.id('sa'), 'inputHash', md5('pa')),
    jsonb_build_object('stage', 'parse', 'sourceId', tests.id('sb'), 'inputHash', md5('pb')),
    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sa'), 'inputHash', md5('ea')),
    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sb'), 'inputHash', md5('eb')))));
select tests.as_owner();

select it.due_check('a new run: its first jobs are due', true);

-- both parses claimed (live leases): the extracts wait on them
select tests.as_service();
select count(*) from public.claim_ready_processing_jobs(2, 300);
select it.due_check('only live leases and blocked jobs: not due', false);

-- a lease expires: recoverable, so due
update public.processing_jobs set lease_expires_at = now() - interval '1 second'
 where run_id = tests.id('run') and stage = 'parse' and source_id = tests.id('sa');
select it.due_check('an expired lease: due', true);
update public.processing_jobs set lease_expires_at = now() + interval '5 minutes'
 where run_id = tests.id('run') and stage = 'parse' and source_id = tests.id('sa');

-- parse sa fails transiently: retry with backoff → not due until the backoff passes
select tests.as_service();
select public.complete_processing_job((select id from public.processing_jobs where run_id = tests.id('run') and stage = 'parse' and source_id = tests.id('sa')),
  1, 'retry', jsonb_build_object('attempt', 1, 'outcome', 'failed'), 'processing_failed', 'db_transient', now() + interval '2 minutes');
select it.due_check('a retry in backoff while the other parse holds a live lease: not due', false);
select tests.as_owner();
update public.processing_jobs set next_attempt_at = now() - interval '1 second'
 where run_id = tests.id('run') and stage = 'parse' and source_id = tests.id('sa');
select it.due_check('the retry time has come: due', true);

-- finish both parses; extract sa fails for good (per-source, not fatal) while extract sb is in backoff → wait
select tests.as_service();
do $$
declare
  j record;
begin
  for j in select id, attempt, status from public.claim_ready_processing_jobs(5, 300) where stage = 'parse' loop
    perform public.complete_processing_job(j.id, j.attempt, 'succeeded');
  end loop;
  perform public.complete_processing_job(id, attempt, 'succeeded')
     from public.processing_jobs where run_id = tests.id('run') and stage = 'parse' and status = 'running';
end $$;
select tests.as_owner();
select tests.eq((select count(*)::int from public.processing_jobs where run_id = tests.id('run') and stage = 'parse' and status = 'succeeded'), 2, 'both parses succeeded');
select tests.as_service();
do $$
declare
  j record;
  i int;
begin
  -- one extract per run at a time (DB-1 (d)): claim, complete, claim the other
  for i in 1..2 loop
    for j in select id, attempt, source_id from public.claim_ready_processing_jobs(5, 300) where stage = 'extract' loop
      if j.source_id = tests.id('sa') then
        perform public.complete_processing_job(j.id, j.attempt, 'failed', null, 'processing_failed', 'ai_invalid_output');
      else
        perform public.complete_processing_job(j.id, j.attempt, 'retry', null, 'processing_failed', 'ai_transient', now() + interval '2 minutes');
      end if;
    end loop;
  end loop;
end $$;
select tests.as_owner();
select tests.eq((select string_agg(status, ',' order by status) from public.processing_jobs where run_id = tests.id('run') and stage = 'extract'),
  'failed,queued', 'extract sa failed for good, extract sb waits in backoff');
select it.due_check('a per-source failure while another job waits in backoff: the run waits, not due', false);

-- a run-fatal failure ends the run at once, even with a job in backoff → due (finalisation)
update public.processing_jobs set error_message = 'ai_config_changed'
 where run_id = tests.id('run') and stage = 'extract' and status = 'failed';
select it.due_check('a run-fatal failure: finalisation is due', true);

-- the run is finished: nothing is due any more
select tests.as_owner();
select public.finish_processing_run(tests.id('run'), 'failed', 'precondition_failed', 'ai_config_changed');
select it.due_check('a finished run: not due', false);
