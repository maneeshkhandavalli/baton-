-- R3 backend (Agent 2), C2: duplicate-draft prevention in create_handover (migration 20261113100200).
-- Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev']) u;

create function tests.token(p_handover text) returns timestamptz language sql volatile as $$
  select date_trunc('milliseconds', updated_at) from public.handovers where id = tests.id(p_handover)
$$;
grant execute on function tests.token(text) to anon, authenticated, service_role;

select tests.ok(has_function_privilege('service_role', 'public.create_handover(uuid,text,text,text,text,text)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.create_handover(uuid,text,text,text,text,text)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.create_handover(uuid,text,text,text,text,text)', 'EXECUTE'),
                'create_handover keeps its server-only grant after CREATE OR REPLACE');

create function tests.create_sql(p_user text, p_title text, p_role text default 'outgoing') returns text language sql volatile as $$
  select format('select public.create_handover(%L, %L, %L, %L, null, %L)::text', tests.id(p_user), p_title, 'Club', 'Treasurer', p_role)
$$;
grant execute on function tests.create_sql(text, text, text) to anon, authenticated, service_role;

select tests.as_user('ann');
select tests.put('n1', public.create_handover(tests.actor(), 'Season handover', 'Club', 'Treasurer', null, 'outgoing'));
select tests.put('n2', public.create_handover(tests.actor(), ' Season handover ', 'Club', 'Treasurer ', null, 'outgoing'));
select tests.as_owner();
select tests.eq(tests.id('n2'), tests.id('n1'), 'an immediate identical resubmission returns the first draft');
select tests.eq((select count(*)::int from public.handovers where created_by = tests.id('ann') and title = 'Season handover'), 1,
                'only one draft exists');
select tests.eq((select count(*)::int from public.audit_logs where handover_id = tests.id('n1') and action = 'handover.created'), 1,
                'the resubmission is not audited as a second creation');

select tests.as_user('ann');
select tests.ok(public.create_handover(tests.actor(), 'Season handover', 'Club', 'Treasurer', 'A description', 'outgoing') <> tests.id('n1'),
                'different details create a new draft');
select tests.ok(public.create_handover(tests.actor(), 'Season handover', 'Club', 'Treasurer', null, 'reviewer') <> tests.id('n1'),
                'a different creator role creates a new draft');
select tests.as_user('rev');
select tests.ok(public.create_handover(tests.actor(), 'Season handover', 'Club', 'Treasurer', null, 'outgoing') <> tests.id('n1'),
                'another user never receives someone else''s draft');
select tests.as_owner();

-- a draft the user already worked on is never reused
select tests.as_user('ann');
select tests.put('w1', public.create_handover(tests.actor(), 'Worked handover', 'Club', 'Treasurer', null, 'outgoing'));
select tests.as_owner();
select tests.source('w1', 'ws1');
select tests.as_user('ann');
select tests.ok(public.create_handover(tests.actor(), 'Worked handover', 'Club', 'Treasurer', null, 'outgoing') <> tests.id('w1'),
                'a draft with a source is not reused');
select tests.put('w2', public.create_handover(tests.actor(), 'Edited handover', 'Club', 'Treasurer', null, 'outgoing'));
select pg_sleep(0.01);
select public.update_handover_details(tests.actor(), tests.id('w2'), tests.token('w2'), 'Edited handover', 'Club', 'Treasurer', 'Now edited');
select public.update_handover_details(tests.actor(), tests.id('w2'), tests.token('w2'), 'Edited handover', 'Club', 'Treasurer', '');
select tests.ok(public.create_handover(tests.actor(), 'Edited handover', 'Club', 'Treasurer', null, 'outgoing') <> tests.id('w2'),
                'an updated draft is not reused even when its details match again');
select tests.put('w3', public.create_handover(tests.actor(), 'Deleted handover', 'Club', 'Treasurer', null, 'outgoing'));
select public.delete_handover(tests.actor(), tests.id('w3'));
select tests.ok(public.create_handover(tests.actor(), 'Deleted handover', 'Club', 'Treasurer', null, 'outgoing') <> tests.id('w3'),
                'a deleted draft is not reused');
select tests.put('w4', public.create_handover(tests.actor(), 'Old handover', 'Club', 'Treasurer', null, 'outgoing'));
select tests.as_owner();
alter table public.handovers disable trigger handovers_touch;
update public.handovers set created_at = now() - interval '3 minutes', updated_at = now() - interval '3 minutes' where id = tests.id('w4');
alter table public.handovers enable trigger handovers_touch;
select tests.as_user('ann');
select tests.ok(public.create_handover(tests.actor(), 'Old handover', 'Club', 'Treasurer', null, 'outgoing') <> tests.id('w4'),
                'a draft older than the 2-minute window is not reused');
select tests.as_owner();

-- concurrent double submit: the second call waits for the first and returns the same id
do $$
declare
  r1 text;
  r2 text;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', tests.create_sql('ann', 'Double click handover'));
  perform tests.c_send('c2', tests.create_sql('ann', 'Double click handover'));
  perform tests.ok(tests.c_blocked('c2'), 'the second submission waits for the first');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.ok(r1 like 'OK:%', 'the first submission creates the draft: ' || r1);
  perform tests.eq(r2, r1, 'the concurrent second submission returns the same draft');
  perform tests.eq((select count(*)::int from public.handovers where title = 'Double click handover'), 1, 'exactly one draft');
end $$;

-- the validation and actor rules of create_handover are unchanged
select tests.as_user('ann');
select tests.throws(format($q$select public.create_handover(%L, 'Title', 'Team', null, null, 'incoming')$q$, tests.actor()), 'BTVF0',
                    'creator role is still validated');
select tests.as_service();
select tests.throws($q$select public.create_handover(gen_random_uuid(), 'Title', 'Team', null, null, 'outgoing')$q$, 'BTUA0',
                    'unknown actor is still unauthenticated');
select tests.as_owner();
