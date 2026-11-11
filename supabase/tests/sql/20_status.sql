-- §4.5 test vectors for recompute_point_status (must agree with lib/contracts/status.ts), plus the
-- outdated flag (§4.4), access floor (§8.4) and auto_reopen (§4.3).
\set ON_ERROR_STOP 1

select tests.user('ann');
select tests.handover('h', 'ann');
select tests.source('h', 's');

create function pg_temp.status(p text) returns text language sql as $$
  select evidence_status from public.handover_points where id = tests.id(p)
$$;

do $$
declare
  v_rev2 uuid;
begin
  -- 1: supports / exact / current → sourced
  perform tests.point('h', 'v1'); perform tests.cite('v1', 's', 'alice', 1, 'supports');
  perform tests.eq(pg_temp.status('v1'), 'sourced', 'vector 1');

  -- 2: supports / exact / NOT current (edited since) → inferred
  perform tests.point('h', 'v2'); perform tests.cite('v2', 's', 'alice', 1, 'supports');
  insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind, author_profile_id)
  values (tests.id('h'), tests.id('v2'), 2, 't', 's', '{}', 'profile', tests.id('ann')) returning id into v_rev2;
  update public.handover_points set current_revision_id = v_rev2 where id = tests.id('v2');
  perform tests.eq(pg_temp.status('v2'), 'inferred', 'vector 2');

  -- 3: partial / exact / current → inferred
  perform tests.point('h', 'v3'); perform tests.cite('v3', 's', 'alice', 1, 'partial');
  perform tests.eq(pg_temp.status('v3'), 'inferred', 'vector 3');

  -- 4: no links, inference rationale → inferred
  perform tests.point('h', 'v4');
  update public.handover_points set inference_rationale = 'implied by meeting cadence' where id = tests.id('v4');
  perform tests.eq(pg_temp.status('v4'), 'inferred', 'vector 4');

  -- 5: supports/exact/current + contradicts/normalized/current → conflicting
  perform tests.point('h', 'v5'); perform tests.cite('v5', 's', 'alice', 1, 'supports');
  perform tests.cite('v5', 's', 'bob', 1, 'contradicts', 'normalized', 'v5/contra');
  perform tests.eq(pg_temp.status('v5'), 'conflicting', 'vector 5');

  -- 6: contradicts / exact / current → conflicting
  perform tests.point('h', 'v6'); perform tests.cite('v6', 's', 'bob', 2, 'contradicts');
  perform tests.eq(pg_temp.status('v6'), 'conflicting', 'vector 6');

  -- 7: supports / not_found / current → missing
  perform tests.point('h', 'v7'); perform tests.cite('v7', 's', 'carol', 1, 'supports', 'not_found');
  perform tests.eq(pg_temp.status('v7'), 'missing', 'vector 7');

  -- 8: irrelevant / exact / current → missing
  perform tests.point('h', 'v8'); perform tests.cite('v8', 's', 'carol', 2, 'irrelevant');
  perform tests.eq(pg_temp.status('v8'), 'missing', 'vector 8');

  -- 9: as #5 but the contradicting link is excluded → sourced
  update public.point_evidence set excluded_at = now(), exclusion_reason = 'wrong person' where id = tests.id('v5/contra');
  perform tests.eq(pg_temp.status('v5'), 'sourced', 'vector 9');

  -- 10: nothing → missing
  perform tests.point('h', 'v10');
  perform tests.eq(pg_temp.status('v10'), 'missing', 'vector 10');
end $$;

-- §4.4 potentially outdated: latest support more than 30 days before evidence_as_of.
do $$
begin
  update public.handovers set evidence_as_of = timestamptz '2026-08-01' where id = tests.id('h');
  perform public.recompute_point_status(tests.id('v1'));
  perform tests.ok((select is_potentially_outdated from public.handover_points where id = tests.id('v1')), 'old support flagged outdated');
  update public.handovers set evidence_as_of = timestamptz '2026-06-15' where id = tests.id('h');
  perform public.recompute_point_status(tests.id('v1'));
  perform tests.ok(not (select is_potentially_outdated from public.handover_points where id = tests.id('v1')), 'recent support not outdated');
end $$;

-- §8.4 access floor: strictest of ALL linked evidence, excluded links included.
do $$
begin
  perform tests.source('h', 'secret', 'reviewer_only');
  perform tests.point('h', 'f1');
  perform tests.cite('f1', 's', 'alice', 2, 'supports');
  perform tests.eq((select access_level from public.handover_points where id = tests.id('f1')), 'everyone', 'floor everyone');
  perform tests.cite('f1', 'secret', 'bob', 3, 'supports', 'exact', 'f1/secret');
  perform tests.eq((select access_level from public.handover_points where id = tests.id('f1')), 'reviewer_only', 'restricted evidence raises floor');
  update public.point_evidence set excluded_at = now(), exclusion_reason = 'n/a' where id = tests.id('f1/secret');
  perform tests.eq((select access_level from public.handover_points where id = tests.id('f1')), 'reviewer_only',
                   'excluding restricted evidence does not downgrade the point');
  -- changing the source's level recomputes every point that references it
  update public.sources set access_level = 'leads_only' where id = tests.id('secret');
  perform tests.eq((select access_level from public.handover_points where id = tests.id('f1')), 'leads_only', 'source level change recomputes floor');
end $$;

-- §4.3 auto_reopen: an approved point whose status changes goes back to pending.
do $$
begin
  update public.handover_points set review_state = 'approved' where id = tests.id('v1');
  perform tests.cite('v1', 's', 'carol', 3, 'contradicts');
  perform tests.eq(pg_temp.status('v1'), 'conflicting', 'new contradiction');
  perform tests.eq((select review_state from public.handover_points where id = tests.id('v1')), 'pending', 'auto reopened');
  perform tests.ok(exists (select 1 from public.review_actions where point_id = tests.id('v1') and action = 'auto_reopen'
                           and actor_profile_id is null), 'auto_reopen system action recorded');
end $$;

select 'ok' as status_vectors;
