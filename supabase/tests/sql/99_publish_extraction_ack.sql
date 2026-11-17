-- R3 Task 04: the database enforces the partial/failed-source acknowledgement on every publication path
-- (migration 20261117400200_publish_extraction_ack).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc', 'out', 'bob']) u;

-- A publishable handover: one approved point, an incoming member, in review. Runs/jobs are table fixtures.
create function tests.ready(p_h text) returns void language plpgsql as $$
begin
  perform tests.handover(p_h, 'ann', 'outgoing');
  perform tests.member(p_h, 'rev', 'reviewer');
  perform tests.member(p_h, 'inc', 'incoming');
  perform tests.source(p_h, p_h || 's1');
  perform tests.source(p_h, p_h || 's2');
  perform tests.point(p_h, p_h || 'p');
  perform tests.cite(p_h || 'p', p_h || 's1', 'alice', 1);
  perform tests.set_state(p_h, 'in_review');
  perform tests.approve_all(p_h);
end $$;

-- A finished run over both sources; each extract job as given: status, chunks done, chunks total.
create function tests.run(p_h text, p_name text, s1 text, d1 int, t1 int, s2 text, d2 int, t2 int) returns uuid
language plpgsql as $$
declare v_run uuid;
begin
  insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config, created_at)
  values (tests.id(p_h), 'succeeded', array[tests.id(p_h || 's1'), tests.id(p_h || 's2')], 'pv-test', 'fake', '{}',
          clock_timestamp())
  returning id into v_run;
  insert into public.processing_jobs (handover_id, run_id, source_id, stage, status, attempt, input_hash, progress_done, progress_total, error_message)
  values (tests.id(p_h), v_run, tests.id(p_h || 's1'), 'extract', s1, 1, '\x01', d1, t1, case when s1 <> 'succeeded' then 'ai_provider_error' end),
         (tests.id(p_h), v_run, tests.id(p_h || 's2'), 'extract', s2, 1, '\x02', d2, t2, case when s2 <> 'succeeded' then 'ai_provider_error' end);
  return tests.put(p_name, v_run);
end $$;

-- The acknowledgement payload the application sends: the current (source, fingerprint) of every gap. (The app reads
-- it from api_get_extraction_report; the internal gap view itself is not executable by API roles, so this test
-- helper runs as its owner.)
create function tests.gaps(p_h text) returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object('sourceId', g.source_id, 'fingerprint', g.fingerprint)), '[]'::jsonb)
    from public._extraction_publish_gaps(tests.id(p_h)) g
$$;
create function tests.pub_sql(p_h text, p_acks jsonb) returns text language sql as $$
  select format('select public.publish_handover(tests.actor(), %L, null, %L::jsonb)', tests.id(p_h), p_acks)
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ── 1. all sources complete: publishes (no acknowledgement needed) ────────────
select tests.ready('h1');
select tests.run('h1', 'r1', 'succeeded', 2, 2, 'succeeded', 1, 1);
select tests.eq(jsonb_array_length(tests.gaps('h1')), 0, 'complete sources: no gap');
select tests.as_user('ann');
select tests.put('pub1', public.publish_handover(tests.actor(), tests.id('h1'), 'All complete'));
select tests.as_owner();
select tests.eq((select state from public.handovers where id = tests.id('h1')), 'approved', '1: published');

-- ── 2. complete_with_skips follows Task 03 (it is complete for the gate) ───────
-- Oversize skips live in the coverage table; the job itself succeeded with every chunk done.
select tests.ready('h2');
select tests.run('h2', 'r2', 'succeeded', 3, 3, 'succeeded', 0, 0);
select tests.as_owner();
insert into public.extraction_source_coverage (run_id, handover_id, source_id, detector_version, messages_inspected,
                                               messages_with_signals, signals_total, oversize_skipped, empty_skipped, chunks_total)
values (tests.id('r2'), tests.id('h2'), tests.id('h2s1'), 'signals@1', 10, 2, 3, 4, 0, 3);
select tests.as_user('ann');
select public.publish_handover(tests.actor(), tests.id('h2'));
select tests.as_owner();
select tests.eq((select state from public.handovers where id = tests.id('h2')), 'approved', '2: complete_with_skips publishes without acknowledgement');

-- ── 3/4. a partial source, a failed source: refused without acknowledgement ────
select tests.ready('h3');
select tests.run('h3', 'r3', 'failed', 2, 5, 'cancelled', 0, 0);
select tests.eq((select array_agg(gap_state order by gap_state) from public._extraction_publish_gaps(tests.id('h3'))),
                array['failed', 'partial'], 'one partial and one failed gap');
select tests.as_user('ann');
select tests.throws(format('select public.publish_handover(tests.actor(), %L)', tests.id('h3')), 'BTPF0', '3/4: the 3-argument publish is refused');
select tests.throws(tests.pub_sql('h3', '[]'), 'BTPF0', '3/4: publishing with no acknowledgement is refused');
select tests.throws(tests.pub_sql('h3', (select jsonb_build_array(e) from jsonb_array_elements(tests.gaps('h3')) e limit 1)), 'BTPF0',
                    '3/4: acknowledging only one of two gaps is refused');
select tests.as_owner();
select tests.eq((select state from public.handovers where id = tests.id('h3')), 'in_review', 'still in review');
select tests.eq((select count(*)::int from public.publication_source_acknowledgements where handover_id = tests.id('h3')), 0,
                'a refused publication leaves no acknowledgement behind (one transaction)');

-- ── 6. wrong reviewer / unauthorised actor: refused before anything is recorded ─
select tests.as_user('rev');
select tests.throws(tests.pub_sql('h3', tests.gaps('h3')), 'BTFB0', '6: a reviewer who is not the creator cannot acknowledge');
select tests.as_user('inc');
select tests.throws(tests.pub_sql('h3', tests.gaps('h3')), 'BTFB0', '6: the incoming member cannot acknowledge');
select tests.as_user('out');
select tests.throws(tests.pub_sql('h3', tests.gaps('h3')), 'BTNF0', '6: a non-member is told not found');
select tests.as_owner();
select tests.eq((select count(*)::int from public.publication_source_acknowledgements), 0, '6: nothing recorded');

-- an acknowledgement for a fingerprint that is not a current gap is refused
select tests.as_user('ann');
select tests.throws(tests.pub_sql('h3', jsonb_build_array(jsonb_build_object('sourceId', tests.id('h3s1'), 'fingerprint', 'cov1:' || md5('x')))),
                    'BTCF0', 'a stale or made-up fingerprint is refused');
select tests.throws(tests.pub_sql('h3', '{"not":"an array"}'), 'BTVF0', 'malformed acknowledgements are refused');

-- ── 5. a valid acknowledgement by the creator: publishes, with an audit record ─
select tests.put('pub3', public.publish_handover(tests.actor(), tests.id('h3'), 'Partial, acknowledged', tests.gaps('h3')));
select tests.as_owner();
do $$
declare a record;
begin
  perform tests.eq((select state from public.handovers where id = tests.id('h3')), 'approved', '5: published');
  perform tests.eq((select count(*)::int from public.publication_source_acknowledgements where handover_id = tests.id('h3')), 2,
                   '5: one acknowledgement per gap source');
  for a in select * from public.publication_source_acknowledgements where handover_id = tests.id('h3') loop
    perform tests.eq(a.acknowledged_by, tests.id('ann'), '5: reviewer identity is the verified actor');
    perform tests.eq(a.run_id, tests.id('r3'), '5: the run being acknowledged');
    perform tests.ok(a.acknowledged_at is not null and a.coverage_fingerprint like 'cov1:%' and a.extract_job_id is not null, '5: state recorded');
  end loop;
  perform tests.ok(exists (select 1 from public.audit_logs where handover_id = tests.id('h3')
                             and action = 'publication.extraction_gaps_acknowledged'
                             and jsonb_array_length(after -> 'sources') = 2), '5: audit log entry');
end $$;
-- the record is append-only for application roles
select tests.throws(format('update public.publication_source_acknowledgements set gap_state = %L where handover_id = %L', 'partial', tests.id('h3')),
                    'BTIT0', 'acknowledgements cannot be edited');
select tests.throws(format('delete from public.publication_source_acknowledgements where handover_id = %L', tests.id('h3')),
                    'BTIT0', 'acknowledgements cannot be deleted directly');

-- ── 7. a new run makes the old acknowledgement obsolete ───────────────────────
select tests.ready('h7');
select tests.run('h7', 'r7a', 'failed', 1, 4, 'succeeded', 1, 1);
select tests.as_user('ann');
select tests.put('pub7', public.publish_handover(tests.actor(), tests.id('h7'), 'v1', tests.gaps('h7')));
select tests.as_owner();
select tests.kv_put('ack7', (select jsonb_build_object('sourceId', source_id, 'fingerprint', coverage_fingerprint)
                               from public.publication_source_acknowledgements where handover_id = tests.id('h7')));
-- revision, then a new run where the same source is partial again (different progress)
select tests.set_state('h7', 'in_review');
select tests.run('h7', 'r7b', 'failed', 2, 4, 'succeeded', 1, 1);
select tests.as_user('ann');
select tests.throws(format('select public.publish_handover(tests.actor(), %L)', tests.id('h7')), 'BTPF0',
                    '7: the old run''s acknowledgement does not authorise the new run');
select tests.throws(tests.pub_sql('h7', jsonb_build_array(tests.kv('ack7'))), 'BTCF0', '7: re-sending the old acknowledgement is refused');
select tests.put('pub7b', public.publish_handover(tests.actor(), tests.id('h7'), 'v2', tests.gaps('h7')));
select tests.as_owner();
select tests.eq((select count(*)::int from public.publication_source_acknowledgements where handover_id = tests.id('h7')), 2,
                '7: a second acknowledgement for the new state; the first is kept');
-- same run, retried job with a new attempt: the fingerprint changes too
select tests.eq((select public.extraction_coverage_fingerprint(tests.id('r7b'), gen_random_uuid(), 'failed', 2, 4, 1, 'x')
                   <> public.extraction_coverage_fingerprint(tests.id('r7b'), gen_random_uuid(), 'failed', 2, 4, 2, 'x')), true,
                '7: a different job or attempt is a different fingerprint');

-- ── 8. direct database writes cannot bypass the gate ──────────────────────────
select tests.ready('h8');
select tests.run('h8', 'r8', 'failed', 0, 0, 'succeeded', 1, 1);
select tests.as_owner();
select tests.throws(format('update public.handovers set state = %L where id = %L', 'approved', tests.id('h8')), 'BTPF0',
                    '8: a direct state update to approved is refused');
select tests.throws(format('insert into public.handover_publications (handover_id, version, published_by) values (%L, 1, %L)',
                           tests.id('h8'), tests.id('ann')), 'BTPF0', '8: a direct publication insert is refused');
select tests.as_service();
select tests.throws(format('insert into public.publication_source_acknowledgements (handover_id, source_id, run_id, gap_state, chunks_done, chunks_total, coverage_fingerprint, acknowledged_by) values (%L, %L, %L, %L, 0, 0, %L, %L)',
                           tests.id('h8'), tests.id('h8s1'), tests.id('r8'), 'failed', 'cov1:' || md5('y'), tests.id('ann')),
                    '42501', '8: the service role cannot forge an acknowledgement');
select tests.throws(format('update public.handovers set state = %L where id = %L', 'approved', tests.id('h8')), '42501',
                    '8: the service role has no direct update on handovers');
select tests.as_owner();
-- the incoming-member lifecycle (acknowledged -> approved) is not a publication and is not gated
select tests.eq((select state from public.handovers where id = tests.id('h3')), 'approved', 'h3 is published');

-- ── 9. existing published handovers stay readable and unchanged ────────────────
do $$
declare v jsonb;
begin
  perform tests.as_reader('inc');
  v := public.api_get_published_handover(tests.id('h1'));
  perform tests.ok(v is not null and v ->> 'publication_id' = tests.id('pub1')::text, '9: the incoming member reads publication 1');
  v := public.api_get_published_handover(tests.id('h3'));
  perform tests.ok(v is not null, '9: and the acknowledged one');
  perform tests.as_owner();
  perform tests.eq((select count(*)::int from public.handover_publications where handover_id = tests.id('h1')), 1, '9: not rewritten');
end $$;

-- ── report exposes exactly what the gate enforces ─────────────────────────────
do $$
declare r jsonb; s jsonb;
begin
  perform tests.as_reader('ann');
  r := public.api_get_extraction_report(tests.id('h8'));
  select e into s from jsonb_array_elements(r -> 'sources') e where e ->> 'sourceId' = tests.id('h8s1')::text;
  perform tests.eq(s ->> 'gapState', 'failed', 'report: gap state');
  perform tests.eq(s ->> 'coverageFingerprint', (select e ->> 'fingerprint' from jsonb_array_elements(tests.gaps('h8')) e
                                                   where e ->> 'sourceId' = tests.id('h8s1')::text),
                   'report: the same fingerprint the gate checks');
  perform tests.eq((s ->> 'gapAcknowledged')::boolean, false, 'report: not acknowledged');
  select e into s from jsonb_array_elements(r -> 'sources') e where e ->> 'sourceId' = tests.id('h8s2')::text;
  perform tests.eq(s ->> 'gapState', 'complete', 'report: complete source');
  perform tests.ok(s -> 'coverageFingerprint' = 'null'::jsonb, 'report: no fingerprint for a complete source');
  r := public.api_get_extraction_report(tests.id('h3'));
  perform tests.ok((select bool_and((e ->> 'gapAcknowledged')::boolean) from jsonb_array_elements(r -> 'sources') e), 'report: acknowledged');
  perform tests.as_reader('rev');
  perform tests.eq((select count(*)::int from public.publication_source_acknowledgements), 4,
                   'a reviewer reads the acknowledgements (2 on h3, 2 on h7)');
  perform tests.as_reader('inc');
  perform tests.eq((select count(*)::int from public.publication_source_acknowledgements), 0, 'the incoming member does not');
end $$;

-- ── grants ────────────────────────────────────────────────────────────────────
do $$
begin
  perform tests.ok(has_function_privilege('service_role', 'public.publish_handover(uuid,uuid,text,jsonb)', 'execute'), 'service_role publishes with acknowledgements');
  perform tests.ok(not has_function_privilege('authenticated', 'public.publish_handover(uuid,uuid,text,jsonb)', 'execute'), 'browser cannot');
  perform tests.ok(not has_function_privilege('service_role', 'public._extraction_publish_gaps(uuid)', 'execute'), 'gap view is internal');
  perform tests.ok(not has_table_privilege('service_role', 'public.publication_source_acknowledgements', 'insert'), 'no direct insert');
  perform tests.ok(not has_table_privilege('authenticated', 'public.publication_source_acknowledgements', 'insert'), 'no browser insert');
  perform tests.ok(has_function_privilege('service_role', 'public.publish_handover(uuid,uuid,text)', 'execute'), '3-argument publish keeps its grant');
end $$;
