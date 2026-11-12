-- Round 3, Agent 4: PI-11 guard fields on the review read (migration 20261113300900_point_evidence_guard_fields).
-- api_get_point exposes `guarded` / `model_verdict` per evidence item, derived from
-- verifier_provenance -> 'injectionGuard', and only while the stored verdict is still 'irrelevant'.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's1');
select tests.point('h', 'P1', 'owner');
select tests.cite('P1', 's1', 'alice', 1, 'unchecked', 'exact', 'guarded_link');
select tests.cite('P1', 's1', 'bob', 1, 'supports', 'exact', 'plain_link');
select tests.set_state('h', 'in_review');

-- The verify_support stage records the guarded verdict through the (fenced twin of the) writer; the
-- provenance carries ids and verdicts only.
select public.record_support_verdict(
  tests.id('guarded_link'),
  (select current_revision_id from public.handover_points where id = tests.id('P1')),
  'irrelevant', 'Not counted as support: the evidence contains instructions addressed to an automated checker.',
  '{"provider":"fake","injectionGuard":{"guarded":true,"modelVerdict":"supports","patterns":["addressed_to_ai"],"fields":["quote"]}}',
  sha256(convert_to('alice message 1', 'UTF8')));

create function tests.ev(p_link text) returns jsonb language sql as $$
  select e from jsonb_array_elements(tests.read(format('select public.api_get_point(%L)', tests.id('P1'))) -> 'evidence') e
   where e ->> 'point_evidence_id' = tests.id(p_link)::text
$$;
grant execute on function tests.ev(text) to anon, authenticated, service_role;

select tests.as_user('rev');
select tests.eq(tests.ev('guarded_link') -> 'guarded', 'true'::jsonb, 'a guarded verdict reads guarded = true');
select tests.eq(tests.ev('guarded_link') ->> 'model_verdict', 'supports', 'the model''s verdict before the guard is exposed');
select tests.eq(tests.ev('guarded_link') ->> 'support_verdict', 'irrelevant', 'the stored verdict is still irrelevant');
select tests.eq(tests.ev('plain_link') -> 'guarded', 'false'::jsonb, 'an ordinary verdict reads guarded = false');
select tests.ok(tests.ev('plain_link') -> 'model_verdict' = 'null'::jsonb, 'an ordinary verdict has a null model_verdict');
select tests.ok(not (tests.ev('guarded_link') ? 'injectionGuard') and tests.ev('guarded_link')::text not like '%addressed_to_ai%',
                'pattern ids and raw provenance are not part of the review read');

-- RLS is unchanged: the incoming member still cannot open the point during review.
select tests.as_user('inc');
select tests.ok(tests.read(format('select public.api_get_point(%L)', tests.id('P1'))) is null, 'still hidden from incoming');

-- A later reset clears the flag: privacy redaction sets 'unchecked' but leaves the old provenance behind.
select tests.as_owner();
update public.point_evidence set support_verdict = 'unchecked', verified_revision_id = null, verdict_rationale = null
 where id = tests.id('guarded_link');
select tests.as_user('rev');
select tests.eq(tests.ev('guarded_link') -> 'guarded', 'false'::jsonb, 'a reset verdict is no longer guarded');
select tests.ok(tests.ev('guarded_link') -> 'model_verdict' = 'null'::jsonb, 'and has no model_verdict');

-- A malformed marker never yields a non-promoting model verdict.
select tests.as_owner();
update public.point_evidence
   set support_verdict = 'irrelevant', verified_revision_id = (select current_revision_id from public.handover_points where id = tests.id('P1')),
       verified_at = now(),
       verifier_provenance = '{"provider":"fake","injectionGuard":{"guarded":true,"modelVerdict":"contradicts"}}'
 where id = tests.id('guarded_link');
update public.point_evidence
   set support_verdict = 'irrelevant', verifier_provenance = '{"provider":"fake","injectionGuard":{"guarded":"yes"}}'
 where id = tests.id('plain_link');
select tests.as_user('rev');
select tests.eq(tests.ev('guarded_link') -> 'guarded', 'true'::jsonb, 'guarded with an unknown model verdict');
select tests.ok(tests.ev('guarded_link') -> 'model_verdict' = 'null'::jsonb, 'only supports/partial are exposed as model_verdict');
select tests.eq(tests.ev('plain_link') -> 'guarded', 'false'::jsonb, 'only a JSON true marks a verdict as guarded');

-- Grants and security mode are unchanged by CREATE OR REPLACE.
select tests.as_owner();
select tests.ok(has_function_privilege('authenticated', 'public.api_get_point(uuid)', 'execute'), 'authenticated may read points');
select tests.ok(not has_function_privilege('anon', 'public.api_get_point(uuid)', 'execute'), 'anon may not');
select tests.ok(not (select prosecdef from pg_proc where oid = 'public.api_get_point(uuid)'::regprocedure), 'still security invoker');
