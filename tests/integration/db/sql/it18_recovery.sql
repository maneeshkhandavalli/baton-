-- IT-18 (Round 3, B4): failed-job recovery as the members see it, and run states that could get stuck.
--   * after a failed run every member who can see the run sees only a reason token, and the handover is
--     back in a state from which it can be retried (draft without prior success);
--   * the creator AND an outgoing member (non-creator) can retry; reviewer, lead, incoming cannot;
--   * a retry is a new run; the old run's jobs are never claimable again;
--   * QA-R3-01 (fixed, 48b2126): a run with zero jobs could never finish (the worker waited forever and the
--     handover stayed `processing`); start_processing now refuses an empty job list with BTVF0.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'out', 'rev', 'lead', 'inc']) u;
select tests.handover('h', 'ann', 'reviewer');
select tests.member('h', 'out', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'lead', 'lead');
select tests.member('h', 'inc', 'incoming');
select it.raw_source('h', 'sa');

-- outgoing (not the creator) starts the first run
select tests.as_user('out');
select tests.put('run1', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'parse', 'sourceId', tests.id('sa'), 'inputHash', md5('p1')),
                    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sa'), 'inputHash', md5('e1')))));
select tests.as_owner();
select tests.eq((select state from public.handovers where id = tests.id('h')), 'processing', 'run 1 started by the outgoing member');

-- parse fails for good: three attempts, then the run is finished as failed
do $$
declare
  v_job uuid;
  a int;
begin
  for a in 1..3 loop
    perform tests.as_owner();
    update public.processing_jobs set next_attempt_at = null where run_id = tests.id('run1') and stage = 'parse';
    perform tests.as_service();
    select id into v_job from public.claim_ready_processing_jobs(5, 300) where stage = 'parse';
    perform tests.ok(v_job is not null, 'parse claimable for attempt ' || a);
    perform public.complete_processing_job(v_job, a, 'retry', jsonb_build_object('attempt', a, 'outcome', 'failed'),
                                           'parse_failed', 'parse_failed', now());
  end loop;
  perform public.mark_source_parse_failed(tests.id('sa'), 'parse_failed');
  perform public.finish_processing_run(tests.id('run1'), 'failed', 'processing_failed', 'no_source_succeeded');
  perform tests.as_owner();
end $$;

select tests.eq((select state from public.handovers where id = tests.id('h')), 'draft', 'a failed first run returns the handover to draft');

-- what each member sees after the failure (refresh of the processing page)
do $$
declare
  who text;
  v jsonb;
begin
  foreach who in array array['ann', 'out', 'rev', 'lead', 'inc'] loop
    perform tests.as_reader(who);
    v := public.api_get_processing_status(tests.id('h'));
    if v is not null and v -> 'run' is not null and v -> 'run' <> 'null'::jsonb then
      perform tests.eq(v #>> '{run,status}', 'failed', who || ' sees the run as failed');
      perform tests.ok(coalesce(v #>> '{run,error,message}', '') ~ '^[a-z_]*$', who || ' sees only a reason token: ' || coalesce(v #>> '{run,error,message}', ''));
    end if;
    perform tests.ok((select coalesce(last_error_message, '') ~ '^[a-z_]*$' from public.handovers where id = tests.id('h')) is not false,
                     who || ': the handover''s last error is a reason token');
  end loop;
  perform tests.as_reader('ann');
  perform tests.eq(public.api_get_processing_status(tests.id('h')) #>> '{run,status}', 'failed', 'control: the creator sees the failed run');
  perform tests.as_owner();
end $$;

-- who may retry (§8.2 "Start or retry processing": creator + outgoing)
do $$
declare
  who text;
  r text;
  jobs jsonb := jsonb_build_array(jsonb_build_object('stage', 'parse', 'sourceId', tests.id('sa'), 'inputHash', md5('p2')));
begin
  foreach who in array array['rev', 'lead', 'inc'] loop
    r := it.gate_as(who, format('select public.start_processing(tests.actor(), %L, ''it-1'', ''{"provider":"fake"}'', %L)', tests.id('h'), jobs));
    perform tests.ok(r in ('ERR:BTFB0', 'ERR:BTNF0'), who || ' cannot retry, got ' || r);
  end loop;
  perform tests.as_user('out');
  perform tests.put('run2', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}', jobs));
  perform tests.as_owner();
  perform tests.ok((select tests.id('sa') = any (source_ids) from public.processing_runs where id = tests.id('run2')),
                   'the retry is a new run that includes the failed source (raw kept)');
  perform tests.ok(not exists (select 1 from public.processing_jobs where run_id = tests.id('run1') and status in ('queued', 'running')),
                   'run 1 has no live job left');
  perform tests.as_service();
  perform tests.ok(not exists (select 1 from public.claim_ready_processing_jobs(10, 300) c where c.run_id = tests.id('run1')),
                   'run 1''s jobs are never claimed again');
  perform tests.as_owner();
end $$;

-- the outgoing member who started the retry cannot cancel it; only the creator can (implementation; §8.2 is
-- silent on cancel). Reported as a product question in docs/qa/round3-findings.md, not a failure.
do $$
declare
  r text;
begin
  r := it.gate_as('out', format('select public.cancel_processing(tests.actor(), %L)', tests.id('h')));
  raise notice 'observation: outgoing member cancel_processing -> %', r;
  r := it.gate_as('ann', format('select public.cancel_processing(tests.actor(), %L)', tests.id('h')));
  perform tests.eq(r, 'OK', 'the creator can cancel the retry');
end $$;

-- QA-R3-01: an empty job list is refused
select tests.as_user('ann');
select public.cancel_processing(tests.actor(), tests.id('h'));
select tests.as_owner();
do $$
declare
  r text;
begin
  perform tests.as_user('ann');
  r := tests.try(format('select public.start_processing(tests.actor(), %L, ''it-1'', ''{"provider":"fake"}'', ''[]'')', tests.id('h')));
  perform tests.as_owner();
  -- QA-R3-01 fixed by the lead (20261113300400_start_processing_requires_jobs.sql): hard.
  perform tests.eq(r, 'ERR:BTVF0', 'QA-R3-01: start_processing refuses an empty job list (such a run could never finish)');
  perform tests.ok(not exists (select 1 from public.processing_runs where handover_id = tests.id('h') and status in ('queued', 'running')),
                   'QA-R3-01: no run was created');
end $$;

select 'ok' as it18_recovery;
