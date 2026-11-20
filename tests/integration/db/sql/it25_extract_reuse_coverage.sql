-- IT-25 (Round 4 final fix, audit 4.8 / F5): an extract reused from a run cancelled after its extracts
-- finished carries that run's coverage, chunk stats, progress and provenance onto the new run
-- (migration 20261121100300_extract_reuse_coverage.sql). Fenced by the claim; idempotent.
\set ON_ERROR_STOP 1

select tests.user('ann');
select tests.handover('h', 'ann', 'outgoing');
select tests.source('h', 's1');

-- Run 1: the extract succeeds (3 of 3 chunks, coverage recorded), then the run is cancelled.
select tests.as_user('ann');
select tests.put('r1', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s1'), 'inputHash', md5('same')),
                    jsonb_build_object('stage', 'verify_support', 'sourceId', null, 'inputHash', md5('vs')))));
select tests.as_service();
select tests.put('j1', (select id from public.claim_ready_processing_jobs(5, 300) limit 1));
select public.pipeline_set_job_provenance(tests.id('j1'), 1, 1::bigint, '{"provider":"fake","model":"m-extract"}');
select tests.as_owner();
insert into public.extraction_source_coverage (run_id, handover_id, source_id, detector_version, messages_inspected, messages_with_signals,
                                               signals_total, oversize_skipped, empty_skipped, chunks_total)
values (tests.id('r1'), tests.id('h'), tests.id('s1'), 'sig@1', 10, 4, 6, 0, 1, 3);
insert into public.extraction_chunk_stats (run_id, handover_id, source_id, chunk_index, chunk_total, messages, candidates, inserted, merged)
select tests.id('r1'), tests.id('h'), tests.id('s1'), g, 3, 4, 2, 1, 1 from generate_series(0, 2) g;
select tests.as_service();
select tests.eq(public.complete_processing_claim(tests.id('j1'), 1, 1::bigint, 'succeeded', null, null, null, null, 3, 3), 'succeeded', 'run 1 extract done');
select tests.as_user('ann');
select public.cancel_processing(tests.actor(), tests.id('h'));
select tests.as_owner();
select tests.eq((select status from public.processing_runs where id = tests.id('r1')), 'cancelled', 'run 1 cancelled after its extract');

-- Run 2: same input. The extract job is claimed; the earlier (cancelled) run's success is reused.
select tests.as_user('ann');
select tests.put('r2', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s1'), 'inputHash', md5('same')))));
select tests.as_service();
select tests.put('j2', (select id from public.claim_ready_processing_jobs(5, 300) limit 1));
select tests.eq((select run_id from public.processing_jobs where id = tests.id('j2')), tests.id('r2'), 'run 2 extract claimed');
select tests.eq(public.get_processing_job_context(tests.id('j2')) ->> 'priorSucceeded', 'true', 'the cancelled run''s success counts as prior');

-- Fencing first: a stale generation and a browser role are refused.
select tests.throws(format('select public.pipeline_reuse_prior_extract(%L, 1, 9)', tests.id('j2')), 'BTLL0', 'a stale generation is refused');
select tests.ok(not has_function_privilege('authenticated', 'public.pipeline_reuse_prior_extract(uuid,integer,bigint)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.pipeline_reuse_prior_extract(uuid,integer,bigint)', 'EXECUTE'), 'browser roles cannot execute');
select tests.eq((select count(*)::int from public.extraction_source_coverage where run_id = tests.id('r2')), 0, 'nothing copied yet');

do $$
declare
  r jsonb;
  g bigint := (select claim_generation from public.processing_jobs where id = tests.id('j2'));
begin
  r := public.pipeline_reuse_prior_extract(tests.id('j2'), 1, g);
  perform tests.eq(r ->> 'reused', 'true', 'reused');
  perform tests.eq((r ->> 'priorRunId')::uuid, tests.id('r1'), 'from run 1');
  perform tests.eq(r ->> 'priorRunStatus', 'cancelled', 'and says that run was cancelled');
  perform tests.eq((r ->> 'progressDone')::int || '/' || (r ->> 'progressTotal')::int, '3/3', 'the real progress, not 0/0');
  perform tests.eq(r ->> 'coverageCopied', 'true', 'coverage copied');
  perform tests.eq((r ->> 'chunkStats')::int, 3, 'chunk stats copied');
  -- idempotent: a retry copies nothing twice
  r := public.pipeline_reuse_prior_extract(tests.id('j2'), 1, g);
  perform tests.eq((r ->> 'chunkStats')::int, 3, 'a second call is a no-op');
end $$;
select tests.eq((select messages_inspected || '/' || messages_with_signals || '/' || chunks_total from public.extraction_source_coverage
                  where run_id = tests.id('r2') and source_id = tests.id('s1')), '10/4/3', 'run 2 now has the reused coverage');
select tests.eq((select ai_provenance #>> '{reusedFrom,runStatus}' from public.processing_jobs where id = tests.id('j2')), 'cancelled',
                'the job records where its result came from');
select tests.eq((select ai_provenance ->> 'model' from public.processing_jobs where id = tests.id('j2')), 'm-extract',
                'and the provenance of the extraction it reuses');
select tests.eq((select current_setting('baton.claim_generation', true)), '', 'the generation setting does not outlive the call');

-- No prior success: nothing reused, nothing copied.
select tests.handover('h2', 'ann', 'outgoing');
select tests.source('h2', 's2');
select tests.as_user('ann');
select tests.put('r3', public.start_processing(tests.actor(), tests.id('h2'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s2'), 'inputHash', md5('other')))));
select tests.as_service();
select tests.put('j3', (select id from public.processing_jobs where run_id = tests.id('r3')));
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('j3')), 1, 'claimed');
select tests.eq(public.pipeline_reuse_prior_extract(tests.id('j3'), 1, 1::bigint) ->> 'reused', 'false', 'no prior success: not reused');
