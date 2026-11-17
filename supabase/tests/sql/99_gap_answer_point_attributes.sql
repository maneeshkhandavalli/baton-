-- R3 Task 04: an accepted Gap Interview answer never creates an invalid typed point
-- (migration 20261117400100_gap_answer_point_attributes).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's');
select tests.set_state('h', 'in_review');
select tests.point('h', 'pA'); select tests.cite('pA', 's', 'alice', 1);

create function tests.ask(p_name text, p_category text, p_question text, p_answer text, p_point text default null) returns void
language plpgsql as $$
declare v_q uuid;
begin
  perform tests.as_user('rev');
  v_q := public.create_gap_question(tests.actor(), tests.id('h'), case when p_point is null then null else tests.id(p_point) end,
                                    case when p_point is null then p_category end, p_question, null, 'required');
  perform public.submit_gap_answers(tests.actor(), jsonb_build_array(jsonb_build_object('gapQuestionId', v_q, 'answerText', p_answer)));
  perform tests.as_owner();
  perform tests.put('q_' || p_name, v_q);
  perform tests.put('a_' || p_name, (select id from public.gap_answers where gap_question_id = v_q));
end $$;

select tests.ask('bank',   'account_access', 'Who holds the bank or UPI account, and how is access handed over?', 'Ravi holds it; the passbook is in the office.');
select tests.ask('budget', 'owner',          'Who is responsible for the budget and reimbursements?',             'The treasurer, currently Ravi.');
select tests.ask('merch',  'owner',          'Who runs the merch stall?',                                          'Priya runs it with two volunteers.');
select tests.ask('faculty','contact',        'Who is the faculty or administration contact, and how are they best reached?', 'Prof. Rao in the admin block, by email.');
select tests.ask('canva',  'account_access', 'Where is the design tool login kept?',                                'In the shared password manager.');
select tests.ask('tasks',  'open_task',      'Which tasks are still open, and who should pick them up?',            'The sponsor deck is unfinished.');
select tests.ask('linked', 'owner',          'Who confirmed A?',                                                    'Kabir confirmed it.', 'pA');

create function tests.attrs(p_q text) returns jsonb language sql as $$
  select r.attributes from public.gap_questions q join public.handover_points p on p.id = q.point_id
    join public.point_revisions r on r.id = p.current_revision_id where q.id = tests.id(p_q)
$$;
grant execute on function tests.attrs(text) to authenticated, service_role;

-- ── 1. Checklist questions that name their subject: the attribute comes from the question ───────────────
do $$
begin
  perform tests.as_user('rev');
  perform public.review_gap_answer(tests.actor(), tests.id('a_bank'), 'accept');
  perform public.review_gap_answer(tests.actor(), tests.id('a_budget'), 'accept');
  perform tests.as_owner();
  perform tests.eq(tests.attrs('q_bank'), '{"system": "Bank or UPI account"}'::jsonb, 'account_access: system from the question');
  perform tests.eq(tests.attrs('q_budget'), '{"responsibility": "Budget and reimbursements"}'::jsonb, 'owner: responsibility from the question');
  perform tests.eq((select status from public.gap_questions where id = tests.id('q_bank')), 'answered', 'question answered');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'point.created'
                             and after ->> 'attributeSource' = 'checklist_question' and after ->> 'requiredAttribute' = 'system'),
                   'the audit says where the attribute came from');
end $$;

-- ── 2. Not enough information: refused, nothing written, answer and gap preserved ───────────────────────
select tests.as_user('rev');
select tests.throws(format('select public.review_gap_answer(%L, %L, %L)', tests.actor(), tests.id('a_merch'), 'accept'), 'BTVF0',
                    'custom owner question without a responsibility: refused');
select tests.throws(format('select public.review_gap_answer(%L, %L, %L)', tests.actor(), tests.id('a_faculty'), 'accept'), 'BTVF0',
                    'a contact NAME is never derived from the question: refused');
select tests.throws(format('select public.review_gap_answer(%L, %L, %L)', tests.actor(), tests.id('a_canva'), 'accept'), 'BTVF0',
                    'custom account question without a system: refused');
select tests.as_owner();
do $$
begin
  perform tests.eq((select status from public.gap_answers where id = tests.id('a_merch')), 'submitted', 'the answer stays submitted');
  perform tests.eq((select status from public.gap_questions where id = tests.id('q_merch')), 'open', 'the gap stays open (still counts as unresolved)');
  perform tests.ok((select point_id from public.gap_questions where id = tests.id('q_merch')) is null, 'no point was created');
  perform tests.eq((select count(*)::int from public.evidence_quotes where gap_answer_id = tests.id('a_merch')), 0, 'no orphan testimony');
end $$;

-- ── 3. The reviewer supplies the detail from the answer: a valid point ─────────────────────────────────────
do $$
begin
  perform tests.as_user('rev');
  perform public.review_gap_answer(tests.actor(), tests.id('a_merch'), 'accept', null, 'Merch stall');
  perform public.review_gap_answer(tests.actor(), tests.id('a_faculty'), 'accept', 'Thanks', 'Prof. Rao');
  perform public.review_gap_answer(tests.actor(), tests.id('a_canva'), 'accept', null, '  Design tool  ');
  perform tests.as_owner();
  perform tests.eq(tests.attrs('q_merch'), '{"responsibility": "Merch stall"}'::jsonb, 'owner: reviewer-supplied responsibility');
  perform tests.eq(tests.attrs('q_faculty'), '{"nameLabel": "Prof. Rao"}'::jsonb, 'contact: reviewer-supplied name');
  perform tests.eq(tests.attrs('q_canva'), '{"system": "Design tool"}'::jsonb, 'account_access: trimmed system');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'point.created' and after ->> 'attributeSource' = 'reviewer'),
                   'reviewer-supplied attribute is audited as such');
end $$;

-- ── 4. Categories without a required attribute and linked questions are unchanged ───────────────────────
do $$
begin
  perform tests.as_user('rev');
  perform public.review_gap_answer(tests.actor(), tests.id('a_tasks'), 'accept');
  perform public.review_gap_answer(tests.actor(), tests.id('a_linked'), 'accept');
  perform tests.as_owner();
  perform tests.eq(tests.attrs('q_tasks'), '{}'::jsonb, 'open_task: no attribute needed (unchanged)');
  perform tests.eq((select point_id from public.gap_questions where id = tests.id('q_linked')), tests.id('pA'), 'linked question: testimony on pA (unchanged)');
end $$;

-- A detail where none applies, or one that is too long, is refused (never silently dropped).
select tests.ask('tasks2', 'open_task', 'Anything else open?', 'The banner order.');
select tests.ask('linked2', 'owner', 'Who confirmed A again?', 'Kabir.', 'pA');
select tests.ask('long', 'owner', 'Who runs the library corner?', 'Asha.');
select tests.as_user('rev');
select tests.throws(format('select public.review_gap_answer(%L, %L, %L, null, %L)', tests.actor(), tests.id('a_tasks2'), 'accept', 'x'), 'BTVF0',
                    'a detail for a category without a required attribute is refused');
select tests.throws(format('select public.review_gap_answer(%L, %L, %L, null, %L)', tests.actor(), tests.id('a_linked2'), 'accept', 'x'), 'BTVF0',
                    'a detail for a question that already has a point is refused');
select tests.throws(format('select public.review_gap_answer(%L, %L, %L, null, %L)', tests.actor(), tests.id('a_long'), 'accept', repeat('x', 201)), 'BTVF0',
                    'a detail over 200 characters is refused');
-- Rejecting needs no detail (unchanged).
select public.review_gap_answer(tests.actor(), tests.id('a_long'), 'reject');
select tests.as_owner();

-- ── 5. Every point created here is readable through api_get_point (the read that used to fail) ─────────
do $$
declare v jsonb;
begin
  perform tests.as_reader('rev');
  for v in select public.api_get_point(q.point_id) from public.gap_questions q
            where q.handover_id = tests.id('h') and q.point_id is not null and q.point_id <> tests.id('pA') loop
    perform tests.ok(v is not null and jsonb_typeof(v -> 'attributes') = 'object', 'api_get_point returns the gap-answer point');
  end loop;
end $$;

-- ── 6. Diagnostic for records created in the old invalid form (read-only, no text) ─────────────────────
do $$
declare v_p uuid; v_r uuid; v_q uuid; n int;
begin
  perform tests.as_owner();
  -- a legacy point, as 20261115100100 created it: owner with '{}' attributes, linked to the checklist question
  insert into public.handover_points (handover_id, category, origin, sort_key) values (tests.id('h'), 'owner', 'gap_answer', 99)
  returning id into v_p;
  insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind, author_profile_id)
  values (tests.id('h'), v_p, 1, 'Legacy', 'Legacy answer', '{}', 'profile', tests.id('rev')) returning id into v_r;
  update public.handover_points set current_revision_id = v_r where id = v_p;
  insert into public.gap_questions (handover_id, point_id, category, question, priority, access_level, status)
  values (tests.id('h'), v_p, 'owner', 'Who is responsible for the budget and reimbursements?', 'required', 'everyone', 'answered');
  perform tests.as_service();
  select count(*)::int into n from public.gap_answer_points_missing_attributes();
  perform tests.eq(n, 1, 'only the legacy invalid point is listed');
  perform tests.ok((select derivable_from_question and review_state = 'pending' and not in_publication
                      from public.gap_answer_points_missing_attributes() where point_id = v_p), 'flags: derivable, pending, unpublished');
  perform tests.as_owner();
end $$;

-- ── grants ────────────────────────────────────────────────────────────────────
do $$
begin
  perform tests.ok(has_function_privilege('service_role', 'public.review_gap_answer(uuid,uuid,text,text,text)', 'execute'), 'service_role reviews with a detail');
  perform tests.ok(not has_function_privilege('authenticated', 'public.review_gap_answer(uuid,uuid,text,text,text)', 'execute'), 'browser cannot');
  perform tests.ok(has_function_privilege('service_role', 'public.review_gap_answer(uuid,uuid,text,text)', 'execute'), '4-argument grant kept');
  perform tests.ok(not has_function_privilege('authenticated', 'public.review_gap_answer(uuid,uuid,text,text)', 'execute'), '4-argument stays server-only');
  perform tests.ok(not has_function_privilege('authenticated', 'public.gap_answer_points_missing_attributes()', 'execute'), 'diagnostic is server-only');
  perform tests.ok(not has_function_privilege('service_role', 'public._checklist_point_detail(text,text)', 'execute'), 'helpers are internal');
end $$;
