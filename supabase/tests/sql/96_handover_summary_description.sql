-- R3 backend (Agent 2): HandoverSummary.description from the read API (migration 20261113100400).
-- Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'inc', 'eve']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'inc', 'incoming');
select tests.as_user('ann');
select tests.put('d', public.create_handover(tests.actor(), 'Described handover', 'Club', null, '  Bank, dues and keys  ', 'outgoing'));
select tests.as_owner();

-- grants and SECURITY INVOKER are unchanged
select tests.ok(has_function_privilege('authenticated', 'public.api_get_handover(uuid)', 'EXECUTE')
                and has_function_privilege('authenticated', 'public.api_list_my_handovers()', 'EXECUTE')
                and not has_function_privilege('anon', 'public.api_get_handover(uuid)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.api_list_my_handovers()', 'EXECUTE'), 'read grants unchanged');
select tests.ok(not (select prosecdef from pg_proc where oid = 'public.api_get_handover(uuid)'::regprocedure)
                and not (select prosecdef from pg_proc where oid = 'public.api_list_my_handovers()'::regprocedure),
                'both reads stay SECURITY INVOKER (RLS applies)');

select tests.as_reader('ann');
select tests.eq(public.api_get_handover(tests.id('d')) ->> 'description', 'Bank, dues and keys', 'api_get_handover returns the description');
select tests.ok((public.api_get_handover(tests.id('h')) -> 'description') = 'null'::jsonb, 'no description is JSON null');
select tests.eq((select e ->> 'description' from jsonb_array_elements(public.api_list_my_handovers()) e where e ->> 'id' = tests.id('d')::text),
                'Bank, dues and keys', 'api_list_my_handovers returns it too');
select tests.as_owner();

-- an edit shows up in the read
select tests.as_user('ann');
select public.update_handover_details(tests.actor(), tests.id('h'),
                                      (select date_trunc('milliseconds', updated_at) from public.handovers where id = tests.id('h')),
                                      'Handover h', 'Team h', null, 'Now described');
select tests.as_reader('inc');
select tests.eq(public.api_get_handover(tests.id('h')) ->> 'description', 'Now described', 'members read the edited description');
select tests.as_reader('eve');
select tests.ok(public.api_get_handover(tests.id('h')) is null, 'a non-member still sees nothing');
select tests.eq(jsonb_array_length(public.api_list_my_handovers()), 0, 'and lists nothing');
select tests.as_owner();
