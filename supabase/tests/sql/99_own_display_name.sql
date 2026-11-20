-- Round 4 A (audit D1): set_own_display_name (20261121300200_own_display_name.sql).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'bob']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'bob', 'incoming');

do $$
declare v_before text;
begin
  select display_name into v_before from public.profiles where id = tests.id('bob');

  perform tests.as_user('ann');
  perform tests.eq(public.set_own_display_name(tests.actor(), '  Ananya   Rao '), 'Ananya Rao', 'trimmed and collapsed');
  perform tests.as_owner();
  perform tests.eq((select display_name from public.profiles where id = tests.id('ann')), 'Ananya Rao', 'stored');
  perform tests.eq((select display_name from public.profiles where id = tests.id('bob')), v_before, 'only the own profile changes');
  perform tests.eq(public._handover_label(tests.id('h'), tests.id('ann')), 'Ananya Rao', 'members see the new name');

  perform tests.as_user('ann');
  perform tests.throws(format('select public.set_own_display_name(tests.actor(), %L)', ''), 'BTVF0', 'empty refused');
  perform tests.throws(format('select public.set_own_display_name(tests.actor(), %L)', repeat('x', 61)), 'BTVF0', 'too long refused');
  perform tests.throws(format('select public.set_own_display_name(tests.actor(), %L)', '[PERSON_1]'), 'BTVF0', 'token-like refused');
  perform tests.throws(format('select public.set_own_display_name(tests.actor(), %L)', 'Former member'), 'BTVF0', 'reserved refused');
  perform tests.throws(format('select public.set_own_display_name(tests.actor(), %L)', 'a' || chr(7) || 'b'), 'BTVF0', 'control char refused');
  perform tests.as_owner();
  perform tests.eq((select display_name from public.profiles where id = tests.id('ann')), 'Ananya Rao', 'refusals change nothing');
end $$;

-- Server-only: a signed-in browser role cannot call it, even for itself.
do $$
begin
  perform tests.as_reader('ann');
  perform tests.throws(format('select public.set_own_display_name(%L, %L)', tests.id('ann'), 'Hacker'), '42501', 'authenticated cannot execute');
  perform tests.as_owner();
end $$;

select 'ok' as own_display_name;
