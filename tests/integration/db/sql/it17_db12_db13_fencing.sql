-- IT-17 (Round 3, F1): DB-12 stale-worker fencing and DB-13 point+evidence atomicity, characterised against
-- the baseline so Agent 4's fix (E1/E2) can be verified the moment it lands.
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
  perform it.todo(v like 'ERR:%', 'DB-12', 'insert_extracted_point from a superseded attempt must be refused; got ' || v);
  v_pt := case when v like 'OK:%' then substr(v, 4)::uuid end;
  perform tests.as_owner();
  if v_pt is null then v_pt := tests.point('h', 'p_tmp'); end if;
  perform tests.as_service();

  v := tests.try(format('select public.add_source_quote_evidence(%L, %L, %L, 0, 15, %L)', v_pt, tests.msg('s', 'bob', 2), 'Bob message 2 a', 'pending'));
  perform it.todo(v like 'ERR:%', 'DB-12', 'add_source_quote_evidence from a superseded attempt must be refused; got ' || v);

  v := tests.try(format('select public.record_quote_check(%L, %L)',
                        (select evidence_id from public.point_evidence where id = tests.id('pe_old')), 'not_found')); -- always plausible: only the fence can refuse it
  perform it.todo(v like 'ERR:%', 'DB-12', 'record_quote_check from a superseded attempt must be refused; got ' || v);

  v := tests.try(format('select public.create_system_gap_question(%L, null, %L, %L, null, %L, %L)', tests.id('h'), 'owner',
                        'Stale question?', 'optional', 'everyone'));
  perform it.todo(v like 'ERR:%', 'DB-12', 'create_system_gap_question from a superseded attempt must be refused; got ' || v);
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
  perform tests.eq(tests.try(format($q$select public.insert_extracted_point(%L, %L, 'decision', 'T', 'S', '{}', null, 'everyone', '{"provider":"fake"}')$q$,
                                    tests.id('h'), tests.id('run1'))), 'ERR:BTIT0', 'control: insert_extracted_point refuses the cancelled run');
  perform tests.eq(tests.try(format('select public.set_point_sort_keys(%L, %L, %L)', tests.id('h'), tests.id('run1'), '[]')), 'ERR:BTIT0',
                   'control: set_point_sort_keys refuses the cancelled run');
  -- open: writers without a run/claim parameter accept run 1's worker because run 2 is active
  v := tests.try(format('select public.add_source_quote_evidence(%L, %L, %L, 0, 15, %L)', tests.id('p_old'), tests.msg('s', 'carol', 3),
                        'Carol message 3', 'pending'));
  perform it.todo(v like 'ERR:%', 'DB-12', 'add_source_quote_evidence from a cancelled run''s worker must be refused while another run is active; got ' || v);
  v := tests.try(format('select public.record_support_verdict(%L, %L, %L, null, %L, %L)', tests.id('pe_old'), v_rev, 'contradicts',
                        '{"provider":"fake"}', sha256(convert_to(v_quote, 'UTF8'))));
  perform it.todo(v like 'ERR:%', 'DB-12', 'record_support_verdict from a cancelled run''s worker must be refused; got ' || v);
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
  perform it.todo(v like 'ERR:%', 'DB-12', 'record_support_verdict with no active run (a late worker after the run ended) must be refused; got ' || v);
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
  perform it.todo(v like 'ERR:%' or v_atomic is not null, 'DB-13',
    'an extracted point must be written together with its evidence (atomic writer) — today a standalone insert_extracted_point commits ' || v);
  if v_atomic is not null then
    raise notice 'DB-13: candidate atomic writer(s): % (QA: add a hard test that a failing citation rolls the point back)', v_atomic;
  end if;
end $$;

select 'ok' as it17_db12_db13_fencing;
