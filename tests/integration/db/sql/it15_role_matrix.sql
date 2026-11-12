-- IT-15 (Round 3, F3/B1/B5): the §8.2 permission table as an executable matrix.
--
-- Every sensitive server function is called by six personas against the SAME state (each call runs inside a
-- subtransaction that is always rolled back, so one persona's success never changes what the next one sees):
--   ann  creator (her own member row is `reviewer`, so creator authority comes only from created_by)
--   out  outgoing member who is NOT the creator (reviews, manages sources, never publishes/invites)
--   rev  reviewer          lead  lead          inc  incoming          eve  not a member at all
-- Expectations come from docs/architecture/shared-contracts.md §8.2. A refused in-handover persona must get
-- forbidden (BTFB0) or not_found (BTNF0); a non-member must get exactly not_found (§8.5: indistinguishable
-- from a missing id). An allowed persona must get through the permission gate ('gate') or fully succeed
-- ('ok'). All failures are collected and reported together.
--
-- Also: the Storage INSERT policy for signed uploads (can_upload_source_object), read-side source access,
-- the incoming member's own authenticated view (B1), and what happens to every persona after delete_handover.
\set ON_ERROR_STOP 1

-- helpers it.gate_as / it.gate_reader / it.judge live in tests/integration/db/helpers.sql

-- ── fixtures ─────────────────────────────────────────────────────────────────

select tests.user(u) from unnest(array['ann', 'out', 'rev', 'lead', 'inc', 'eve']) u;

-- h: in review, with a source, a supported point, a conflicting point, a gap question with an answer, a
-- Gap Interview link, an uploaded raw source and two pending uploads (one per source manager).
select tests.handover('h', 'ann', 'reviewer');
select tests.member('h', 'out', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'lead', 'lead');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's_all', 'everyone');
select tests.point('h', 'p1');
select tests.cite('p1', 's_all', 'alice', 1, 'supports', 'exact', 'pe1');
select tests.point('h', 'p_conf');
select tests.cite('p_conf', 's_all', 'alice', 2, 'supports', 'exact', 'pc1');
select tests.cite('p_conf', 's_all', 'bob', 1, 'contradicts', 'exact', 'pc2');
select it.raw_source('h', 'r1');
select tests.set_state('h', 'in_review');

select tests.as_user('ann');
select tests.put('s_pend_ann', public.create_source(tests.actor(), tests.id('h'), 'whatsapp_export', 'pending-ann.txt', 'text/plain', 100, repeat('c', 64)));
select tests.put('q1', public.create_gap_question(tests.actor(), tests.id('h'), null, 'owner', 'Who holds the keys?', null, 'optional', 'everyone', tests.id('h/inc')));
select tests.put('tok1', public.create_gap_interview_link(tests.actor(), tests.id('h'), sha256('it15-tok1'::bytea), array[tests.id('q1')], 'everyone', now() + interval '1 day', 20));
select public.offer_creator_transfer(tests.actor(), tests.id('h'), tests.id('h/out'));
select tests.as_user('out');
select tests.put('s_pend_out', public.create_source(tests.actor(), tests.id('h'), 'whatsapp_export', 'pending-out.txt', 'text/plain', 100, repeat('d', 64)));
select tests.as_user('inc');
select public.submit_gap_answers(tests.actor(), jsonb_build_array(jsonb_build_object('gapQuestionId', tests.id('q1'), 'answerText', 'The treasurer')));
select tests.as_owner();
select tests.put('a1', (select id from public.gap_answers where gap_question_id = tests.id('q1')));

-- hp: published (same people), for acknowledgement, start_revision and the incoming member's view.
select tests.handover('hp', 'ann', 'reviewer');
select tests.member('hp', 'out', 'outgoing');
select tests.member('hp', 'rev', 'reviewer');
select tests.member('hp', 'lead', 'lead');
select tests.member('hp', 'inc', 'incoming');
select tests.source('hp', 's_hp', 'everyone');
select tests.source('hp', 's_hp_leads', 'leads_only');
select tests.point('hp', 'pp1');
select tests.cite('pp1', 's_hp', 'alice', 1, 'supports', 'exact', 'ppe1');
select tests.point('hp', 'pp_leads');
select tests.cite('pp_leads', 's_hp_leads', 'bob', 1, 'supports', 'exact', 'ppe2');
select tests.set_state('hp', 'in_review');
select tests.approve_all('hp');
select tests.as_user('ann');
select tests.put('pub', public.publish_handover(tests.actor(), tests.id('hp'), 'Published for the incoming member'));
select tests.as_owner();

-- ── the mutation matrix (§8.2) ───────────────────────────────────────────────
do $$
declare
  creator text[] := array['ann'];
  managers text[] := array['ann', 'out'];               -- creator + outgoing: sources, consent, exclusions, processing
  reviewers text[] := array['ann', 'out', 'rev'];        -- review roles
  m record;
  who text;
  failures text[] := '{}';
  f text;
  r text;
  n int := 0;
begin
  for m in
    select * from (values
      -- review actions on points (Creator, Outgoing, Reviewer)
      ('approve_point', format('select public.approve_point(tests.actor(), %L, %L)', tests.id('p1'),
         (select current_revision_id from public.handover_points where id = tests.id('p1'))), reviewers, 'ok'),
      ('reject_point', format('select public.reject_point(tests.actor(), %L, %L)', tests.id('p1'), 'Not accurate'), reviewers, 'ok'),
      ('reopen_point', format('select public.reopen_point(tests.actor(), %L, null)', tests.id('p1')), reviewers, 'gate'),
      ('edit_point', format($q$select public.edit_point(tests.actor(), %L, %L, 'Edited title', 'Edited statement', '{}', 'clarify')$q$,
         tests.id('p1'), (select current_revision_id from public.handover_points where id = tests.id('p1'))), reviewers, 'gate'),
      ('confirm_inferred', format('select public.confirm_inferred(tests.actor(), %L, null)', tests.id('p1')), reviewers, 'gate'),
      ('resolve_conflict', format('select public.resolve_conflict(tests.actor(), %L, %L)', tests.id('p_conf'), 'Bob''s message is older'), reviewers, 'gate'),
      ('exclude_evidence', format('select public.exclude_evidence(tests.actor(), %L, %L, %L)', tests.id('p1'), tests.id('pe1'), 'Off topic'), reviewers, 'ok'),
      ('change_point_access', format('select public.change_point_access(tests.actor(), %L, %L)', tests.id('p1'), 'leads_only'), reviewers, 'gate'),
      ('create_manual_point', format($q$select public.create_manual_point(tests.actor(), %L, 'decision', 'Manual', 'A manual decision', '{}')$q$,
         tests.id('h')), reviewers, 'gate'),
      ('create_gap_question', format($q$select public.create_gap_question(tests.actor(), %L, null, 'owner', 'Another?', null, 'optional')$q$,
         tests.id('h')), reviewers, 'ok'),
      ('create_gap_interview_link', format('select public.create_gap_interview_link(tests.actor(), %L, %L, %L, %L, now() + interval ''1 day'', 5)',
         tests.id('h'), sha256('it15-tok2'::bytea), array[tests.id('q1')], 'everyone'), reviewers, 'ok'),
      ('review_gap_answer', format('select public.review_gap_answer(tests.actor(), %L, %L, null)', tests.id('a1'), 'accept'), reviewers, 'ok'),
      ('revoke_access_token(gap link)', format('select public.revoke_access_token(tests.actor(), %L)', tests.id('tok1')), reviewers, 'ok'),
      -- creator-only authority
      ('invite_member', format('select public.invite_member(tests.actor(), %L, %L, %L, %L, %L, now() + interval ''1 day'')',
         tests.id('h'), 'newcomer@example.test', 'incoming', 'everyone', sha256('it15-inv'::bytea)), creator, 'ok'),
      ('update_member_clearance', format('select public.update_member_clearance(tests.actor(), %L, %L)', tests.id('h/inc'), 'leads_only'), creator, 'ok'),
      ('remove_member', format('select public.remove_member(tests.actor(), %L)', tests.id('h/lead')), creator, 'ok'),
      ('offer_creator_transfer', format('select public.offer_creator_transfer(tests.actor(), %L, %L)', tests.id('h'), tests.id('h/rev')), creator, 'gate'),
      ('publish_handover', format('select public.publish_handover(tests.actor(), %L)', tests.id('h')), creator, 'gate'),
      ('start_revision', format('select public.start_revision(tests.actor(), %L)', tests.id('hp')), creator, 'ok'),
      ('delete_handover', format('select public.delete_handover(tests.actor(), %L)', tests.id('h')), creator, 'ok'),
      ('delete_handover(published)', format('select public.delete_handover(tests.actor(), %L)', tests.id('hp')), creator, 'ok'),
      ('cancel_processing', format('select public.cancel_processing(tests.actor(), %L)', tests.id('h')), creator, 'gate'),
      -- source management (Creator, Outgoing)
      ('create_source', format('select public.create_source(tests.actor(), %L, %L, %L, %L, 10, %L)', tests.id('h'), 'whatsapp_export',
         'another.txt', 'text/plain', repeat('e', 64)), managers, 'ok'),
      ('source_upload_target(own pending)', format('select public.source_upload_target(tests.actor(), %L)', tests.id('s_pend_ann')), managers, 'ok'),
      ('record_source_consent', format('select public.record_source_consent(tests.actor(), %L, %L, %L, %L, %L)', tests.id('r1'), 'v1', 'fake',
         'everyone', 'Asia/Kolkata'), managers, 'gate'),
      ('add_exclusion', format('select public.add_exclusion(p_actor_profile_id => tests.actor(), p_source_id => %L, p_kind => %L, p_conversation_local_id => %L)',
         tests.id('r1'), 'conversation', 'c_1'), managers, 'gate'),
      ('remove_source', format('select public.remove_source(tests.actor(), %L)', tests.id('r1')), managers, 'ok'),
      ('update_handover_details (R3 C1; h is in review, so allowed roles stop at BTIT0)',
         format($q$select public.update_handover_details(tests.actor(), %L, now(), 'Renamed title', 'Renamed team')$q$, tests.id('h')), managers, 'gate'),
      ('start_processing', format($q$select public.start_processing(tests.actor(), %L, 'pipeline@1', '{"provider":"fake"}', '[]')$q$,
         tests.id('h')), managers, 'gate'),
      -- the incoming member's own acts
      ('acknowledge_publication', format('select public.acknowledge_publication(tests.actor(), %L, %L)', tests.id('pub'), 'v1'), array['inc'], 'gate'),
      ('respond_to_creator_transfer(offered to out)', format('select public.respond_to_creator_transfer(tests.actor(), %L, false)', tests.id('h')),
         array['out'], 'ok')
    ) as t (label, sql, allowed, mode)
  loop
    foreach who in array array['ann', 'out', 'rev', 'lead', 'inc', 'eve'] loop
      r := it.gate_as(who, m.sql);
      f := it.judge(m.label, who, r, m.allowed, m.mode);
      if who = any (m.allowed) and r <> 'OK' then
        raise notice 'gate-only: % as % passed the permission gate, then %', m.label, who, r; -- state, not permission
      end if;
      n := n + 1;
      if f is not null then failures := failures || f; end if;
    end loop;
  end loop;
  if cardinality(failures) > 0 then
    raise exception 'ASSERTION FAILED: % of % role-matrix checks:%', cardinality(failures), n, E'\n  ' || array_to_string(failures, E'\n  ');
  end if;
  raise notice 'role matrix: % checks passed', n;
end $$;

-- The matrix rolled everything back: the state is unchanged.
select tests.ok((select deleted_at is null from public.handovers where id = tests.id('h')), 'matrix left h undeleted');
select tests.ok((select deleted_at is null from public.handovers where id = tests.id('hp')), 'matrix left hp undeleted');
select tests.eq((select review_state from public.handover_points where id = tests.id('p1')), 'pending', 'matrix left p1 pending');

-- ── a forged actor never helps: the session subject must equal the actor (H1) ──
do $$
declare
  v text;
begin
  -- rev's session naming ann as the actor of a creator-only call
  perform tests.as_user('rev');
  v := tests.try(format('select public.delete_handover(%L, %L)', tests.id('ann'), tests.id('h')));
  perform tests.as_owner();
  perform tests.eq(v, 'ERR:BTFB0', 'a session for rev cannot delete as ann');
  perform tests.as_user('eve');
  v := tests.try(format('select public.invite_member(%L, %L, %L, %L, %L, %L, now() + interval ''1 day'')', tests.id('ann'), tests.id('h'),
                        'x@example.test', 'incoming', 'everyone', sha256('it15-forged'::bytea)));
  perform tests.as_owner();
  perform tests.eq(v, 'ERR:BTFB0', 'a session for eve cannot invite as ann');
end $$;

-- ── read side: sources and evidence are review-role only (§8.2 "View the review workspace") ──
do $$
declare
  who text;
  vis boolean;
  failures text[] := '{}';
begin
  foreach who in array array['ann', 'out', 'rev', 'lead', 'inc', 'eve'] loop
    perform tests.as_reader(who);
    vis := who in ('ann', 'out', 'rev');
    if (public.api_get_source(tests.id('s_all')) is not null) is distinct from vis then
      failures := failures || format('api_get_source: %s visible=%s', who, not vis);
    end if;
    if (public.api_get_source_message_context(tests.id('pe1')) is not null) is distinct from vis then
      failures := failures || format('api_get_source_message_context: %s visible=%s', who, not vis);
    end if;
    if ((select count(*) from public.sources where handover_id = tests.id('h')) > 0) is distinct from vis then
      failures := failures || format('sources table: %s visible=%s', who, not vis);
    end if;
    if ((select count(*) from public.evidence_quotes where handover_id = tests.id('h')) > 0) is distinct from vis then
      failures := failures || format('evidence_quotes table: %s visible=%s', who, not vis);
    end if;
    if ((select count(*) from public.source_messages where handover_id = tests.id('h')) > 0) is distinct from vis then
      failures := failures || format('source_messages table: %s visible=%s', who, not vis);
    end if;
    if (coalesce(jsonb_array_length(public.api_list_points(tests.id('h'))), 0) > 0) is distinct from vis then
      failures := failures || format('api_list_points: %s visible=%s', who, not vis);
    end if;
    -- raw objects are never readable by any browser session
    if (select count(*) from storage.objects) <> 0 then
      failures := failures || format('storage.objects readable by %s', who);
    end if;
  end loop;
  perform tests.as_owner();
  if cardinality(failures) > 0 then
    raise exception 'ASSERTION FAILED: source access:%', E'\n  ' || array_to_string(failures, E'\n  ');
  end if;
end $$;

-- ── signed upload paths: the Storage INSERT policy (can_upload_source_object) ──
-- Only the user who created a pending source may upload exactly its object, while they still manage sources.
do $$
declare
  v_path_ann text := (select raw_storage_path from public.sources where id = tests.id('s_pend_ann'));
  v_path_out text := (select raw_storage_path from public.sources where id = tests.id('s_pend_out'));
  v_ins text := 'insert into storage.objects (bucket_id, name, metadata) values (%L, %L, ''{"size": 100}'')';
  who text;
  r text;
  failures text[] := '{}';
begin
  perform tests.eq(v_path_ann, 'raw/' || tests.id('h') || '/' || tests.id('s_pend_ann'), 'object path is raw/{handover}/{source}');
  foreach who in array array['ann', 'out', 'rev', 'lead', 'inc', 'eve'] loop
    r := it.gate_reader(who, format(v_ins, 'source-uploads', v_path_ann));
    if (r = 'OK') is distinct from (who = 'ann') then failures := failures || format('upload ann''s pending object as %s: %s', who, r); end if;
    r := it.gate_reader(who, format(v_ins, 'source-uploads', v_path_out));
    if (r = 'OK') is distinct from (who = 'out') then failures := failures || format('upload out''s pending object as %s: %s', who, r); end if;
  end loop;
  -- the uploader cannot use another bucket, another path, a path of an already-uploaded source, or overwrite
  r := it.gate_reader('ann', format(v_ins, 'public-bucket', v_path_ann));
  if r = 'OK' then failures := failures || 'ann uploaded into another bucket'; end if;
  r := it.gate_reader('ann', format(v_ins, 'source-uploads', 'raw/' || tests.id('h') || '/' || gen_random_uuid()));
  if r = 'OK' then failures := failures || 'ann uploaded to an invented path'; end if;
  r := it.gate_reader('ann', format(v_ins, 'source-uploads', (select raw_storage_path from public.sources where id = tests.id('r1'))));
  if r = 'OK' then failures := failures || 'ann overwrote/added the object of an already-uploaded source'; end if;
  r := it.gate_reader('ann', format(v_ins, 'source-uploads', 'raw/' || tests.id('hp') || '/' || tests.id('s_pend_ann')));
  if r = 'OK' then failures := failures || 'ann uploaded the source id under another handover''s prefix'; end if;
  -- a browser session can never update or delete raw objects (no policy): zero rows, whoever asks
  perform tests.as_owner();
  insert into storage.objects (bucket_id, name, metadata) values ('source-uploads', v_path_ann, '{"size": 100}');
  perform tests.as_reader('ann');
  update storage.objects set metadata = '{"size": 1}' where name = v_path_ann;
  delete from storage.objects where name = v_path_ann;
  perform tests.as_owner();
  if (select metadata ->> 'size' from storage.objects where name = v_path_ann) is distinct from '100' then
    failures := failures || 'a browser session changed or deleted a raw object';
  end if;
  delete from storage.objects where name = v_path_ann;
  -- the outgoing member loses upload rights the moment they are removed
  update public.handover_members set removed_at = now() where id = tests.id('h/out');
  r := it.gate_reader('out', format(v_ins, 'source-uploads', v_path_out));
  if r = 'OK' then failures := failures || 'a removed outgoing member could still upload'; end if;
  update public.handover_members set removed_at = null where id = tests.id('h/out');
  if cardinality(failures) > 0 then
    raise exception 'ASSERTION FAILED: storage upload policy:%', E'\n  ' || array_to_string(failures, E'\n  ');
  end if;
end $$;

-- ── B1: the incoming member's own authenticated view ─────────────────────────
do $$
declare
  v jsonb;
begin
  perform tests.as_reader('inc');
  v := public.api_get_published_handover(tests.id('hp'));
  perform tests.ok(v is not null, 'B1: incoming reads the publication of hp');
  perform tests.eq((select array_agg((pt ->> 'id')::uuid) from jsonb_array_elements(v -> 'sections') sec, jsonb_array_elements(sec -> 'points') pt),
                   array[tests.id('pp1')], 'B1: incoming sees only the everyone-level point');
  perform tests.ok(v::text not like '%' || encode(sha256(convert_to('alice', 'UTF8')), 'hex') || '%', 'B1: no identity hash in the publication');
  perform tests.ok(public.api_get_published_handover(tests.id('h')) is null, 'B1: nothing to read while h is unpublished');
  perform tests.ok(public.api_get_handover(tests.id('hp')) is not null, 'B1: incoming sees the handover summary');
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.api_list_my_handovers()) e where (e ->> 'id')::uuid = tests.id('hp')),
                   'B1: the published handover is on the incoming member''s dashboard');
  perform tests.eq(public.api_list_points(tests.id('hp')), '[]'::jsonb, 'B1: no review workspace for incoming');
  perform tests.ok(public.api_get_readiness(tests.id('hp')) is null, 'B1: no readiness for incoming');
  perform tests.as_reader('lead');
  perform tests.eq((select count(*) from jsonb_array_elements(public.api_get_published_handover(tests.id('hp')) -> 'sections') sec,
                           jsonb_array_elements(sec -> 'points') pt), 2::bigint,
                   'B1 control: lead sees the everyone + leads_only points');
  perform tests.as_reader('eve');
  perform tests.ok(public.api_get_published_handover(tests.id('hp')) is null, 'B1: a non-member reads nothing');
  perform tests.as_owner();
end $$;

-- ── delete_handover for real: afterwards the handover is gone for every persona ──
do $$
declare
  who text;
  r text;
  failures text[] := '{}';
begin
  perform tests.as_user('ann');
  perform public.delete_handover(tests.actor(), tests.id('h'));
  perform tests.as_owner();
  perform tests.ok((select revoked_at is not null from public.access_tokens where id = tests.id('tok1')), 'delete revokes the Gap Interview link');
  foreach who in array array['ann', 'out', 'rev', 'lead', 'inc', 'eve'] loop
    perform tests.as_reader(who);
    if public.api_get_handover(tests.id('h')) is not null then failures := failures || format('%s still reads the deleted handover', who); end if;
    if public.api_get_source(tests.id('s_all')) is not null then failures := failures || format('%s still reads a source of it', who); end if;
    if exists (select 1 from jsonb_array_elements(public.api_list_my_handovers()) e where (e ->> 'id')::uuid = tests.id('h')) then
      failures := failures || format('%s still lists it on the dashboard', who);
    end if;
    perform tests.as_owner();
    r := it.gate_as(who, format('select public.approve_point(tests.actor(), %L, %L)', tests.id('p1'),
                                (select current_revision_id from public.handover_points where id = tests.id('p1'))));
    if r not in ('ERR:BTNF0') then failures := failures || format('%s acting on a point of the deleted handover: %s (expected BTNF0)', who, r); end if;
    r := it.gate_as(who, format('select public.delete_handover(tests.actor(), %L)', tests.id('h')));
    if r not in ('ERR:BTNF0') then failures := failures || format('%s deleting it again: %s (expected BTNF0)', who, r); end if;
    r := it.gate_reader(who, format('insert into storage.objects (bucket_id, name) values (''source-uploads'', %L)',
                                    (select raw_storage_path from public.sources where id = tests.id('s_pend_ann'))));
    if r = 'OK' then failures := failures || format('%s can still upload into the deleted handover', who); end if;
  end loop;
  if cardinality(failures) > 0 then
    raise exception 'ASSERTION FAILED: after delete_handover:%', E'\n  ' || array_to_string(failures, E'\n  ');
  end if;
end $$;

select 'ok' as it15_role_matrix;
