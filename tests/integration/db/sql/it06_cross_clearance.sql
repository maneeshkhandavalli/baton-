-- IT-06 (database part): clearance isolation inside one handover and "no indirect hints" (§8.1–§8.5, D3, D13).
-- Points at everyone / leads_only / reviewer_only are published; an incoming member (everyone) and a lead
-- (leads_only) see only what their clearance allows, with no counts, gaps or placeholders for the rest.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'inc', 'lead']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'inc', 'incoming');
select tests.member('h', 'lead', 'lead');
select tests.source('h', 'se', 'everyone');
select tests.source('h', 'sl', 'leads_only');
select tests.source('h', 'sr', 'reviewer_only');

select tests.point('h', 'pe');   select tests.cite('pe', 'se', 'alice', 1);
select tests.point('h', 'pl');   select tests.cite('pl', 'sl', 'alice', 1);
select tests.point('h', 'pr');   select tests.cite('pr', 'sr', 'alice', 1);
select tests.point('h', 'pmix'); select tests.cite('pmix', 'se', 'bob', 1); select tests.cite('pmix', 'sr', 'bob', 1, 'supports', 'exact', 'pmix_r');

-- §8.4: floors follow the most restricted linked evidence
select tests.eq((select access_level from public.handover_points where id = tests.id('pe')), 'everyone', 'floor: everyone');
select tests.eq((select access_level from public.handover_points where id = tests.id('pl')), 'leads_only', 'floor: leads_only');
select tests.eq((select access_level from public.handover_points where id = tests.id('pr')), 'reviewer_only', 'floor: reviewer_only');
select tests.eq((select access_level from public.handover_points where id = tests.id('pmix')), 'reviewer_only', 'floor: mixed → max');

select tests.set_state('h', 'in_review');
select tests.as_user('ann');
-- excluding the restricted link must not downgrade the point (§8.4 "excluded links still count")
select public.exclude_evidence(tests.actor(), tests.id('pmix'), tests.id('pmix_r'), 'not relevant');
select tests.as_owner();
select tests.eq((select access_level from public.handover_points where id = tests.id('pmix')), 'reviewer_only',
                'excluding a restricted link keeps the floor');
select tests.as_user('ann');
select tests.throws(format('select public.change_point_access(%L, %L, %L)', tests.actor(), tests.id('pr'), 'everyone'), 'BTIT0',
                    'access cannot be lowered below the evidence floor');

-- publish (creator) with everything approved
select tests.as_owner();
select tests.approve_all('h');
select tests.as_user('ann');
select tests.put('pub', public.publish_handover(tests.actor(), tests.id('h'), 'Everyone-level summary'));
select tests.as_owner();
select tests.eq((select count(*)::int from public.publication_points where publication_id = tests.id('pub')), 4, 'all four snapshotted');

-- ── what each clearance sees of the publication ──────────────────────────────
create temp table seen (who text, ids text[], doc text);
grant all on seen to authenticated, service_role;

do $$
declare
  v_who text;
  v jsonb;
begin
  foreach v_who in array array['inc', 'lead', 'ann'] loop
    perform tests.as_reader(v_who);
    v := public.api_get_published_handover(tests.id('h'));
    insert into seen values (v_who,
      (select coalesce(array_agg(p ->> 'id' order by p ->> 'id'), '{}') from jsonb_array_elements(v -> 'sections') s,
              jsonb_array_elements(s -> 'points') p),
      v::text);
  end loop;
  perform tests.as_owner();
end $$;

select tests.eq((select ids from seen where who = 'inc'), array[tests.id('pe')::text], 'incoming sees only the everyone point');
select tests.eq((select ids from seen where who = 'lead'),
                (select array_agg(x order by x) from unnest(array[tests.id('pe')::text, tests.id('pl')::text]) x),
                'lead sees everyone + leads_only');
select tests.eq(cardinality((select ids from seen where who = 'ann')), 4, 'the creator sees all four');
-- no indirect hints: the restricted ids, titles and evidence never appear anywhere in the document
select tests.ok((select doc from seen where who = 'inc') !~ (tests.id('pl')::text || '|' || tests.id('pr')::text || '|' || tests.id('pmix')::text
                                                           || '|Title of pl|Title of pr|Title of pmix|Chat sl|Chat sr'),
                'incoming document carries no trace of restricted points or sources');
select tests.ok((select doc from seen where who = 'lead') !~ (tests.id('pr')::text || '|' || tests.id('pmix')::text || '|Title of pr|Chat sr'),
                'lead document carries no trace of reviewer_only points');

-- direct selects and aggregates under RLS
select tests.as_reader('inc');
select tests.eq((select count(*)::int from public.publication_points where handover_id = tests.id('h')), 1, 'incoming: 1 publication row');
select tests.as_reader('lead');
select tests.eq((select count(*)::int from public.publication_points where handover_id = tests.id('h')), 2, 'lead: 2 publication rows');

do $$
declare
  v_who text;
begin
  foreach v_who in array array['inc', 'lead'] loop
    perform tests.as_reader(v_who);
    -- D3: no review workspace for leads or incoming members, and no counts or readiness either
    perform tests.eq(public.api_list_points(tests.id('h')), '[]'::jsonb, v_who || ': listPoints is empty');
    perform tests.eq(public.api_get_readiness(tests.id('h')), null::jsonb, v_who || ': readiness not visible');
    perform tests.eq(public.api_list_sources(tests.id('h')), '[]'::jsonb, v_who || ': no sources');
    perform tests.eq(public.api_list_participants(tests.id('h')), null::jsonb, v_who || ': no participants');
    perform tests.eq(public.api_list_exclusions(tests.id('h')), null::jsonb, v_who || ': no exclusions');
    perform tests.eq(public.list_access_tokens(tests.id('h')), null::jsonb, v_who || ': no links');
    perform it.read_like_missing('select public.api_get_point(%L)', tests.id('pe'), v_who || ': getPoint (even everyone) is not found');
    perform it.read_like_missing('select public.api_get_point(%L)', tests.id('pr'), v_who || ': getPoint restricted is not found');
    perform it.read_like_missing('select public.api_get_source_message_context(%L)', tests.id('pe/alice1'), v_who || ': no message context');
    perform tests.eq((select count(*)::int from public.handover_points), 0, v_who || ': points table empty');
    perform tests.eq((select count(id)::int from public.evidence_quotes), 0, v_who || ': evidence empty');
    perform tests.eq((select count(*)::int from public.source_messages), 0, v_who || ': messages empty');
    perform tests.eq((select count(*)::int from public.audit_logs), 0, v_who || ': audit empty');
    perform tests.eq((select count(*)::int from public.processing_jobs), 0, v_who || ': jobs empty');
    perform tests.ok(not exists (select 1 from public.handover_member_directory where clearance is not null),
                     v_who || ': clearances are shown to the creator only');
  end loop;
  perform tests.as_owner();
end $$;

-- ── review actions by non-review members look exactly like unknown ids ──────
select tests.as_user('lead');
select it.hidden_like_missing(format('select public.reject_point(%L, %%L, %L)', tests.actor(), 'no'), tests.id('pr'), 'BTNF0', 'lead: reject');
select it.hidden_like_missing(format('select public.reopen_point(%L, %%L, null)', tests.actor()), tests.id('pe'), 'BTNF0', 'lead: reopen');
select tests.as_user('inc');
select it.hidden_like_missing(format('select public.change_point_access(%L, %%L, %L)', tests.actor(), 'reviewer_only'), tests.id('pl'),
                              'BTNF0', 'incoming: change access');

-- ── gap questions by clearance (§8.4 table, §8.5) ────────────────────────────
select tests.as_user('ann');
select tests.put('gq_e', public.create_gap_question(tests.actor(), tests.id('h'), null, 'owner', 'Who has the cheque book?', null,
                                                    'optional', 'everyone', tests.id('h/inc')));
select tests.put('gq_l', public.create_gap_question(tests.actor(), tests.id('h'), null, 'owner', 'Who has the bank login?', null,
                                                    'optional', 'leads_only', tests.id('h/inc')));
select tests.put('gq_pr', public.create_gap_question(tests.actor(), tests.id('h'), tests.id('pr'), null, 'Is this still true?', null,
                                                     'optional', 'everyone', tests.id('h/inc')));
select tests.put('gq_pe', public.create_gap_question(tests.actor(), tests.id('h'), tests.id('pe'), null, 'Confirm the owner?', null,
                                                     'optional', 'everyone', tests.id('h/inc')));
select tests.as_owner();
select tests.eq((select access_level from public.gap_questions where id = tests.id('gq_pr')), 'reviewer_only',
                'a question about a point inherits at least the point''s level');

select tests.as_reader('inc');
select tests.eq((select array_agg(q ->> 'id' order by q ->> 'id') from jsonb_array_elements(public.api_list_gap_questions(tests.id('h'))) q),
                (select array_agg(x order by x) from unnest(array[tests.id('gq_e')::text, tests.id('gq_pe')::text]) x),
                'incoming sees only questions within clearance');
select tests.as_user('inc');
select it.hidden_like_missing(format($q$select public.submit_gap_answers(%L, jsonb_build_array(jsonb_build_object('gapQuestionId', %%L, 'answerText', 'x')))$q$,
                                     tests.actor()), tests.id('gq_l'), 'BTNF0', 'incoming: answering a leads_only question = unknown id');
select it.hidden_like_missing(format($q$select public.submit_gap_answers(%L, jsonb_build_array(jsonb_build_object('gapQuestionId', %%L, 'answerText', 'x')))$q$,
                                     tests.actor()), tests.id('gq_pr'), 'BTNF0', 'incoming: answering a reviewer_only question = unknown id');

-- Gap Interview links are capped by max_access_level
select tests.as_user('ann');
select tests.throws(format('select public.create_gap_interview_link(%L, %L, %L, array[%L, %L]::uuid[], %L, %L, 20)', tests.actor(), tests.id('h'),
                           sha256('it06-bad'::bytea), tests.id('gq_e'), tests.id('gq_l'), 'everyone', now() + interval '1 day'),
                    'BTVF0', 'a link cannot include a question above its level');
select tests.put('tok', public.create_gap_interview_link(tests.actor(), tests.id('h'), sha256('it06-tok'::bytea),
                                                         array[tests.id('gq_e'), tests.id('gq_pe')], 'everyone', now() + interval '1 day', 20));

-- ── privacy-held content vanishes without a placeholder (§5.5, §8.5) ─────────
-- (simulates what erase_participant does for a partly affected point, under its transaction-local flag)
select tests.as_owner();
begin;
select set_config('baton.erasure', 'on', true);
select public._flag_point_for_privacy(tests.id('pe'), 'it06');
commit;
select tests.as_reader('inc');
select tests.eq(public.api_get_published_handover(tests.id('h')) -> 'sections', '[]'::jsonb,
                'incoming: the held point vanishes and its empty category is omitted');
select tests.eq((select array_agg(q ->> 'id') from jsonb_array_elements(public.api_list_gap_questions(tests.id('h'))) q),
                array[tests.id('gq_e')::text], 'incoming: the held point''s question vanishes');
select tests.as_service();
select tests.eq((select array_agg(q ->> 'id') from jsonb_array_elements(public.get_gap_interview(sha256('it06-tok'::bytea)) -> 'questions') q),
                array[tests.id('gq_e')::text], 'token: the held question vanishes');
select it.hidden_like_missing(format($q$select public.submit_gap_answers_with_token(%L, 'Visitor',
                                          jsonb_build_array(jsonb_build_object('gapQuestionId', %%L, 'answerText', 'x')))$q$,
                                     sha256('it06-tok'::bytea)), tests.id('gq_pe'), 'BTNF0', 'token: a held question = unknown id');
select tests.as_owner();
