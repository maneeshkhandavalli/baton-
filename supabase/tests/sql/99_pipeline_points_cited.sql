-- QA-UI3-X1: list_points_for_pipeline returns citedMessageIds and originalStatement (20261115100200).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.source('h', 's');
select tests.set_state('h', 'in_review');
select tests.point('h', 'p1'); select tests.cite('p1', 's', 'alice', 1); select tests.cite('p1', 's', 'bob', 1);
select tests.point('h', 'p2');

do $$
declare v jsonb; p jsonb;
begin
  -- A human edit changes the statement; the original (extractor) wording stays available for matching.
  perform tests.as_user('rev');
  perform public.edit_point(tests.actor(), tests.id('p1'), (select current_revision_id from public.handover_points where id = tests.id('p1')),
                            'Edited title', 'Edited statement by a reviewer', '{}', 'Clearer');
  perform tests.as_owner();
  -- One citation excluded: it must not count.
  update public.point_evidence set excluded_at = now(), excluded_by = tests.id('rev'), exclusion_reason = 'test'
   where point_id = tests.id('p1') and evidence_id = (select q.id from public.evidence_quotes q where q.source_message_id = tests.msg('s', 'bob', 1));

  perform tests.as_service();
  v := public.list_points_for_pipeline(tests.id('h'));
  perform tests.as_owner();
  select e into p from jsonb_array_elements(v) e where e ->> 'pointId' = tests.id('p1')::text;
  perform tests.eq(p ->> 'statement', 'Edited statement by a reviewer', 'current statement');
  perform tests.eq(p ->> 'originalStatement', 'Statement of p1', 'original (revision 1) statement');
  perform tests.eq(p -> 'citedMessageIds', jsonb_build_array(tests.msg('s', 'alice', 1)), 'only active citations');
  select e into p from jsonb_array_elements(v) e where e ->> 'pointId' = tests.id('p2')::text;
  perform tests.eq(p -> 'citedMessageIds', '[]'::jsonb, 'no evidence: empty list');
  perform tests.ok(p ? 'lastSupportedAt' and p ? 'newestEvidenceAt', 'existing keys kept');
end $$;

-- Grants unchanged: service_role only.
do $$
begin
  perform tests.ok(has_function_privilege('service_role', 'public.list_points_for_pipeline(uuid)', 'execute'), 'service_role executes');
  perform tests.ok(not has_function_privilege('authenticated', 'public.list_points_for_pipeline(uuid)', 'execute'), 'authenticated does not');
  perform tests.ok(not has_function_privilege('anon', 'public.list_points_for_pipeline(uuid)', 'execute'), 'anon does not');
end $$;

select 'ok' as pipeline_points_cited;
