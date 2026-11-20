-- IT-21 (Round 3 Task 02, PRIV-1): the encrypted identity vault (migration 20261117200100_identity_vault.sql).
--   * nobody reads handover_people directly (not anon, authenticated or even service_role); every function is
--     service_role only;
--   * people are added only by a LIVE parse job (fenced), ordinals are stable and never handed out twice;
--   * a source is persisted only when every participant label is a known [PERSON_n], and is then marked person_v1;
--   * resolve_handover_people returns sealed labels only to members, only for people of parsed sources within
--     the member's clearance; anyone else gets not_found;
--   * identity_backfill_report counts legacy plain-text sources without returning any label.
\set ON_ERROR_STOP 1

-- ── privileges ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  r text;
  f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    perform tests.ok(not has_table_privilege(r, 'public.handover_people', 'SELECT'), r || ' cannot read the vault');
    perform tests.ok(not has_table_privilege(r, 'public.handover_people', 'INSERT'), r || ' cannot write the vault');
    foreach f in array array['public.pipeline_reserve_handover_people(uuid,int,jsonb,bigint)', 'public.pipeline_list_handover_people(uuid,int,bigint)',
                             'public.pipeline_persist_pseudonymized_source(uuid,int,jsonb,text,bigint)', 'public.resolve_handover_people(uuid,uuid)',
                             'public.identity_backfill_report()'] loop
      perform tests.ok(not has_function_privilege(r, f, 'EXECUTE'), r || ' cannot execute ' || f);
    end loop;
  end loop;
  perform tests.ok(not has_table_privilege('service_role', 'public.handover_people', 'SELECT'), 'service_role only through the functions');
  perform tests.ok(has_function_privilege('service_role', 'public.resolve_handover_people(uuid,uuid)', 'EXECUTE'), 'service_role resolves for actors');
  perform tests.ok((select relrowsecurity from pg_class where oid = 'public.handover_people'::regclass), 'RLS is on');
end $$;

-- ── fixtures: a handover with an uploaded chat, a running parse job ──────────────────────────────────────
select tests.user('ann');
select tests.user('lee');
select tests.user('ivy');
select tests.user('out');
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'lee', 'lead');      -- leads_only
select tests.member('h', 'ivy', 'incoming');  -- everyone
select it.raw_source('h', 'r', 'leads_only');
select tests.as_user('ann');
select tests.put('run', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'parse', 'sourceId', tests.id('r'), 'inputHash', md5('parse-r')))));
select tests.as_owner();
select tests.put('job', (select id from public.processing_jobs where run_id = tests.id('run') and stage = 'parse'));
select tests.as_service();
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(5, 300) c where c.id = tests.id('job')), 1, 'parse job claimed');

-- ── reserve: stable ordinals, idempotent, validated, fenced ─────────────────────────────────────────────
do $$
declare
  a jsonb;
  b jsonb;
  sealed text := encode(convert_to(repeat('x', 40), 'UTF8'), 'base64'); -- stands in for an AES-GCM blob
begin
  perform tests.as_service();
  a := public.pipeline_reserve_handover_people(tests.id('job'), 1, jsonb_build_array(
         jsonb_build_object('personKey', repeat('a1', 32), 'sealed', sealed, 'keyVersion', 'k1'),
         jsonb_build_object('personKey', repeat('b2', 32), 'sealed', null, 'keyVersion', 'k1')));
  perform tests.eq(jsonb_array_length(a), 2, 'two people registered');
  perform tests.eq((a -> 0 ->> 'ordinal')::int, 1, 'first in input order is PERSON_1');
  perform tests.eq(a -> 0 ->> 'personKey', repeat('a1', 32), 'person key round-trips');
  perform tests.ok(a -> 1 -> 'sealed' = 'null'::jsonb, 'a person without a usable name has no label');
  b := public.pipeline_reserve_handover_people(tests.id('job'), 1, jsonb_build_array(
         jsonb_build_object('personKey', repeat('c3', 32), 'sealed', sealed, 'keyVersion', 'k1'),
         jsonb_build_object('personKey', repeat('a1', 32), 'sealed', sealed, 'keyVersion', 'k1')));
  perform tests.eq(jsonb_array_length(b), 3, 'a new person is added, a known one is not duplicated');
  perform tests.eq((select (e ->> 'ordinal')::int from jsonb_array_elements(b) e where e ->> 'personKey' = repeat('a1', 32)), 1, 'known person keeps PERSON_1');
  perform tests.eq((select (e ->> 'ordinal')::int from jsonb_array_elements(b) e where e ->> 'personKey' = repeat('c3', 32)), 3, 'new person gets PERSON_3');
end $$;
select tests.throws(format($q$select public.pipeline_reserve_handover_people(%L, 1, '[{"personKey":"zz","keyVersion":"k1"}]')$q$, tests.id('job')), 'BTVF0', 'malformed person key');
select tests.throws(format($q$select public.pipeline_reserve_handover_people(%L, 1, '[{"personKey":"%s","keyVersion":"k9"}]')$q$, tests.id('job'), repeat('d4', 32)), 'BTVF0', 'unknown key version');
select tests.throws(format($q$select public.pipeline_reserve_handover_people(%L, 2, '[]')$q$, tests.id('job')), 'BTLL0', 'a stale attempt is fenced out');
select tests.throws(format($q$select public.pipeline_reserve_handover_people(%L, 1, '[]', 99)$q$, tests.id('job')), 'BTLL0', 'a wrong claim generation is fenced out');

-- list: the parse job sees every person; the source is not pseudonymised yet
select tests.eq(jsonb_array_length(public.pipeline_list_handover_people(tests.id('job'), 1) -> 'people'), 3, 'list returns the people');
select tests.ok(public.pipeline_list_handover_people(tests.id('job'), 1) -> 'sourceIdentityScheme' = 'null'::jsonb, 'not pseudonymised before persist');

-- ── persist: only known placeholders; marks person_v1 ───────────────────────────────────────────────────
select tests.throws(format('select public.pipeline_persist_pseudonymized_source(%L, 1, %L, %L)', tests.id('job'),
  it.parsed('name', repeat('ab', 32)), 'p1'), 'BTVF0', 'a plain label ("Participant 1") is refused');
select tests.throws(format('select public.pipeline_persist_pseudonymized_source(%L, 1, %L, %L)', tests.id('job'),
  jsonb_set(it.parsed('name', repeat('ab', 32)), '{participants,0,displayLabel}', '"[PERSON_9]"'), 'p1'), 'BTVF0', 'an unknown placeholder is refused');
select tests.throws(format('select public.pipeline_persist_pseudonymized_source(%L, 1, %L, %L)', tests.id('job'),
  jsonb_set(it.parsed('name', repeat('ab', 32)), '{participants,0,displayLabel}', '"Ravi Kumar"'), 'p1'), 'BTVF0', 'a name label is refused');
select tests.as_owner();
select tests.eq((select state from public.sources where id = tests.id('r')), 'uploaded', 'nothing was persisted by the refused calls');
select tests.as_service();
select public.pipeline_persist_pseudonymized_source(tests.id('job'), 1,
  jsonb_set(it.parsed('name', repeat('ab', 32), '[PERSON_1] has the keys'), '{participants,0,displayLabel}', '"[PERSON_1]"'), 'p1');
select tests.as_owner();
select tests.eq((select state || '/' || identity_scheme from public.sources where id = tests.id('r')), 'parsed/person_v1', 'persisted and marked person_v1');
select tests.as_service();
select tests.eq(public.pipeline_list_handover_people(tests.id('job'), 1) ->> 'sourceIdentityScheme', 'person_v1', 'list reports the scheme');

-- ── resolve: members within clearance only ──────────────────────────────────────────────────────────────
select tests.as_service();
select tests.eq((select array_agg((e ->> 'ordinal')::int) from jsonb_array_elements(public.resolve_handover_people(tests.id('ann'), tests.id('h'))) e),
                array[1], 'the creator (reviewer_only clearance) sees PERSON_1 only: the participant of a parsed source');
-- Round 4 (S6, migration 20261121100100): a lead is not a review role, so it resolves only people named in
-- content it can see (published points, its own gap questions); nothing is published here. See it24.
select tests.eq(public.resolve_handover_people(tests.id('lee'), tests.id('h')), '[]'::jsonb, 'a lead resolves nobody before anything naming them is published');
select tests.eq(public.resolve_handover_people(tests.id('ivy'), tests.id('h')), '[]'::jsonb, 'an everyone-clearance member does not');
select tests.throws(format('select public.resolve_handover_people(%L, %L)', tests.id('out'), tests.id('h')), 'BTNF0', 'a non-member gets not_found');
select tests.throws(format('select public.resolve_handover_people(%L, %L)', tests.id('ann'), gen_random_uuid()), 'BTNF0', 'an unknown handover is not_found');
select tests.as_owner();
update public.sources set access_level = 'everyone' where id = tests.id('r');
select tests.as_service();
select tests.eq(public.resolve_handover_people(tests.id('ivy'), tests.id('h')), '[]'::jsonb,
                'Round 4 (S6): an everyone source alone no longer exposes its people to an incoming member (it24 covers publication)');

-- ── another handover never shares people ───────────────────────────────────────────────────────────────
select tests.handover('h2', 'ann', 'outgoing');
select tests.as_service();
select tests.eq(public.resolve_handover_people(tests.id('ann'), tests.id('h2')), '[]'::jsonb, 'no people leak across handovers');

-- ── backfill report: legacy plain-text sources, counts only ─────────────────────────────────────────────
select tests.as_owner();
select tests.source('h2', 'legacy', 'everyone', 'name');   -- parsed before pseudonymisation: labels Alice, Bob, Carol
select tests.as_service();
do $$
declare
  rep jsonb := public.identity_backfill_report();
begin
  perform tests.eq((rep -> 'totals' ->> 'legacySources')::int, 1, 'one legacy source');
  perform tests.eq((rep -> 'totals' ->> 'namedParticipants')::int, 3, 'three named participants');
  perform tests.ok(rep::text !~* 'alice|bob|carol', 'the report never contains a label');
  perform tests.ok(rep -> 'handovers' -> 0 ->> 'action' like 're-upload%', 'a draft is advised to re-upload');
end $$;

-- ── a deleted handover resolves nothing ──────────────────────────────────────────────────────────────────
select tests.as_owner();
update public.handovers set deleted_at = now() where id = tests.id('h');
select tests.as_service();
select tests.throws(format('select public.resolve_handover_people(%L, %L)', tests.id('ann'), tests.id('h')), 'BTNF0', 'a deleted handover resolves nothing');
