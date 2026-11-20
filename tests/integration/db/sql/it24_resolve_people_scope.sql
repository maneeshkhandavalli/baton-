-- IT-24 (Round 4 final fix, audit S6 / 3.8): resolve_handover_people returns only the identities each member
-- needs (migration 20261121100100_resolve_people_scope.sql). By role:
--   * creator and reviewer (review roles): participants of parsed person_v1 sources within their clearance,
--     minus excluded people;
--   * incoming member and lead: only people named in publication points they can see (non-redacted
--     publication, within clearance, not redacted, not privacy-held) or in gap questions assigned to them;
--   * a stranger, an unknown or a deleted handover: not_found;
--   * an excluded participant is never resolved for anyone.
\set ON_ERROR_STOP 1

select tests.user('ann');   -- creator (outgoing)
select tests.user('rev');   -- reviewer
select tests.user('ivy');   -- incoming (everyone)
select tests.user('lee');   -- lead (leads_only)
select tests.user('str');   -- stranger
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'ivy', 'incoming');
select tests.member('h', 'lee', 'lead');

-- Two pseudonymised sources: s1 for everyone (PERSON_1..3 plus PERSON_7), s2 reviewer-only (PERSON_4..6).
select tests.as_owner();
select tests.source('h', 's1', 'everyone', 'name');
select tests.source('h', 's2', 'reviewer_only', 'name');
update public.sources set identity_scheme = 'person_v1' where id in (tests.id('s1'), tests.id('s2'));
-- Fixture only: relabel as the pseudonymising parser would have (the guard trigger allows owner updates under
-- the erasure flag; the identity columns are unchanged).
do $$
begin
  perform set_config('baton.erasure', 'on', true);
  update public.source_participants sp
     set display_label = '[PERSON_' || (case sp.local_id when 'p_alice' then 1 when 'p_bob' then 2 else 3 end
                                         + case when sp.source_id = tests.id('s2') then 3 else 0 end) || ']'
   where sp.source_id in (tests.id('s1'), tests.id('s2'));
  update public.source_participants set excluded = true where source_id = tests.id('s1') and local_id = 'p_carol';  -- PERSON_3
end $$;
insert into public.source_participants (handover_id, source_id, local_id, display_label, identity_kind, identity_hash, identity_pepper_version, message_count)
values (tests.id('h'), tests.id('s1'), 'p_dan', '[PERSON_7]', 'name', sha256(convert_to('dan', 'UTF8')), 'p1', 1);
insert into public.handover_people (handover_id, ordinal, person_key, sealed_label, key_version)
select tests.id('h'), g, sha256(convert_to('person' || g, 'UTF8')), convert_to(repeat('s', 40), 'UTF8'), 'k1'
  from generate_series(1, 9) g;
-- PERSON_8 and PERSON_9 are only MENTIONED (Round 4 name detection): vault entries with no participant row.
-- PERSON_8 is named in a message of the everyone source; PERSON_9 appears nowhere anyone can read.
insert into public.source_messages (handover_id, source_id, participant_id, seq, sent_at, kind, body, body_sha256)
select tests.id('h'), tests.id('s1'), sp.id, 100, timestamptz '2026-06-20', 'text', 'Ask [PERSON_8] about the spare keys',
       sha256(convert_to('mention-8', 'UTF8'))
  from public.source_participants sp where sp.source_id = tests.id('s1') and sp.local_id = 'p_alice';

-- Before anything is published, a non-review member resolves nobody (not even mention-only people).
select tests.as_service();
select tests.eq(public.resolve_handover_people(tests.id('ivy'), tests.id('h')), '[]'::jsonb, 'incoming: nothing before publication');
select tests.eq(public.resolve_handover_people(tests.id('lee'), tests.id('h')), '[]'::jsonb, 'lead: nothing before publication');

-- Points (unpublished text mentions PERSON_2: never counts for non-review members).
select tests.as_owner();
select tests.point('h', 'p1');
select tests.point('h', 'p2');
select tests.point('h', 'p3');
select tests.point('h', 'p4');
select tests.point('h', 'p5');
select tests.point('h', 'p6');

insert into public.handover_publications (handover_id, version, published_by)
values (tests.id('h'), 1, tests.id('ann')) returning tests.put('pub1', id);
insert into public.publication_points (handover_id, publication_id, point_id, revision_id, category, evidence_status, access_level, content, privacy_hold)
select tests.id('h'), tests.id('pub1'), p.id, p.current_revision_id, 'decision', 'sourced', v.access, v.content::jsonb, v.held
  from (values
    ('p1', 'everyone',      '{"statement":"[PERSON_1] holds the keys; [PERSON_8] has the spare","evidence":[{"authorLabel":"[PERSON_1]"}]}', false),
    ('p2', 'reviewer_only', '{"statement":"[PERSON_2] knows the vendor"}', false),
    ('p3', 'everyone',      '{"statement":"Ask [PERSON_3] about it"}', false),        -- PERSON_3 is excluded
    ('p4', 'everyone',      '{"statement":"[PERSON_2] signs cheques"}', true),        -- privacy-held
    ('p5', 'leads_only',    '{"statement":"[PERSON_7] owns payroll; [PERSON_99] is unknown"}', false)
  ) as v(name, access, content, held)
  join public.handover_points p on p.id = tests.id(v.name);

create temp table got (who text, ordinals int[]);
grant all on got to service_role;
select tests.as_service();
do $$
declare
  w text;
begin
  foreach w in array array['ann', 'rev', 'ivy', 'lee'] loop
    insert into got select w, coalesce((select array_agg((e ->> 'ordinal')::int order by (e ->> 'ordinal')::int)
                                          from jsonb_array_elements(public.resolve_handover_people(tests.id(w), tests.id('h'))) e), '{}');
  end loop;
end $$;
select tests.eq((select ordinals from got where who = 'ann'), array[1, 2, 4, 5, 6, 7, 8],
                'creator: every non-excluded participant within clearance, plus the mention-only PERSON_8 named in a readable message');
select tests.eq((select ordinals from got where who = 'rev'), array[1, 2, 4, 5, 6, 7, 8], 'reviewer: same as the creator');
select tests.eq((select ordinals from got where who = 'ivy'), array[1, 8], 'incoming: only PERSON_1 and PERSON_8, named in a visible published point');
select tests.eq((select ordinals from got where who = 'lee'), array[1, 7, 8], 'lead: also the leads_only point''s PERSON_7');
select tests.ok(not exists (select 1 from got where 9 = any (ordinals)), 'a mention-only person named nowhere readable is resolved for nobody');
select tests.ok(not exists (select 1 from got where 3 = any (ordinals)), 'the excluded PERSON_3 is resolved for nobody');
select tests.ok(not exists (select 1 from got where who in ('ivy', 'lee') and 2 = any (ordinals)),
                'reviewer-only, privacy-held and unpublished mentions (PERSON_2) stay hidden from non-review members');
select tests.ok((select count(*) from jsonb_array_elements(public.resolve_handover_people(tests.id('ivy'), tests.id('h'))) e
                  where e ? 'sealed' and e ? 'personKey' and e ? 'keyVersion') = 2, 'the shape is unchanged (sealed label for server-side decryption)');
select tests.throws(format('select public.resolve_handover_people(%L, %L)', tests.id('str'), tests.id('h')), 'BTNF0', 'stranger: not_found');
select tests.throws(format('select public.resolve_handover_people(%L, %L)', tests.id('ivy'), gen_random_uuid()), 'BTNF0', 'unknown handover: not_found');

-- A gap question assigned to the incoming member that names PERSON_2 makes PERSON_2 resolvable for them only.
select tests.as_owner();
insert into public.gap_questions (handover_id, assigned_member_id, question, priority, access_level)
values (tests.id('h'), tests.id('h/ivy'), 'What did [PERSON_2] agree with the bank?', 'required', 'everyone');
select tests.as_service();
select tests.eq((select array_agg((e ->> 'ordinal')::int order by (e ->> 'ordinal')::int)
                   from jsonb_array_elements(public.resolve_handover_people(tests.id('ivy'), tests.id('h'))) e),
                array[1, 2, 8], 'incoming: a gap question assigned to them adds the person it names');
select tests.eq((select array_agg((e ->> 'ordinal')::int order by (e ->> 'ordinal')::int)
                   from jsonb_array_elements(public.resolve_handover_people(tests.id('lee'), tests.id('h'))) e),
                array[1, 7, 8], 'lead: another member''s question adds nothing');
select tests.as_owner();
update public.gap_questions set status = 'answered' where handover_id = tests.id('h');
select tests.as_service();
select tests.eq((select array_agg((e ->> 'ordinal')::int order by (e ->> 'ordinal')::int)
                   from jsonb_array_elements(public.resolve_handover_people(tests.id('ivy'), tests.id('h'))) e),
                array[1, 8], 'an answered (no longer visible) question no longer adds anyone');

-- A source moved out of the member's clearance removes the name even if published text still mentions it.
select tests.as_owner();
update public.sources set access_level = 'reviewer_only' where id = tests.id('s1');
select tests.as_service();
select tests.eq((select array_agg((e ->> 'ordinal')::int) from jsonb_array_elements(public.resolve_handover_people(tests.id('ivy'), tests.id('h'))) e),
                array[8], 'a token in published text never widens the source clearance rule for a sender (PERSON_1 hidden; mention-only PERSON_8 stays)');
select tests.as_owner();
update public.sources set access_level = 'everyone' where id = tests.id('s1');

-- A redacted publication contributes nothing.
do $$ begin
  perform set_config('baton.erasure', 'on', true);  -- fixture: the erasure path is the one that redacts
  update public.handover_publications set redacted_at = now() where id = tests.id('pub1');
end $$;
select tests.as_service();
select tests.eq(public.resolve_handover_people(tests.id('ivy'), tests.id('h')), '[]'::jsonb, 'redacted publication: nothing');
select tests.eq(jsonb_array_length(public.resolve_handover_people(tests.id('ann'), tests.id('h'))), 7, 'the creator is unaffected');

-- Privileges are unchanged: service_role only.
select tests.ok(not has_function_privilege('authenticated', 'public.resolve_handover_people(uuid,uuid)', 'EXECUTE'), 'authenticated cannot execute');
select tests.ok(not has_function_privilege('anon', 'public.resolve_handover_people(uuid,uuid)', 'EXECUTE'), 'anon cannot execute');
select tests.ok(has_function_privilege('service_role', 'public.resolve_handover_people(uuid,uuid)', 'EXECUTE'), 'service_role can');

-- A deleted handover resolves nothing.
select tests.as_owner();
update public.handovers set deleted_at = now() where id = tests.id('h');
select tests.as_service();
select tests.throws(format('select public.resolve_handover_people(%L, %L)', tests.id('ann'), tests.id('h')), 'BTNF0', 'deleted handover: not_found');
