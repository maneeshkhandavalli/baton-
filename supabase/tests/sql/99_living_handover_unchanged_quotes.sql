-- Bug D (browser verification): an approved point whose quote is unchanged in a new version of its source stays
-- approved (20261121200200_living_handover_unchanged_quotes.sql). Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.source('h', 's1');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h');
insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config, created_at, finished_at)
values (tests.id('h'), 'succeeded', array[tests.id('s1')], 'pv-test', 'fake', '{}', clock_timestamp() - interval '1 hour', now());
insert into public.processing_jobs (handover_id, run_id, source_id, stage, status, attempt, input_hash, progress_done, progress_total)
select tests.id('h'), r.id, tests.id('s1'), 'extract', 'succeeded', 1, '\x01', 2, 2
  from public.processing_runs r where r.handover_id = tests.id('h');
select tests.set_state('h', 'in_review');

-- ── helpers ──────────────────────────────────────────────────────────────────
create function pg_temp.queued() returns uuid[] language sql as $$
  select coalesce(array_agg((x ->> 'pointEvidenceId')::uuid), '{}')
    from jsonb_array_elements(public.list_links_needing_support(tests.id('h'), 500)) x
$$;
-- a found quote (the first p_len characters of the message, from p_from) linked to a point
create function pg_temp.quote(p_point text, p_msg uuid, p_from int, p_len int, p_verdict text, p_name text) returns uuid
language plpgsql as $$
declare
  v_q uuid;
  v_link uuid;
begin
  insert into public.evidence_quotes (handover_id, kind, source_id, source_message_id, quote_text, quote_start, quote_end,
                                      message_sent_at, author_label, author_identity_kind, author_identity_hash,
                                      author_identity_pepper_version, source_title, location, quote_check, access_level)
  select m.handover_id, 'source_quote', m.source_id, m.id, substr(m.body, p_from + 1, p_len), p_from, p_from + p_len, m.sent_at,
         sp.display_label, sp.identity_kind, sp.identity_hash, sp.identity_pepper_version, s.title, m.location, 'exact', s.access_level
    from public.source_messages m join public.sources s on s.id = m.source_id
    left join public.source_participants sp on sp.id = m.participant_id
   where m.id = p_msg
  returning id into v_q;
  insert into public.point_evidence (handover_id, point_id, evidence_id)
  select handover_id, id, v_q from public.handover_points where id = tests.id(p_point)
  returning id into v_link;
  if p_verdict <> 'unchecked' then
    update public.point_evidence
       set support_verdict = p_verdict, verified_revision_id = (select current_revision_id from public.handover_points where id = tests.id(p_point)),
           verifier_provenance = '{"provider":"fake"}', verified_at = now()
     where id = v_link;
  end if;
  return tests.put(p_name, v_link);
end $$;
create function pg_temp.v2msg(p_author text, p_n int) returns uuid language sql as $$
  select m.id from public.source_messages m join public.source_participants sp on sp.id = m.participant_id
   where m.source_id = tests.id('s2') and sp.local_id = 'p_' || p_author and m.seq = (
     select m1.seq from public.source_messages m1 where m1.id = tests.msg('s1', p_author, p_n))
$$;
create function pg_temp.verdict(p_link text, p_verdict text) returns void language sql as $$
  select public.record_support_verdict(tests.id(p_link), p.current_revision_id, p_verdict, 'test', '{"provider":"fake"}',
                                       sha256(convert_to(q.quote_text, 'UTF8')))
    from public.point_evidence pe join public.handover_points p on p.id = pe.point_id
    join public.evidence_quotes q on q.id = pe.evidence_id
   where pe.id = tests.id(p_link)
$$;
create function pg_temp.state(p text) returns text language sql as $$
  select evidence_status || '/' || review_state from public.handover_points where id = tests.id(p)
$$;

-- ── the normalisation helper ─────────────────────────────────────────────────
do $$
begin
  perform tests.eq(public._quote_match_norm(E'  It’s  the “main”\n hall – final​ '), $q$It's the "main" hall - final$q$,
                   'norm: curly quotes, dashes, format characters and whitespace');
  perform tests.eq(public._quote_match_norm('Case Kept'), 'Case Kept', 'norm: case preserved (as the quote checker)');
end $$;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_function_privilege(r, 'public._quote_match_norm(text)', 'EXECUTE')
                     and not has_function_privilege(r, 'public._source_quote_unchanged_from_earlier_version(uuid)', 'EXECUTE'),
                     r || ': helpers not executable');
  end loop;
end $$;

-- ── v1: an edited point, a plain point, a point whose sentence will change, a pending point ─────────────
select tests.point('h', 'p_edit', 'owner');
select tests.point('h', 'p_src');
select tests.point('h', 'p_chg');
select tests.point('h', 'p_pend');
select tests.point('h', 'p_excl');
select pg_temp.quote('p_edit', tests.msg('s1', 'alice', 1), 0, 30, 'supports', 'e1');  -- "Alice message 1 about the bank"
select pg_temp.quote('p_src', tests.msg('s1', 'bob', 1), 0, 28, 'supports', 's1q');
select pg_temp.quote('p_chg', tests.msg('s1', 'carol', 1), 0, 28, 'supports', 'c1');
select pg_temp.quote('p_pend', tests.msg('s1', 'alice', 2), 0, 28, 'supports', 'pd1');
select pg_temp.quote('p_excl', tests.msg('s1', 'bob', 2), 0, 28, 'supports', 'x1');
do $$
declare
  v_rev uuid;
begin
  perform tests.as_user('ann');
  select current_revision_id into v_rev from public.handover_points where id = tests.id('p_edit');
  perform public.edit_point(tests.actor(), tests.id('p_edit'), v_rev, 'Bank handover owner', 'Alice owns the bank handover now',
                            '{"responsibility":"Bank"}'::jsonb, 'clearer');
  perform tests.as_owner();
  perform tests.eq(pg_temp.state('p_edit'), 'inferred/pending', 'setup: the edited point is inferred (its quote checked the old wording)');
end $$;
-- approve everything except p_pend (the inferred, edited point is approved with a recorded confirmation)
update public.handover_points set review_state = 'rejected' where id = tests.id('p_pend');
select tests.approve_all('h');
update public.handover_points set review_state = 'pending' where id = tests.id('p_pend');
do $$
begin
  perform tests.eq(pg_temp.state('p_edit'), 'inferred/approved', 'setup: edited point approved');
  perform tests.eq(pg_temp.state('p_src'), 'sourced/approved', 'setup: plain point approved');
  perform tests.eq(pg_temp.state('p_pend'), 'sourced/pending', 'setup: pending point');
  -- the v1 quote of p_excl is excluded by a reviewer: it is no longer evidence the point stands on
  update public.point_evidence set excluded_at = now(), excluded_by = tests.id('ann'), exclusion_reason = 'not about this'
   where id = tests.id('x1');
  perform tests.eq(cardinality(pg_temp.queued()), 0, 'setup: nothing to verify before the new version');
end $$;

-- ── v2: the same chat, carol's first message changed ─────────────────────────
create function tests.hx(p_char text) returns text language sql immutable as $$ select repeat(p_char, 64) $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
do $$
declare
  v uuid;
begin
  perform tests.as_user('ann');
  v := (public.create_source_version(tests.actor(), tests.id('s1'), 'whatsapp_export', 'chat v.txt', 'text/plain', 100, tests.hx('a')) ->> 'source_id')::uuid;
  perform tests.as_owner();
  insert into storage.objects (bucket_id, name, metadata)
  select 'source-uploads', raw_storage_path, '{"size": 100}' from public.sources where id = v;
  perform tests.as_user('ann');
  perform public.confirm_source_uploaded(tests.actor(), v, 100, tests.hx('a'));
  perform public.record_source_consent(tests.actor(), v, 'consent@1', 'fake', 'everyone', 'Asia/Kolkata');
  perform tests.as_owner();
  perform tests.put('s2', v);
  perform tests.eq((select version_number from public.sources where id = v), 2, 'setup: v2 is current');
  insert into public.source_participants (handover_id, source_id, local_id, display_label, identity_kind, identity_hash, identity_pepper_version, message_count)
  select handover_id, v, local_id, display_label, identity_kind, identity_hash, identity_pepper_version, message_count
    from public.source_participants where source_id = tests.id('s1');
  insert into public.source_messages (handover_id, source_id, participant_id, seq, sent_at, kind, body, body_sha256)
  select m.handover_id, v, p2.id, m.seq, m.sent_at, m.kind,
         case when m.id = tests.msg('s1', 'carol', 1) then 'Carol message 1 now says the locker account moved to Ravi' else m.body end,
         sha256(convert_to(m.body || 'v2', 'UTF8'))
    from public.source_messages m
    join public.source_participants p1 on p1.id = m.participant_id
    join public.source_participants p2 on p2.source_id = v and p2.local_id = p1.local_id
   where m.source_id = tests.id('s1');
end $$;

-- the re-extraction of v2 attaches its citations to the existing points (lib/pipeline/dedup.ts), unchecked
select pg_temp.quote('p_edit', pg_temp.v2msg('alice', 1), 0, 30, 'unchecked', 'e2');       -- same passage
select pg_temp.quote('p_edit', pg_temp.v2msg('alice', 1), 6, 26, 'unchecked', 'e2span');   -- another span of the unchanged message
select pg_temp.quote('p_src', pg_temp.v2msg('bob', 1), 0, 28, 'unchecked', 's2q');
select pg_temp.quote('p_chg', pg_temp.v2msg('carol', 1), 0, 40, 'unchecked', 'c2');        -- the changed sentence
select pg_temp.quote('p_pend', pg_temp.v2msg('alice', 2), 0, 28, 'unchecked', 'pd2');
select pg_temp.quote('p_src', pg_temp.v2msg('carol', 2), 0, 28, 'unchecked', 's2other');   -- unchanged, but a message p_src never cited
select pg_temp.quote('p_excl', pg_temp.v2msg('bob', 2), 0, 28, 'unchecked', 'x2');         -- its v1 link was excluded

do $$
declare
  q uuid[] := pg_temp.queued();
begin
  perform tests.eq(pg_temp.state('p_edit'), 'inferred/approved', 'attaching unchanged evidence does not reopen the edited point');
  perform tests.ok(public._source_quote_unchanged_from_earlier_version(tests.id('e2')), 'helper: same passage is unchanged');
  perform tests.ok(not public._source_quote_unchanged_from_earlier_version(tests.id('c2')), 'helper: changed sentence is not');
  perform tests.ok(not public._source_quote_unchanged_from_earlier_version(tests.id('e1')), 'helper: a v1 quote has no earlier version');
  perform tests.ok(public.link_in_reverify_scope('approved', 'source_quote', 'unchecked'),
                   'the 20261121200100 rule alone queues a new unchecked quote (the bug: e2 was re-verified)');
  perform tests.ok(not (tests.id('e2') = any (q)), 'approved edited point: unchanged quote is not re-verified');
  perform tests.ok(not (tests.id('e2span') = any (q)), 'approved edited point: another span of the unchanged message is not re-verified');
  perform tests.ok(not (tests.id('s2q') = any (q)), 'approved point: unchanged quote is not re-verified');
  perform tests.ok(tests.id('c2') = any (q), 'approved point: the changed sentence IS verified');
  perform tests.ok(tests.id('pd2') = any (q), 'pending point: verified as before');
  perform tests.ok(tests.id('s2other') = any (q), 'a passage from a message the point never cited is new evidence');
  perform tests.ok(tests.id('x2') = any (q), 'an excluded earlier link does not make a quote unchanged');
end $$;

-- the worker verifies what it was given; a real contradiction from the changed source still reopens its point
do $$
begin
  perform pg_temp.verdict('c2', 'contradicts');
  perform pg_temp.verdict('pd2', 'supports');
  perform pg_temp.verdict('s2other', 'supports');
  perform pg_temp.verdict('x2', 'supports');
  perform tests.eq(pg_temp.state('p_chg'), 'conflicting/pending', 'changed sentence contradicts: reopened');
  perform tests.eq(pg_temp.state('p_edit'), 'inferred/approved', 'edited point stays approved');
  perform tests.eq(pg_temp.state('p_src'), 'sourced/approved', 'plain point stays approved');
  perform tests.ok(not exists (select 1 from public.review_actions where point_id in (tests.id('p_edit'), tests.id('p_src')) and action = 'auto_reopen'),
                   'no auto_reopen for the unchanged points');
  perform tests.ok(exists (select 1 from public.review_actions where point_id = tests.id('p_chg') and action = 'auto_reopen'),
                   'auto_reopen recorded for the changed one');
  perform tests.eq(cardinality(pg_temp.queued()), 0, 'nothing left to verify');
end $$;

-- the old behaviour, for contrast: had the unchanged quote been verified, the edited point would have been reopened
-- (inferred -> sourced). A point that is pending again (any reason) is verified as before.
do $$
begin
  update public.handover_points set review_state = 'pending' where id = tests.id('p_edit');
  perform tests.ok(tests.id('e2') = any (pg_temp.queued()), 'pending again: the unchanged quote is verified');
end $$;
