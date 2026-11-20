-- Round 4 B (F4 / E1, E2): re-verification scope, Confirm & approve, and the version history reads
-- (20261121200100_living_handover_reverify_scope.sql).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc', 'bob']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.handover('h2', 'bob', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's_old');   -- a source that does not change
select tests.set_state('h', 'in_review');

-- helper: the link ids verify_support would be given now
create function pg_temp.queued() returns uuid[] language sql as $$
  select coalesce(array_agg((x ->> 'pointEvidenceId')::uuid), '{}')
    from jsonb_array_elements(public.list_links_needing_support(tests.id('h'), 500)) x
$$;
create function pg_temp.link_of(p text) returns uuid language sql as $$
  select id from public.point_evidence where point_id = tests.id(p) order by created_at, id limit 1
$$;

-- ── the pure rule ────────────────────────────────────────────────────────────
do $$
begin
  perform tests.ok(public.link_in_reverify_scope('pending', 'testimony', 'unchecked'), 'rule: pending testimony is checked');
  perform tests.ok(public.link_in_reverify_scope('pending', 'source_quote', 'supports'), 'rule: pending stale quote is checked');
  perform tests.ok(not public.link_in_reverify_scope('approved', 'testimony', 'unchecked'), 'rule: approved testimony is human evidence');
  perform tests.ok(not public.link_in_reverify_scope('approved', 'source_quote', 'supports'), 'rule: approved edit is not re-checked');
  perform tests.ok(public.link_in_reverify_scope('approved', 'source_quote', 'unchecked'), 'rule: new source evidence on an approved point is checked');
end $$;

-- ── v1: a sourced point, an edited point, a manual point; all approved and published ─────────────────
select tests.point('h', 'p_src');  select tests.cite('p_src', 's_old', 'alice', 1);
select tests.point('h', 'p_edit', 'risk'); select tests.cite('p_edit', 's_old', 'bob', 1);
do $$
declare
  v_rev uuid;
  v_man uuid;
begin
  perform tests.as_user('ann');
  select current_revision_id into v_rev from public.handover_points where id = tests.id('p_edit');
  perform public.edit_point(tests.actor(), tests.id('p_edit'), v_rev, 'Edited risk', 'The edited risk wording', '{}'::jsonb, 'clearer');
  v_man := public.create_manual_point(tests.actor(), tests.id('h'), 'contact', 'Dean office', 'Mrs Kapoor runs the Dean office',
                                      '{"nameLabel":"Mrs Kapoor"}'::jsonb, null, null, 'I spoke to Mrs Kapoor myself last week.');
  perform tests.put('p_man', v_man);
  perform tests.as_owner();
  perform tests.eq((select evidence_status from public.handover_points where id = tests.id('p_edit')), 'inferred', 'setup: edited point is stale');
  perform tests.eq((select evidence_status from public.handover_points where id = tests.id('p_man')), 'inferred', 'setup: manual point unchecked');
  -- before approval both are queued for verification, as before
  perform tests.ok(pg_temp.link_of('p_edit') = any (pg_temp.queued()), 'pending edited point is verified');
  perform tests.ok(pg_temp.link_of('p_man') = any (pg_temp.queued()), 'pending manual point is verified');
end $$;
select tests.approve_all('h');
do $$
begin
  perform tests.as_user('ann');
  perform tests.put('pub1', public.publish_handover(tests.actor(), tests.id('h'), 'v1'));
  perform public.start_revision(tests.actor(), tests.id('h'));
  perform tests.as_owner();
end $$;

-- ── unchanged sources, edited and manual points: nothing is re-verified, nothing reopens ─────────────
do $$
begin
  perform tests.ok(not (pg_temp.link_of('p_src') = any (pg_temp.queued())), 'unchanged source: verified link not queued');
  perform tests.ok(not (pg_temp.link_of('p_edit') = any (pg_temp.queued())), 'approved edited point: not re-verified');
  perform tests.ok(not (pg_temp.link_of('p_man') = any (pg_temp.queued())), 'approved manual point: testimony not re-verified');
  perform tests.eq(cardinality(pg_temp.queued()), 0, 'nothing to verify for an unchanged handover');
end $$;

-- ── accepted testimony (Gap Interview answer) on an approved point stays human evidence ─────────────
do $$
declare
  v_q uuid;
  v_a uuid;
  v_link uuid;
begin
  perform tests.as_user('ann');
  v_q := public.create_gap_question(tests.actor(), tests.id('h'), tests.id('p_src'), null, 'Who confirmed this?', null, 'optional');
  perform public.submit_gap_answers(tests.actor(), jsonb_build_array(jsonb_build_object('gapQuestionId', v_q, 'answerText', 'Rohan confirmed it in the leads call.')));
  select id into v_a from public.gap_answers where gap_question_id = v_q;
  perform public.review_gap_answer(tests.actor(), v_a, 'accept');
  perform tests.as_owner();
  select pe.id into v_link from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
   where pe.point_id = tests.id('p_src') and q.gap_answer_id = v_a;
  perform tests.ok(v_link is not null, 'accepted answer linked to the approved point');
  perform tests.ok(not (v_link = any (pg_temp.queued())), 'accepted testimony on an approved point is not re-verified');
  perform tests.eq((select review_state from public.handover_points where id = tests.id('p_src')), 'approved', 'approved point stays approved');
end $$;

-- (published sources keep only cited messages, so the changed version is a fresh source added during the revision)
select tests.source('h', 's_new');

-- ── changed source: new evidence on an approved point IS verified; a conflicting update reopens ───────
do $$
declare
  v_link uuid;
  v_rev uuid;
begin
  v_link := tests.cite('p_src', 's_new', 'carol', 2, 'unchecked', 'exact', 'p_src/new');
  perform tests.ok(v_link = any (pg_temp.queued()), 'changed source: new link on the approved point is queued');
  perform tests.eq((select review_state from public.handover_points where id = tests.id('p_src')), 'approved', 'unchecked new link alone does not reopen');
  select current_revision_id into v_rev from public.handover_points where id = tests.id('p_src');
  perform public.record_support_verdict(v_link, v_rev, 'contradicts', 'the new version says otherwise', '{"provider":"fake"}',
                                        sha256(convert_to((select quote_text from public.evidence_quotes q join public.point_evidence pe on pe.evidence_id = q.id where pe.id = v_link), 'UTF8')));
  perform tests.eq((select evidence_status from public.handover_points where id = tests.id('p_src')), 'conflicting', 'conflicting update: status');
  perform tests.eq((select review_state from public.handover_points where id = tests.id('p_src')), 'pending', 'conflicting update: reopened for a decision');
  perform tests.ok(exists (select 1 from public.review_actions where point_id = tests.id('p_src') and action = 'auto_reopen'), 'conflicting update: auto_reopen recorded');
  perform tests.ok(not exists (select 1 from public.review_actions where point_id in (tests.id('p_man'), tests.id('p_edit')) and action = 'auto_reopen'),
                   'manual and edited points were never auto-reopened');
end $$;

-- ── Confirm & approve ────────────────────────────────────────────────────────
do $$
declare
  v_rev uuid;
  v_res jsonb;
  v_man2 uuid;
begin
  -- a manual point whose testimony a verifier rejected (the F4 state): pending, Missing
  perform tests.as_user('ann');
  v_man2 := public.create_manual_point(tests.actor(), tests.id('h'), 'contact', 'Bus vendor', 'Sharma Travels runs the bus',
                                       '{"nameLabel":"Sharma Travels"}'::jsonb, null, null, 'I booked Sharma Travels last year.');
  perform tests.as_owner();
  perform tests.put('p_man2', v_man2);
  select current_revision_id into v_rev from public.handover_points where id = v_man2;
  perform public.record_support_verdict(pg_temp.link_of('p_man2'), v_rev, 'irrelevant', 'word overlap too low', '{"provider":"fake"}',
                                        sha256(convert_to('I booked Sharma Travels last year.', 'UTF8')));
  perform tests.eq((select evidence_status from public.handover_points where id = v_man2), 'missing', 'setup: rejected testimony is missing');

  perform tests.as_user('inc');
  perform tests.throws(format('select public.confirm_testimony_and_approve(tests.actor(), %L, %L)', v_man2, v_rev), 'BTNF0', 'incoming cannot confirm');
  perform tests.as_user('bob');
  perform tests.throws(format('select public.confirm_testimony_and_approve(tests.actor(), %L, %L)', v_man2, v_rev), 'BTNF0', 'stranger cannot confirm');
  perform tests.as_user('rev');
  perform tests.throws(format('select public.confirm_testimony_and_approve(tests.actor(), %L, %L)', v_man2, gen_random_uuid()), 'BTCF0', 'stale revision refused');
  perform tests.throws(format('select public.confirm_testimony_and_approve(tests.actor(), %L, %L)', tests.id('p_edit'),
                              (select current_revision_id from public.handover_points where id = tests.id('p_edit'))), 'BTIT0', 'approved point refused');
  v_res := public.confirm_testimony_and_approve(tests.actor(), v_man2, v_rev, 'I was there when it was booked.');
  perform tests.as_owner();
  perform tests.eq(v_res ->> 'evidenceStatus', 'sourced', 'confirm: sourced');
  perform tests.eq((select review_state from public.handover_points where id = v_man2), 'approved', 'confirm: approved');
  perform tests.eq((select approved_as_known_gap from public.handover_points where id = v_man2), false, 'confirm: not a known gap');
  perform tests.eq((select verifier_provenance ->> 'kind' from public.point_evidence where id = pg_temp.link_of('p_man2')), 'reviewer_confirmation',
                   'confirm: provenance says a reviewer confirmed it');
  perform tests.ok(exists (select 1 from public.review_actions where point_id = v_man2 and action = 'approve'
                            and (metadata ->> 'confirmedTestimony')::boolean and actor_profile_id = tests.id('rev')), 'confirm: history');
  perform tests.ok(not (pg_temp.link_of('p_man2') = any (pg_temp.queued())), 'confirmed testimony is not queued again');

  -- a point without testimony cannot be confirmed this way
  perform tests.point('h', 'p_plain');
  perform tests.as_user('rev');
  perform tests.throws(format('select public.confirm_testimony_and_approve(tests.actor(), %L, %L)', tests.id('p_plain'),
                              (select current_revision_id from public.handover_points where id = tests.id('p_plain'))), 'BTPF0', 'no testimony refused');
  perform tests.as_owner();
end $$;

-- browser role has no EXECUTE on the mutation
do $$
begin
  perform tests.as_reader('ann');
  perform tests.throws(format('select public.confirm_testimony_and_approve(%L, %L, %L)', tests.id('ann'), tests.id('p_plain'), gen_random_uuid()),
                       '42501', 'browser cannot call confirm_testimony_and_approve');
  perform tests.as_owner();
end $$;

-- ── v2 and the version history ───────────────────────────────────────────────
do $$
declare
  v_rev uuid;
begin
  perform tests.as_user('ann');
  -- decide the conflicting point
  select current_revision_id into v_rev from public.handover_points where id = tests.id('p_src');
  perform public.approve_point(tests.actor(), tests.id('p_src'), v_rev, false, 'The new version is right; v1 wording kept for history', false);
  perform public.reject_point(tests.actor(), tests.id('p_plain'), 'empty');
  perform tests.put('pub2', public.publish_handover(tests.actor(), tests.id('h'), 'v2'));
  perform tests.as_owner();
end $$;

do $$
declare
  v jsonb;
  v1 jsonb;
begin
  perform tests.as_user('inc');
  v := tests.read(format('select public.api_list_publication_versions(%L)', tests.id('h')));
  perform tests.eq(jsonb_array_length(v), 2, 'versions: incoming sees both versions');
  perform tests.eq((v -> 0 ->> 'version')::int, 2, 'versions: newest first');
  perform tests.eq((v -> 0 ->> 'is_current')::boolean, true, 'versions: v2 is current');
  perform tests.eq((v -> 1 ->> 'is_current')::boolean, false, 'versions: v1 is not current');
  v1 := tests.read(format('select public.api_get_publication_version(%L, 1)', tests.id('h')));
  perform tests.eq(v1 ->> 'publication_id', tests.id('pub1')::text, 'v1 readable by the incoming member');
  perform tests.ok(v1::text like '%Mrs Kapoor runs the Dean office%', 'v1 keeps the manual point as published');
  perform tests.ok(v1::text not like '%Sharma Travels%', 'v1 does not contain v2-only points');
  perform tests.ok(tests.read(format('select public.api_get_publication_version(%L, 9)', tests.id('h'))) is null, 'unknown version: null');
  perform tests.as_user('bob');
  perform tests.eq(jsonb_array_length(tests.read(format('select public.api_list_publication_versions(%L)', tests.id('h')))), 0,
                   'versions: a stranger sees none');
  perform tests.ok(tests.read(format('select public.api_get_publication_version(%L, 1)', tests.id('h'))) is null, 'v1: a stranger reads nothing');
  perform tests.as_owner();
  -- v1 preserved: the manual and edited points are still facts in v2 (not open questions)
  perform tests.ok(exists (select 1 from public.publication_points where publication_id = tests.id('pub2') and point_id = tests.id('p_man')
                             and not (content ->> 'isKnownGap')::boolean), 'v2 keeps the manual point as a fact');
  perform tests.ok(exists (select 1 from public.publication_points where publication_id = tests.id('pub2') and point_id = tests.id('p_edit')
                             and not (content ->> 'isKnownGap')::boolean), 'v2 keeps the edited point as a fact');
  perform tests.eq((select count(*) from public.publication_points where publication_id = tests.id('pub1')), 3::bigint, 'v1 snapshot unchanged');
end $$;
