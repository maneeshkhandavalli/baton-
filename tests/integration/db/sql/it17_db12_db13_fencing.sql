-- IT-17 (Round 3, F1): DB-12 stale-worker fencing and DB-13 point+evidence atomicity, characterised against
-- the baseline so Agent 4's fix (E1/E2) can be verified the moment it lands.
--
-- STATUS (2026-11-12): FIXED. Agent 4's 20261113300100_pipeline_fencing.sql adds fenced twins (pipeline_*)
-- that lib/pipeline uses, and pipeline_store_extract_chunk (DB-13), hard-tested at the end of this file;
-- 20261113300500 revokes the legacy unfenced writers from service_role, so every original reproduction
-- below is now a hard assertion that the stale/late call fails with 42501.
--
-- DB-12: a worker whose claim was superseded (its lease expired and the job was re-claimed as attempt 2), or
--   whose run was cancelled and replaced by a new run, must not be able to write points, evidence, quote
--   checks, support verdicts or system gap questions. Today the writers are fenced only to "some active run
--   of this handover" (and record_support_verdict not even to that), so a stale worker writes into the next
--   attempt or the next run. Each open case is reported as TODO(open DB-12) and turns into NOW HOLDS when the
--   unfenced call is refused (whether by a new fenced signature replacing the old one, or by a check).
-- DB-13: an extracted point and its evidence are written by separate calls (separate transactions through
--   PostgREST), so a crash between them leaves a point with no evidence. Reported as TODO(open DB-13) until a
--   writer exists that creates a point together with its evidence (or insert_extracted_point refuses to
--   create an evidence-less point).
-- Controls (hard): what is already fenced stays fenced (complete/heartbeat by attempt, insert/sort by run).
\set ON_ERROR_STOP 1

select tests.user('ann');
select tests.handover('h', 'ann', 'outgoing');
select tests.source('h', 's');      -- parsed source with messages (consent for 'fake')
select tests.point('h', 'p_old');   -- an existing point with one supported quote (for verdict writes)
select tests.cite('p_old', 's', 'alice', 1, 'supports', 'exact', 'pe_old');

select tests.as_user('ann');
select tests.put('run1', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s'), 'inputHash', md5('extract-1')))));
select tests.as_owner();
select tests.put('job1', (select id from public.processing_jobs where run_id = tests.id('run1') and stage = 'extract'));

-- worker A claims attempt 1, its lease expires, worker B re-claims as attempt 2
select tests.as_service();
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('job1')), 1, 'worker A claims');
select tests.as_owner();
update public.processing_jobs set lease_expires_at = now() - interval '1 second' where id = tests.id('job1');
select tests.as_service();
select tests.eq((select attempt from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('job1')), 2, 'worker B re-claims as attempt 2');
select tests.as_owner();

-- ── controls: completion and heartbeat are fenced by attempt (DB-2/DB-3, M4) ──
select tests.as_service();
select tests.throws(format('select public.complete_processing_job(%L, 1, %L)', tests.id('job1'), 'succeeded'), 'BTCF0',
                    'control: stale attempt 1 cannot complete the job');
select tests.eq(public.heartbeat_processing_job(tests.id('job1'), 1, 300), 'lost', 'control: stale attempt 1 heartbeat is lost');
select tests.as_owner();

-- ── DB-12 (attempt level): stale worker A's writes while attempt 2 owns the job ──
do $$
declare
  v text;
  v_pt uuid;
begin
  perform tests.as_service();
  -- every writer below is the call stale worker A makes; none carries the claim, so none can be fenced to it
  v := tests.try(format($q$select public.insert_extracted_point(%L, %L, 'decision', 'Stale title', 'A stale statement', '{}', null, 'everyone', '{"provider":"fake"}')$q$,
                        tests.id('h'), tests.id('run1')));
  perform tests.eq(v, 'ERR:42501', 'DB-12-LEGACY (revoked in 20261113300500): ' || 'insert_extracted_point from a superseded attempt must be refused; got ' || v);
  v_pt := case when v like 'OK:%' then substr(v, 4)::uuid end;
  perform tests.as_owner();
  if v_pt is null then v_pt := tests.point('h', 'p_tmp'); end if;
  perform tests.as_service();

  v := tests.try(format('select public.add_source_quote_evidence(%L, %L, %L, 0, 15, %L)', v_pt, tests.msg('s', 'bob', 2), 'Bob message 2 a', 'pending'));
  perform tests.eq(v, 'ERR:42501', 'DB-12-LEGACY (revoked in 20261113300500): ' || 'add_source_quote_evidence from a superseded attempt must be refused; got ' || v);

  v := tests.try(format('select public.record_quote_check(%L, %L)',
                        (select evidence_id from public.point_evidence where id = tests.id('pe_old')), 'not_found')); -- always plausible: only the fence can refuse it
  perform tests.eq(v, 'ERR:42501', 'DB-12-LEGACY (revoked in 20261113300500): ' || 'record_quote_check from a superseded attempt must be refused; got ' || v);

  v := tests.try(format('select public.create_system_gap_question(%L, null, %L, %L, null, %L, %L)', tests.id('h'), 'owner',
                        'Stale question?', 'optional', 'everyone'));
  perform tests.eq(v, 'ERR:42501', 'DB-12-LEGACY (revoked in 20261113300500): ' || 'create_system_gap_question from a superseded attempt must be refused; got ' || v);
  perform tests.as_owner();
end $$;

-- ── DB-12 (run level): run 1 is cancelled and replaced by run 2; run 1's worker keeps writing ──
select tests.as_user('ann');
select public.cancel_processing(tests.actor(), tests.id('h'));
select tests.as_owner();
-- cancelling returns the handover to draft or in_review; start a new run from there
select tests.as_user('ann');
select tests.put('run2', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s'), 'inputHash', md5('extract-2')))));
select tests.as_owner();

do $$
declare
  v text;
  v_rev uuid := (select current_revision_id from public.handover_points where id = tests.id('p_old'));
  v_quote text := (select q.quote_text from public.evidence_quotes q join public.point_evidence l on l.evidence_id = q.id where l.id = tests.id('pe_old'));
begin
  perform tests.as_service();
  -- control (hard): run-scoped writers already refuse the cancelled run id
  -- the legacy run-scoped writers are no longer callable at all (DB-12-LEGACY revoke) ...
  perform tests.eq(tests.try(format($q$select public.insert_extracted_point(%L, %L, 'decision', 'T', 'S', '{}', null, 'everyone', '{"provider":"fake"}')$q$,
                                    tests.id('h'), tests.id('run1'))), 'ERR:42501', 'DB-12-LEGACY: service_role cannot call insert_extracted_point');
  perform tests.eq(tests.try(format('select public.set_point_sort_keys(%L, %L, %L)', tests.id('h'), tests.id('run1'), '[]')), 'ERR:42501',
                   'DB-12-LEGACY: service_role cannot call set_point_sort_keys');
  -- ... and their run fence still holds in the body (owner), the guard the fenced twins build on
  perform tests.as_owner();
  perform tests.eq(tests.try(format($q$select public.insert_extracted_point(%L, %L, 'decision', 'T', 'S', '{}', null, 'everyone', '{"provider":"fake"}')$q$,
                                    tests.id('h'), tests.id('run1'))), 'ERR:BTIT0', 'control: the insert body refuses the cancelled run');
  perform tests.eq(tests.try(format('select public.set_point_sort_keys(%L, %L, %L)', tests.id('h'), tests.id('run1'), '[]')), 'ERR:BTIT0',
                   'control: the sort-key body refuses the cancelled run');
  perform tests.as_service();
  -- open: writers without a run/claim parameter accept run 1's worker because run 2 is active
  v := tests.try(format('select public.add_source_quote_evidence(%L, %L, %L, 0, 15, %L)', tests.id('p_old'), tests.msg('s', 'carol', 3),
                        'Carol message 3', 'pending'));
  perform tests.eq(v, 'ERR:42501', 'DB-12-LEGACY (revoked in 20261113300500): ' || 'add_source_quote_evidence from a cancelled run''s worker must be refused while another run is active; got ' || v);
  v := tests.try(format('select public.record_support_verdict(%L, %L, %L, null, %L, %L)', tests.id('pe_old'), v_rev, 'contradicts',
                        '{"provider":"fake"}', sha256(convert_to(v_quote, 'UTF8'))));
  perform tests.eq(v, 'ERR:42501', 'DB-12-LEGACY (revoked in 20261113300500): ' || 'record_support_verdict from a cancelled run''s worker must be refused; got ' || v);
  perform tests.as_owner();
end $$;

-- record_support_verdict is not even run-fenced: it also writes when NO run is active (in_review)
select tests.as_user('ann');
select public.cancel_processing(tests.actor(), tests.id('h'));
select tests.as_owner();
select tests.set_state('h', 'in_review');
do $$
declare
  v text;
  v_rev uuid := (select current_revision_id from public.handover_points where id = tests.id('p_old'));
  v_quote text := (select q.quote_text from public.evidence_quotes q join public.point_evidence l on l.evidence_id = q.id where l.id = tests.id('pe_old'));
begin
  perform tests.ok(not exists (select 1 from public.processing_runs where handover_id = tests.id('h') and status in ('queued', 'running')),
                   'no run is active');
  perform tests.as_service();
  v := tests.try(format('select public.record_support_verdict(%L, %L, %L, null, %L, %L)', tests.id('pe_old'), v_rev, 'irrelevant',
                        '{"provider":"fake"}', sha256(convert_to(v_quote, 'UTF8'))));
  perform tests.as_owner();
  perform tests.eq(v, 'ERR:42501', 'DB-12-LEGACY (revoked in 20261113300500): ' || 'record_support_verdict with no active run (a late worker after the run ended) must be refused; got ' || v);
end $$;

-- ── DB-13: a point can exist without its evidence ─────────────────────────────
-- The extract stage calls insert_extracted_point, then add_source_quote_evidence per citation, as separate
-- transactions. A crash (or a DB-12 refusal) between them leaves an evidence-less extracted point.
select tests.set_state('h', 'draft');
select tests.as_user('ann');
select tests.put('run3', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s'), 'inputHash', md5('extract-3')))));
select tests.as_owner();
do $$
declare
  v text;
  v_atomic text;
begin
  perform tests.as_service();
  v := tests.try(format($q$select public.insert_extracted_point(%L, %L, 'decision', 'Orphan', 'A point whose evidence never arrives', '{}', null, 'everyone', '{"provider":"fake"}')$q$,
                        tests.id('h'), tests.id('run3')));
  perform tests.as_owner();
  -- an atomic writer: any public function whose body inserts both a point and its evidence link
  select string_agg(p.proname, ', ') into v_atomic
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~* 'insert\s+into\s+public\.handover_points' and p.prosrc ~* 'insert\s+into\s+public\.point_evidence'
     and p.prosrc ~* '''extracted''' and p.proname <> 'create_manual_point'; -- manual points with testimony are not extraction
  if to_regprocedure('public.pipeline_store_extract_chunk(uuid,int,int,int,text,jsonb,jsonb)') is not null then
    v_atomic := coalesce(v_atomic || ', ', '') || 'pipeline_store_extract_chunk';
  end if;
  -- DB-13 fixed by Agent 4 (pipeline_store_extract_chunk; behaviour hard-tested in the fenced block below).
  perform tests.ok(v_atomic is not null, 'DB-13: an atomic point+evidence writer exists');
  -- Residual: the legacy standalone writer is still granted to service_role (revoke follow-up, DB-12-LEGACY).
  perform tests.eq(v, 'ERR:42501', 'DB-12-LEGACY (revoked in 20261113300500): ' || 'legacy insert_extracted_point still commits an evidence-less point for any service_role caller; got ' || v);
  if v_atomic is not null then
    raise notice 'DB-13: candidate atomic writer(s): % (QA: add a hard test that a failing citation rolls the point back)', v_atomic;
  end if;
end $$;

-- ── Fenced twins (Agent 4, 20261113300100_pipeline_fencing.sql): HARD once present ──
-- Runs only when the fenced API exists, so this file stays green on branches without it.
do $$
declare
  v_fn regprocedure := to_regprocedure('public.pipeline_store_extract_chunk(uuid,int,int,int,text,jsonb,jsonb)');
  v text;
  v_job uuid;
  v_run uuid;
  v_good jsonb;
  v_foreign uuid := gen_random_uuid();
  prov text := '{"provider":"fake"}';
  store text := 'select public.pipeline_store_extract_chunk(%L, %s, %s, 3, ''everyone'', %L, %L)::text';
begin
  if v_fn is null then
    raise notice 'fenced pipeline API not present on this branch: fenced-twin checks skipped';
    return;
  end if;
  perform tests.handover('hf', 'ann', 'outgoing');
  perform tests.source('hf', 'sf');
  perform tests.as_user('ann');
  v_run := public.start_processing(tests.actor(), tests.id('hf'), 'it-1', '{"provider":"fake"}',
             jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sf'), 'inputHash', md5('f1'))));
  perform tests.as_service();
  select id into v_job from public.claim_ready_processing_jobs(10, 300) where run_id = v_run;
  perform tests.ok(v_job is not null, 'fenced: attempt 1 claimed');
  perform tests.as_owner();
  update public.processing_jobs set lease_expires_at = now() - interval '1 second' where id = v_job;
  perform tests.as_service();
  perform tests.eq((select attempt from public.claim_ready_processing_jobs(10, 300) c where c.id = v_job), 2, 'fenced: re-claimed as attempt 2');
  v_good := jsonb_build_array(jsonb_build_object('point', jsonb_build_object('category', 'decision', 'title', 'Fenced title',
              'statement', 'A fenced statement'), 'citations', jsonb_build_array(
                jsonb_build_object('messageId', tests.msg('sf', 'alice', 1), 'quote', 'Alice message 1', 'quoteStart', 0, 'quoteEnd', 15),
                jsonb_build_object('messageId', v_foreign, 'quote', 'not in this source'))));

  -- DB-12: the superseded attempt cannot write
  perform tests.eq(tests.try(format(store, v_job, 1, 0, prov, v_good)), 'ERR:BTLL0', 'DB-12 fenced: stale attempt 1 cannot store a chunk');
  perform tests.eq(tests.try(format('select public.pipeline_record_quote_check(%L, 1, %L, ''not_found'')', v_job,
                   (select evidence_id from public.point_evidence where id = tests.id('pe_old')))), 'ERR:BTLL0',
                   'DB-12 fenced: stale attempt 1 cannot record a quote check');
  -- stage scoping: the extract claim may not write quote checks
  perform tests.eq(tests.try(format('select public.pipeline_record_quote_check(%L, 2, %L, ''not_found'')', v_job,
                   (select evidence_id from public.point_evidence where id = tests.id('pe_old')))), 'ERR:BTFB0',
                   'DB-12 fenced: an extract claim cannot write quote checks');

  -- DB-13: a new point whose citations all fail is not inserted; the chunk still checkpoints
  v := tests.try(format(store, v_job, 2, 0, prov, jsonb_build_array(jsonb_build_object('point',
         jsonb_build_object('category', 'decision', 'title', 'Orphan', 'statement', 'No surviving evidence'),
         'citations', jsonb_build_array(jsonb_build_object('messageId', v_foreign, 'quote', 'foreign'))))));
  perform tests.ok(v like 'OK:%' and (substr(v, 4)::jsonb #>> '{entries,0,inserted}') = 'false', 'DB-13: evidence-less point not inserted, got ' || v);
  perform tests.eq((select count(*)::int from public.handover_points where handover_id = tests.id('hf')), 0, 'DB-13: no orphan point');
  -- one valid + one foreign citation: point with exactly one link
  v := tests.try(format(store, v_job, 2, 1, prov, v_good));
  perform tests.ok(v like 'OK:%', 'DB-13: chunk 1 stored, got ' || v);
  perform tests.eq((select count(*)::int from public.handover_points where handover_id = tests.id('hf')), 1, 'DB-13: one point');
  perform tests.eq((select count(*)::int from public.point_evidence where handover_id = tests.id('hf')), 1, 'DB-13: its one surviving citation');
  -- idempotent repeat of a committed chunk
  v := tests.try(format(store, v_job, 2, 1, prov, v_good));
  perform tests.eq(substr(v, 4)::jsonb ->> 'alreadyCommitted', 'true', 'DB-13: a repeated chunk is a no-op');
  perform tests.eq((select count(*)::int from public.handover_points where handover_id = tests.id('hf')), 1, 'DB-13: still one point');
  -- a chunk cannot attach to another handover's point
  perform tests.eq(tests.try(format(store, v_job, 2, 2, prov, jsonb_build_array(jsonb_build_object('pointId', tests.id('p_old'),
                     'citations', jsonb_build_array(jsonb_build_object('messageId', tests.msg('sf', 'bob', 1), 'quote', 'Bob message 1')))))),
                   'ERR:BTFB0', 'DB-12 fenced: a chunk cannot attach evidence to another handover''s point');
  -- the run is cancelled: the live claim is lost too
  perform tests.as_user('ann');
  perform public.cancel_processing(tests.actor(), tests.id('hf'));
  perform tests.as_service();
  perform tests.eq(tests.try(format(store, v_job, 2, 2, prov, v_good)), 'ERR:BTLL0', 'DB-12 fenced: a cancelled run''s claim cannot write');
  perform tests.as_owner();
  raise notice 'fenced pipeline API: hard checks passed';
end $$;

select 'ok' as it17_db12_db13_fencing;
