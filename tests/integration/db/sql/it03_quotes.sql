-- IT-03 (database part): fabricated or mis-cited quotes are refused or kept only as not_found audit rows,
-- and a point never becomes `sourced` without an exact/normalized quote (§4.2, §10.7, QA-M1, QA-M2/DB-11).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'bob']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.source('h', 's');            -- parsed; bodies "<Author> message <n> about the bank account handover"
select tests.handover('h2', 'bob', 'outgoing');
select tests.source('h2', 's2');

select tests.as_user('ann');
select tests.put('run', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}', jsonb_build_array(jsonb_build_object('stage','analyze','sourceId',null,'inputHash',md5('x')))));

select tests.as_service();
select tests.put('p1', public.insert_extracted_point(tests.id('h'), tests.id('run'), 'decision', 'T1', 'S1', '{}', null, 'everyone', '{"provider":"fake"}'));
select tests.put('p2', public.insert_extracted_point(tests.id('h'), tests.id('run'), 'decision', 'T2', 'S2', '{}', null, 'everyone', '{"provider":"fake"}'));
select tests.put('p3', public.insert_extracted_point(tests.id('h'), tests.id('run'), 'decision', 'T3', 'S3', '{}', null, 'everyone', '{"provider":"fake"}'));

do $$
declare
  v_a1 uuid := tests.msg('s', 'alice', 1);
  v_b1 uuid := tests.msg('s', 'bob', 1);
  v_body text;
  v_n int;
begin
  perform tests.as_service();
  select body into v_body from public.source_messages where id = v_a1;
  perform tests.ok(v_body = 'Alice message 1 about the bank account handover', 'fixture body');

  -- QA-M1: a fabricated quote cannot be stored as exact or normalized.
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, 0, 40, 'exact')$q$,
                              tests.id('p1'), v_a1, 'The treasurer approved a large transfer'),
                       'BTVF0', 'fabricated text claimed as exact is refused');
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, null, null, 'exact')$q$,
                              tests.id('p1'), v_a1, 'Alice message 1 about'),
                       'BTVF0', 'exact without offsets is refused');
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, 0, 5, 'exact')$q$,
                              tests.id('p1'), v_a1, 'Alice'),
                       'BTVF0', 'quotes under 12 characters are too weak to be exact (§10.7 rule 4)');
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, null, null, 'normalized')$q$,
                              tests.id('p1'), v_a1, 'Alice  message 1 about'),
                       'BTVF0', 'normalized without offsets is refused');
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, 0, 500, 'normalized')$q$,
                              tests.id('p1'), v_a1, 'Alice  message 1 about'),
                       'BTVF0', 'offsets beyond the body are refused');
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, 0, 21, 'verified')$q$,
                              tests.id('p1'), v_a1, 'Alice message 1 about'),
                       'BTVF0', 'unknown check values are refused');
  perform tests.ok(not exists (select 1 from public.evidence_quotes where source_message_id = v_a1), 'nothing was stored');

  -- Mis-cited: the text exists, but in ANOTHER message. No search in other messages (§10.7.3).
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, 0, 21, 'exact')$q$,
                              tests.id('p1'), v_b1, 'Alice message 1 about'),
                       'BTVF0', 'a quote from another message cannot be exact for this one');

  -- A genuine exact quote is accepted (control).
  perform tests.put('pe_exact', public.add_source_quote_evidence(tests.id('p1'), v_a1, 'Alice message 1 about', 0, 21, 'exact'));

  -- QA-M2 / DB-11: different not_found quotes on one message keep their own audit rows; the same text is shared.
  perform tests.put('pe_nf1', public.add_source_quote_evidence(tests.id('p2'), v_b1, 'first invented quote text here', null, null, 'not_found'));
  perform tests.put('pe_nf2', public.add_source_quote_evidence(tests.id('p3'), v_b1, 'second different invented quote', null, null, 'not_found'));
  perform tests.put('pe_nf3', public.add_source_quote_evidence(tests.id('p3'), v_b1, 'first invented quote text here', null, null, 'not_found'));
  select count(*) into v_n from public.evidence_quotes where source_message_id = v_b1;
  perform tests.eq(v_n, 2, 'two distinct not_found texts → two evidence rows');
  perform tests.ok((select array_agg(quote_text order by quote_text) from public.evidence_quotes where source_message_id = v_b1)
                   = array['first invented quote text here', 'second different invented quote'],
                   'each row keeps the text that was actually cited');
  perform tests.eq((select q.quote_text from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                     where pe.id = tests.id('pe_nf2')), 'second different invented quote', 'p3 links to its own text');
  perform tests.eq((select count(distinct evidence_id)::int from public.point_evidence
                     where id in (tests.id('pe_nf1'), tests.id('pe_nf3'))), 1, 'the same text on the same message is shared');

  -- record_quote_check (verify_quotes) cannot upgrade a fabricated pending quote.
  perform tests.put('pe_pending', public.add_source_quote_evidence(tests.id('p2'), tests.msg('s', 'carol', 2),
                                  'A made up sentence that is not there', null, null, 'pending'));
  perform tests.throws(format($q$select public.record_quote_check(q.id, 'exact') from public.point_evidence pe
                                  join public.evidence_quotes q on q.id = pe.evidence_id where pe.id = %L$q$, tests.id('pe_pending')),
                       'BTVF0', 'record_quote_check refuses exact for a quote without matching offsets/body');
  perform public.record_quote_check((select evidence_id from public.point_evidence where id = tests.id('pe_pending')), 'not_found');
  perform tests.eq((select q.quote_check from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                     where pe.id = tests.id('pe_pending')), 'not_found', 'not_found can always be recorded');

  -- A quote cannot be attached across handovers.
  perform it.fails(format($q$select public.add_source_quote_evidence(%L, %L, %L, null, null, 'pending')$q$,
                          tests.id('p1'), tests.msg('s2', 'alice', 1), 'Alice message 1 about the bank'),
                   'BTNF0', 'a message of another handover is not found');
  perform it.fails(format($q$select public.add_source_quote_evidence(%L, %L, %L, 0, 21, 'exact')$q$,
                          tests.id('p1'), tests.msg('s2', 'alice', 1), 'Alice message 1 about'),
                   'BT', 'nor can it be claimed exact');
  perform tests.ok(not exists (select 1 from public.evidence_quotes where handover_id = tests.id('h')
                                 and source_message_id = tests.msg('s2', 'alice', 1)), 'no cross-handover evidence row');

  -- QA-M1b (fixed in 20261112000500): for all-BMP bodies an exact quote must sit exactly at its stored
  -- offsets (UTF-16 units = characters there), and verified offsets must lie inside the body.
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, 10, 31, 'exact')$q$,
                              tests.id('p2'), v_a1, 'Alice message 1 about'),
                       'BTVF0', 'QA-M1b: an exact quote whose offsets point elsewhere is refused');
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, 0, 60, 'normalized')$q$,
                              tests.id('p2'), v_a1, 'Alice message 1 about the bank'),
                       'BTVF0', 'QA-M1b: verified offsets must lie inside an all-BMP body');
  perform tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, %L, -1, 20, 'exact')$q$,
                              tests.id('p2'), v_a1, 'Alice message 1 about'),
                       'BTVF0', 'QA-M1b: negative offsets are refused');
  perform tests.ok(not exists (select 1 from public.point_evidence where point_id = tests.id('p2')
                                 and evidence_id in (select id from public.evidence_quotes where source_message_id = v_a1)),
                   'QA-M1b: none of the refused quotes was stored');
end $$;

-- §4.2: verification uses only exact/normalized quotes. A "supports" verdict on a not_found quote never
-- makes a point sourced; the same verdict on the exact quote does.
do $$
declare
  v_rev uuid;
  v_text text;
begin
  perform tests.as_service();
  select current_revision_id into v_rev from public.handover_points where id = tests.id('p3');
  select q.quote_text into v_text from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
   where pe.id = tests.id('pe_nf2');
  perform public.record_support_verdict(tests.id('pe_nf2'), v_rev, 'supports', 'synthetic', '{"provider":"fake"}',
                                        sha256(convert_to(v_text, 'UTF8')));
  perform tests.ok((select evidence_status from public.handover_points where id = tests.id('p3')) <> 'sourced',
                   'a not_found quote with a supports verdict does not make the point sourced');

  select current_revision_id into v_rev from public.handover_points where id = tests.id('p1');
  perform public.record_support_verdict(tests.id('pe_exact'), v_rev, 'supports', 'synthetic', '{"provider":"fake"}',
                                        sha256(convert_to('Alice message 1 about', 'UTF8')));
  perform tests.eq((select evidence_status from public.handover_points where id = tests.id('p1')), 'sourced',
                   'an exact quote with a supports verdict for the current revision is sourced');

  -- A verdict computed on other text (e.g. after a redaction) is refused (§5.5 T6).
  perform tests.throws(format($q$select public.record_support_verdict(%L, %L, 'supports', 'x', '{}', %L)$q$,
                              tests.id('pe_exact'), v_rev, sha256(convert_to('something else', 'UTF8'))),
                       'BTCF0', 'a verdict for different quote text is refused');
end $$;

-- Browser roles cannot reach the evidence writers at all.
select tests.as_reader('ann');
select tests.throws(format($q$select public.add_source_quote_evidence(%L, %L, 'Alice message 1 about', 0, 21, 'exact')$q$,
                           tests.id('p1'), tests.msg('s', 'alice', 1)), '42501', 'authenticated cannot add evidence');
select tests.throws(format($q$select public.record_quote_check(%L, 'exact')$q$, tests.id('p1')), '42501',
                    'authenticated cannot record quote checks');
select tests.as_owner();
