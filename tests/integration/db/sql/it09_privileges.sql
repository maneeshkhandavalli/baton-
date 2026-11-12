-- IT-09 (database part) and the D35 privilege model (§8.3, §12.8, D27, D35):
--   * erase_participant / purge_handover (and the other internal privacy paths) are executable by NO role;
--   * browser roles cannot write any table or call any mutation; service_role cannot write tables directly;
--   * authenticated may execute only the read API and RLS helpers; anon nothing at all;
--   * every public table has RLS; secret tables and identity-hash columns are unreadable by clients.
\set ON_ERROR_STOP 1

create temp view it_fns as
  select p.oid, p.proname, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'); -- not extension members

create temp view it_tables as
  select c.oid, c.relname, c.relkind, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p');

-- ── D27: no role can run erasure or purge, nor the internal privacy writers ──
do $$
declare
  v_role text;
  v_fn text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_fn in array array[
      'public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)',
      'public.purge_handover(uuid,uuid,uuid)',
      'public.anonymise_account_snapshots(uuid)',
      'public.transition_handover(uuid,text,uuid)',
      'public._flag_point_for_privacy(uuid,text)',
      'public._tombstone_revisions(uuid,uuid)',
      'public._require_actor(uuid)',
      'public._audit(uuid,uuid,uuid,text,text,uuid,jsonb,jsonb,text)'] loop
      perform tests.ok(not has_function_privilege(v_role, v_fn, 'EXECUTE'), format('%s cannot execute %s', v_role, v_fn));
    end loop;
  end loop;
end $$;

select tests.ok(not exists (select 1 from pg_roles where rolname = 'baton_restore'), 'no restore role is provisioned (§12.8 point 10)');

-- no internal (underscore) function is reachable by an API role, except the documented RLS JSON helper
select tests.eq((select array_agg(sig order by sig) from it_fns
                  where proname like '\_%' and proname <> '_source_json'
                    and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE')
                         or has_function_privilege('service_role', oid, 'EXECUTE'))),
                null::text[], 'internal helpers are granted to no API role');

-- calling them fails with insufficient_privilege, whoever asks
select tests.user('ann');
select tests.handover('h', 'ann', 'outgoing');
select tests.as_service();
select tests.throws(format($q$select public.erase_participant(gen_random_uuid(), %L, 'phone', '\x00', 'p1', null, %L)$q$,
                           tests.id('h'), tests.id('ann')), '42501', 'service_role cannot erase');
select tests.throws(format($q$select public.purge_handover(gen_random_uuid(), %L, %L)$q$, tests.id('h'), tests.id('ann')), '42501',
                    'service_role cannot purge');
select tests.as_user('ann');
select tests.throws(format($q$select public.purge_handover(gen_random_uuid(), %L, %L)$q$, tests.id('h'), tests.actor()), '42501',
                    'not even for the creator');
select tests.as_reader('ann');
select tests.throws(format($q$select public.erase_participant(gen_random_uuid(), %L, 'phone', '\x00', 'p1', null, %L)$q$,
                           tests.id('h'), tests.actor()), '42501', 'the browser cannot erase');
select tests.as_owner();
select tests.ok((select deleted_at is null from public.handovers where id = tests.id('h')), 'handover still there');

-- ── tables: RLS everywhere, no client or service-role writes ─────────────────
select tests.eq((select array_agg(relname order by relname) from it_tables where relkind in ('r', 'p') and not relrowsecurity),
                null::name[], 'every public table has row level security');
select tests.eq((select array_agg(relname || ':' || r order by relname, r)
                   from it_tables, unnest(array['anon', 'authenticated', 'service_role']) r
                  where has_table_privilege(r, oid, 'INSERT') or has_table_privilege(r, oid, 'UPDATE')
                     or has_table_privilege(r, oid, 'DELETE') or has_table_privilege(r, oid, 'TRUNCATE')),
                null::text[], 'no API role can write any table directly (D35)');
select tests.eq((select array_agg(relname order by relname) from it_tables where has_table_privilege('anon', oid, 'SELECT')),
                null::name[], 'anon reads nothing');
select tests.eq((select array_agg(relname order by relname) from it_tables
                  where relname in ('access_tokens', 'access_token_questions', 'participant_erasures', 'rate_limit_counters')
                    and has_table_privilege('authenticated', oid, 'SELECT')),
                null::name[], 'token, erasure and rate-limit tables are never readable by clients');
select tests.ok(not has_column_privilege('authenticated', 'public.source_participants', 'identity_hash', 'SELECT'),
                'participant identity hash is not client-readable');
select tests.ok(not has_column_privilege('authenticated', 'public.source_exclusions', 'participant_identity_hash', 'SELECT'),
                'exclusion identity hash is not client-readable');
select tests.ok(not has_column_privilege('authenticated', 'public.evidence_quotes', 'author_identity_hash', 'SELECT'),
                'quote author identity hash is not client-readable');

-- ── functions: anon nothing; authenticated only the read API and RLS helpers ─
select tests.eq((select array_agg(sig order by sig) from it_fns where has_function_privilege('anon', oid, 'EXECUTE')),
                null::text[], 'anon executes nothing');
select tests.eq((select array_agg(sig order by sig) from it_fns
                  where has_function_privilege('authenticated', oid, 'EXECUTE')
                    and proname <> all (array[
                      -- RLS helpers (grants migration)
                      'access_rank', 'max_access', 'is_member', 'member_role', 'clearance', 'is_creator', 'is_review_role',
                      'within_clearance', 'point_visible', 'source_visible', 'gap_question_privacy_held',
                      'gap_answer_privacy_held', 'my_member_id', 'gap_question_visible_to_member', 'member_label',
                      'has_incoming_recipient', 'get_privacy_review', 'readiness_report', 'can_upload_source_object', '_source_json',
                      -- read API (BatonQueries) + R1
                      'api_list_my_handovers', 'api_get_handover', 'api_list_members', 'api_list_sources',
                      'api_get_processing_status', 'api_list_points', 'api_get_point', 'api_list_gap_questions',
                      'api_get_readiness', 'api_get_published_handover', 'api_list_participants', 'api_list_exclusions',
                      'api_get_source_message_context', 'api_list_my_creator_transfer_offers', 'get_account_deletion_blockers',
                      'list_access_tokens', 'api_get_source'])),
                null::text[], 'authenticated may execute only the read API and RLS helpers (no mutation, worker or token function)');

-- spot checks of the server-only surface
select tests.ok(not has_function_privilege('authenticated', 'public.redeem_member_invite(bytea,uuid)', 'EXECUTE'), 'invite redemption is server-only');
select tests.ok(not has_function_privilege('authenticated', 'public.get_gap_interview(bytea)', 'EXECUTE'), 'token reads are server-only');
select tests.ok(not has_function_privilege('authenticated', 'public.source_preview_target(uuid,uuid)', 'EXECUTE'), 'R2 is server-only');
select tests.ok(not has_function_privilege('authenticated', 'public.claim_ready_processing_jobs(integer,integer)', 'EXECUTE'), 'workers are server-only');
select tests.ok(has_function_privilege('service_role', 'public.complete_processing_job(uuid,integer,text,jsonb,text,text,timestamp with time zone,integer,integer)', 'EXECUTE'),
                'control: the fenced worker API is granted to service_role');

-- QA-N1 (fixed in 20261112000400): the pre-integration worker functions bypass the reaper, stage ordering
-- and fencing (M3–M5); no API role may execute them.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_function_privilege(v_role, 'public.claim_processing_jobs(integer,integer)', 'EXECUTE'),
                     'QA-N1: ' || v_role || ' cannot run the legacy unordered claim');
    perform tests.ok(not has_function_privilege(v_role,
                       'public.record_job_attempt(uuid,text,jsonb,text,text,timestamp with time zone,integer,integer)', 'EXECUTE'),
                     'QA-N1: ' || v_role || ' cannot run the legacy unfenced completion');
  end loop;
end $$;
select tests.as_service();
select tests.throws('select * from public.claim_processing_jobs(5, 300)', '42501', 'QA-N1: the legacy claim is refused at call time');
select tests.as_owner();
