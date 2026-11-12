-- UPGRADE-PATH TEST, step 1 (runs on the BASELINE schema: every migration before 20261113*).
-- Seeds realistic synthetic data through the existing functions and test helpers, then snapshots what each
-- member reads through the read API, so every Round 3 migration can be checked against it.
-- LOCAL DOCKER ONLY. Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc', 'eve']) u;

-- ── hd: a draft with two unfinished uploads ─────────────────────────────────
--   sd1: pending_upload, nothing arrived (interrupted before the upload)
--   sd2: pending_upload, the object arrived but confirm never ran
select tests.handover('hd', 'ann', 'outgoing');
select tests.as_user('ann');
select tests.put('sd1', public.create_source(tests.actor(), tests.id('hd'), 'text', 'notes.txt', 'text/plain', 100, repeat('1', 64)));
select tests.put('sd2', public.create_source(tests.actor(), tests.id('hd'), 'whatsapp_export', 'chat.txt', 'text/plain', 200, repeat('2', 64)));
select tests.as_owner();
insert into storage.objects (bucket_id, name, metadata)
select 'source-uploads', raw_storage_path, '{"size": 200}' from public.sources where id = tests.id('sd2');

-- ── hp: processing, with a job claimed (running) before the upgrade ─────────
select tests.handover('hp', 'ann', 'outgoing');
select tests.member('hp', 'rev', 'reviewer');
select tests.source('hp', 'sp1');
select tests.as_user('ann');
select tests.put('run_hp', public.start_processing(tests.actor(), tests.id('hp'), 'pv-upgrade', '{"provider":"fake"}'::jsonb,
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sp1'), 'inputHash', md5('hp-e')),
                    jsonb_build_object('stage', 'prepare_review', 'sourceId', null, 'inputHash', md5('hp-p')))));
select tests.as_service();
select tests.put('job_hp', (select id from public.claim_ready_processing_jobs(5, 900) limit 1));
select public.heartbeat_processing_job(tests.id('job_hp'), 1, 900, 2, 5); -- 2 of 5 chunks stored this attempt
select tests.as_owner();

-- ── hr: in review after a finished run, with points and verified evidence ───
select tests.handover('hr', 'ann', 'outgoing');
select tests.member('hr', 'rev', 'reviewer');
select tests.member('hr', 'inc', 'incoming');
select tests.source('hr', 'sr1');
select tests.as_user('ann');
select tests.put('run_hr', public.start_processing(tests.actor(), tests.id('hr'), 'pv-upgrade', '{"provider":"fake"}'::jsonb,
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sr1'), 'inputHash', md5('hr-e')))));
select tests.as_service();
select public.complete_processing_job(j.id, j.attempt, 'succeeded', '{"attempt":1,"outcome":"succeeded"}'::jsonb)
  from public.claim_ready_processing_jobs(5, 900) j;
select public.finish_processing_run(tests.id('run_hr'), 'succeeded');
select tests.as_owner();
select tests.point('hr', 'pr1', 'decision');
select tests.cite('pr1', 'sr1', 'alice', 1);
select tests.point('hr', 'pr2', 'owner');
select tests.cite('pr2', 'sr1', 'bob', 2, 'unchecked');
select tests.point('hr', 'pr3', 'contact');
select tests.ok((select state from public.handovers where id = tests.id('hr')) = 'in_review', 'seed: hr is in review');

-- ── hpub: published, acknowledged by nobody yet ─────────────────────────────
select tests.handover('hpub', 'ann', 'outgoing');
select tests.member('hpub', 'rev', 'reviewer');
select tests.member('hpub', 'inc', 'incoming');
select tests.source('hpub', 'spub');
select tests.set_state('hpub', 'in_review');
select tests.point('hpub', 'ppub1');
select tests.cite('ppub1', 'spub', 'carol', 3);
select tests.approve_all('hpub');
select tests.as_user('ann');
select tests.put('pub', public.publish_handover(tests.actor(), tests.id('hpub'), 'Synthetic summary'));
select tests.as_owner();

-- ── hdel: a discarded draft whose upload is still in Storage ────────────────
select tests.handover('hdel', 'ann', 'outgoing');
select tests.as_user('ann');
select tests.put('sdel', public.create_source(tests.actor(), tests.id('hdel'), 'text', 'old.txt', 'text/plain', 50, repeat('3', 64)));
select tests.as_owner();
insert into storage.objects (bucket_id, name, metadata)
select 'source-uploads', raw_storage_path, '{"size": 50}' from public.sources where id = tests.id('sdel');
select tests.as_user('ann');
select public.delete_handover(tests.actor(), tests.id('hdel'));
select tests.as_owner();

-- ── hx: a run with mixed stage outcomes (its stage statuses change on purpose in 20261113300700) ─────
--   extract: one job succeeded, one failed          → before 'failed', after 'partial'
--   verify_quotes: one job failed, one still queued → before 'failed', after 'queued'
select tests.handover('hx', 'ann', 'outgoing');
select tests.source('hx', 'sx1');
select tests.source('hx', 'sx2');
select tests.as_user('ann');
select tests.put('run_hx', public.start_processing(tests.actor(), tests.id('hx'), 'pv-upgrade', '{"provider":"fake"}'::jsonb,
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sx1'), 'inputHash', md5('x1')),
                    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sx2'), 'inputHash', md5('x2')),
                    jsonb_build_object('stage', 'verify_quotes', 'sourceId', tests.id('sx1'), 'inputHash', md5('q1')),
                    jsonb_build_object('stage', 'verify_quotes', 'sourceId', tests.id('sx2'), 'inputHash', md5('q2')))));
select tests.as_owner();
update public.processing_jobs set status = 'succeeded', finished_at = now()
 where run_id = tests.id('run_hx') and stage = 'extract' and source_id = tests.id('sx1');
update public.processing_jobs set status = 'failed', finished_at = now(), error_code = 'processing_failed'
 where run_id = tests.id('run_hx') and source_id = tests.id('sx2') and stage in ('extract', 'verify_quotes');
-- the remaining verify_quotes job waits for a retry backoff, so no claim in this test picks it up
update public.processing_jobs set next_attempt_at = now() + interval '1 day'
 where run_id = tests.id('run_hx') and status = 'queued';

-- ── snapshot helpers (schema "upgrade", local only) ─────────────────────────
create schema upgrade;
grant usage on schema upgrade to anon, authenticated, service_role;

-- Removes keys that a Round 3 migration ADDS on purpose (HandoverSummary.description, 20261113100400) from
-- handover objects, so the remaining read is compared byte for byte.
create function upgrade.strip(j jsonb) returns jsonb language plpgsql immutable as $$
declare
  k text;
  out jsonb;
begin
  if jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(upgrade.strip(e) order by i) from jsonb_array_elements(j) with ordinality t(e, i)), '[]'::jsonb);
  elsif jsonb_typeof(j) = 'object' then
    out := '{}'::jsonb;
    for k in select jsonb_object_keys(j) loop
      if k = 'description' and j ? 'viewer_role' then continue; end if;
      out := out || jsonb_build_object(k, upgrade.strip(j -> k));
    end loop;
    return out;
  end if;
  return j;
end $$;

-- Everything each member reads through the read API (RLS applies: tests.read runs as `authenticated`).
create function upgrade.reads() returns jsonb language plpgsql as $$
declare
  u text;
  h text;
  r jsonb := '{}'::jsonb;
begin
  foreach u in array array['ann', 'rev', 'inc', 'eve'] loop
    perform tests.as_user(u);
    r := r || jsonb_build_object(u || ':list', tests.read('select public.api_list_my_handovers()'));
    foreach h in array array['hd', 'hp', 'hr', 'hpub', 'hdel'] loop
      r := r || jsonb_build_object(
        u || ':' || h || ':get', tests.read(format('select public.api_get_handover(%L)', tests.id(h))),
        u || ':' || h || ':sources', tests.read(format('select public.api_list_sources(%L)', tests.id(h))),
        u || ':' || h || ':status', tests.read(format('select public.api_get_processing_status(%L)', tests.id(h))),
        u || ':' || h || ':points', tests.read(format('select public.api_list_points(%L, null, null, null)', tests.id(h))),
        u || ':' || h || ':published', tests.read(format('select public.api_get_published_handover(%L)', tests.id(h))));
    end loop;
  end loop;
  perform tests.as_owner();
  return r;
end $$;

create table upgrade.snapshot (id int primary key, reads jsonb not null);
insert into upgrade.snapshot values (1, upgrade.strip(upgrade.reads()));
grant select, insert on upgrade.snapshot to service_role;
-- hx is kept out of the byte-for-byte diff: 20261113300700 changes its stage statuses ON PURPOSE.
-- Its pre-upgrade stage statuses are recorded here and compared in verify.sql.
select tests.as_user('ann');
insert into upgrade.snapshot
select 2, coalesce(jsonb_object_agg(s ->> 'stage', s ->> 'status'), '{}'::jsonb)
  from jsonb_array_elements(tests.read(format('select public.api_get_processing_status(%L)', tests.id('hx'))) -> 'run' -> 'stages') s;
select tests.as_owner();

-- The keys whose read differs from the snapshot (empty array = every read unchanged).
create function upgrade.diff() returns text[] language sql as $$
  with now_ as (select upgrade.strip(upgrade.reads()) as r), was as (select reads as r from upgrade.snapshot where id = 1)
  select coalesce(array_agg(k order by k), '{}') from now_, was, jsonb_object_keys(was.r) k
   where was.r -> k is distinct from now_.r -> k
$$;

grant execute on all functions in schema upgrade to anon, authenticated, service_role;

-- sanity: the snapshot really contains data
select tests.ok((select jsonb_array_length(reads -> 'ann:list') from upgrade.snapshot where id = 1) = 5, 'ann lists hd, hp, hr, hpub, hx');
select tests.eq((select reads from upgrade.snapshot where id = 2), '{"extract": "failed", "verify_quotes": "failed"}'::jsonb,
                'baseline stage statuses of the mixed run');
select tests.ok((select (reads -> 'inc:hpub:published') is not null and (reads -> 'inc:hpub:published') <> 'null'::jsonb from upgrade.snapshot where id = 1),
                'inc reads the publication');
select tests.ok((select jsonb_array_length(reads -> 'rev:hr:points') from upgrade.snapshot where id = 1) = 3, 'rev reads hr''s points');
select tests.ok((select reads -> 'eve:hr:get' = 'null'::jsonb from upgrade.snapshot where id = 1), 'eve reads nothing');
