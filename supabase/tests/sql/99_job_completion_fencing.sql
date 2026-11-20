-- Round 4 final fix (Agent C, audit S5 / F18): complete_processing_job and heartbeat_processing_job are fenced
-- by claim generation, lease and run (migration 20261121100200_job_completion_fencing.sql). Covers: stale claim
-- after a yield, retry, reclaim after an expired lease, completion, a cancelled run, and two concurrent sessions.
\set ON_ERROR_STOP 1

select tests.user('ann');
select tests.handover('h', 'ann', 'outgoing');
select tests.source('h', 's1');
select tests.source('h', 's2');
select tests.as_user('ann');
select tests.put('run', public.start_processing(tests.actor(), tests.id('h'), 'pv-s5', '{"provider":"fake"}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s1'), 'inputHash', md5('s5-e1')),
    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s2'), 'inputHash', md5('s5-e2')))));
select tests.as_owner();
select tests.put('j1', (select id from public.processing_jobs where run_id = tests.id('run') and source_id = tests.id('s1')));
select tests.put('j2', (select id from public.processing_jobs where run_id = tests.id('run') and source_id = tests.id('s2')));
-- keep j2 out of the way until the concurrency section
update public.processing_jobs set next_attempt_at = now() + interval '1 day' where id = tests.id('j2');

create function tests.gen(p_job text) returns bigint language sql as $$
  select claim_generation from public.processing_jobs where id = tests.id(p_job)
$$;
create function tests.complete_sql(p_job text, p_attempt int, p_generation bigint, p_outcome text) returns text language sql as $$
  select case when p_generation is null
              then format('select public.complete_processing_job(%L, %s, %L)', tests.id(p_job), p_attempt, p_outcome)
              else format('select public.complete_processing_claim(%L, %s, %s::bigint, %L)', tests.id(p_job), p_attempt, p_generation, p_outcome) end
$$;
grant execute on function tests.gen(text), tests.complete_sql(text, int, bigint, text) to service_role;

-- ── one function per name (no overload), and service_role only ─────────────────────────────────────────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array['public.complete_processing_claim(uuid,integer,bigint,text,jsonb,text,text,timestamp with time zone,integer,integer)',
                           'public.heartbeat_processing_claim(uuid,integer,bigint,integer,integer,integer)',
                           'public.complete_processing_job(uuid,integer,text,jsonb,text,text,timestamp with time zone,integer,integer)',
                           'public.heartbeat_processing_job(uuid,integer,integer,integer,integer)'] loop
    perform tests.ok(to_regprocedure(f) is not null, 'exists: ' || f);
    perform tests.ok(has_function_privilege('service_role', f, 'EXECUTE'), 'service_role executes ' || f);
    perform tests.ok(not has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE'),
                     'no browser role executes ' || f);
  end loop;
  perform tests.eq((select count(*)::int from pg_proc where proname in ('complete_processing_job', 'heartbeat_processing_job',
                    'complete_processing_claim', 'heartbeat_processing_claim') and pronamespace = 'public'::regnamespace), 4,
                   'exactly one function per name: positional calls can never be ambiguous');
end $$;

-- ── first claim: generation 1 ────────────────────────────────────────────────────────────────────────────
select tests.as_service();
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('j1')), 1, 'j1 claimed');
select tests.eq(tests.gen('j1'), 1::bigint, 'generation 1');
select tests.eq(public.heartbeat_processing_claim(tests.id('j1'), 1, 1::bigint, 300), 'running', 'heartbeat with the right generation renews');
select tests.eq(public.heartbeat_processing_claim(tests.id('j1'), 1, 7::bigint, 300), 'lost', 'heartbeat with a wrong generation is lost');
select tests.throws(tests.complete_sql('j1', 1, 7, 'succeeded'), 'BTCF0', 'completion with a wrong generation is refused');
select tests.throws(format('select public.complete_processing_claim(%L, 1, null::bigint, %L)', tests.id('j1'), 'succeeded'), 'BTVF0',
                    'the twin requires a generation');
select tests.eq((select current_setting('baton.claim_generation', true)), '', 'the generation setting does not outlive a call');

-- ── yield, reclaim: the stale claim (attempt 1, generation 1) can neither heartbeat nor complete ──────────
select tests.eq(public.complete_processing_claim(tests.id('j1'), 1, 1::bigint, 'yield', null, null, null, null, 1, 3), 'queued', 'yield');
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('j1')), 1, 'reclaimed');
select tests.eq((select attempt from public.processing_jobs where id = tests.id('j1')), 1, 'the attempt number repeats');
select tests.eq(tests.gen('j1'), 2::bigint, 'the generation does not');
select tests.eq(public.heartbeat_processing_claim(tests.id('j1'), 1, 1::bigint, 300), 'lost', 'stale generation: heartbeat lost');
select tests.eq(public.heartbeat_processing_job(tests.id('j1'), 1, 300), 'lost', 'attempt-only heartbeat of an ambiguous attempt: lost');
select tests.throws(tests.complete_sql('j1', 1, 1, 'succeeded'), 'BTCF0', 'stale generation: completion refused');
select tests.throws(tests.complete_sql('j1', 1, null, 'succeeded'), 'BTCF0', 'attempt-only completion of an ambiguous attempt: refused');
select tests.eq((select status from public.processing_jobs where id = tests.id('j1')), 'running', 'the new claim is untouched');
select tests.eq(public.heartbeat_processing_claim(tests.id('j1'), 1, 2::bigint, 300, 2, 3), 'running', 'the current claim heartbeats');

-- ── retry: the current claim asks for a retry; the reclaim is attempt 2, generation 3 ───────────────────
select tests.eq(public.complete_processing_claim(tests.id('j1'), 1, 2::bigint, 'retry', null, 'processing_failed', 'ai_transient', now()),
                'queued', 'retry re-queues');
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('j1')), 1, 'reclaimed for the retry');
select tests.eq((select attempt || '/' || claim_generation from public.processing_jobs where id = tests.id('j1')), '2/3', 'attempt 2, generation 3');
select tests.throws(tests.complete_sql('j1', 1, 2, 'succeeded'), 'BTCF0', 'the retried claim (attempt 1) cannot complete');
select tests.throws(tests.complete_sql('j1', 2, 2, 'succeeded'), 'BTCF0', 'nor with the right attempt and its old generation');
select tests.throws(tests.complete_sql('j1', 2, null, 'succeeded'), 'BTCF0', 'nor attempt-only (generation 3 is not attempt 2)');

-- ── an expired lease: completion is refused, the job is reclaimed, then completes once ──────────────────
select tests.as_owner();
update public.processing_jobs set lease_expires_at = now() - interval '1 second' where id = tests.id('j1');
select tests.as_service();
select tests.throws(tests.complete_sql('j1', 2, 3, 'succeeded'), 'BTCF0', 'an expired lease cannot complete');
select tests.eq(public.heartbeat_processing_claim(tests.id('j1'), 2, 3::bigint, 300), 'lost', 'nor heartbeat');
select tests.eq((select status from public.processing_jobs where id = tests.id('j1')), 'running', 'the refusal changed nothing');
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('j1')), 1, 'the expired lease is reclaimed');
select tests.eq((select attempt || '/' || claim_generation from public.processing_jobs where id = tests.id('j1')), '3/4', 'attempt 3, generation 4');
select tests.throws(tests.complete_sql('j1', 2, 3, 'succeeded'), 'BTCF0', 'the expired claim still cannot complete after the reclaim');
select tests.eq(public.complete_processing_claim(tests.id('j1'), 3, 4::bigint, 'succeeded'), 'succeeded', 'the current claim completes');
select tests.throws(tests.complete_sql('j1', 3, 4, 'succeeded'), 'BTCF0', 'a second completion is refused');

-- ── a job claimed normally (no yield) keeps generation = attempt: the attempt-only original still works ──
select tests.as_owner();
update public.processing_jobs set next_attempt_at = now() where id = tests.id('j2');
select tests.as_service();
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('j2')), 1, 'j2 claimed');
select tests.eq(public.heartbeat_processing_job(tests.id('j2'), 1, 300), 'running', 'attempt-only heartbeat of an unambiguous claim');

-- ── concurrency: the current claim completes in an open transaction; a stale completion waits, then is refused
select tests.as_owner();
do $$
declare
  r text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.eq(tests.c_try('c1', format('select public.complete_processing_claim(%L, 1, 1::bigint, %L, null, null, null, null, 1, 2)',
                                            tests.id('j2'), 'yield')), 'OK:queued', 'the current claim yields in an open transaction');
  perform tests.c_send('c2', tests.complete_sql('j2', 1, 1, 'succeeded'));
  perform tests.ok(tests.c_blocked('c2'), 'the concurrent completion waits for the row');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.eq(r, 'ERR:BTCF0', 'and is refused once the yield commits');
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;
select tests.as_service();
select tests.eq((select status || '/' || attempt from public.processing_jobs where id = tests.id('j2')), 'queued/0', 'the yield stands');

-- ── run ownership: closing the run cancels its jobs; a running job of a closed run is refused anyway ────
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('j2')), 1, 'j2 reclaimed');
select tests.as_owner();
update public.processing_runs set status = 'cancelled', finished_at = now() where id = tests.id('run');  -- job left running on purpose
select tests.as_service();
select tests.throws(tests.complete_sql('j2', 1, tests.gen('j2'), 'succeeded'), 'BTCF0', 'a closed run''s job cannot complete');
select tests.eq(public.heartbeat_processing_claim(tests.id('j2'), 1, tests.gen('j2'), 300), 'lost', 'nor heartbeat');
