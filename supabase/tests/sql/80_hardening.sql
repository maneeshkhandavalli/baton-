-- Second-audit hardening: N6 (no impersonation through auth metadata), N2 (snapshot anonymisation only
-- inside account deletion), M3 (erasure neutralises conversation previews, ids and counts) and M6
-- (rate-limit counters; Gap Interview links allow at most 20 uses).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');

-- ── N6: names never come from user-controlled metadata; duplicates are disambiguated ──
do $$
declare
  v_mallory uuid;
  v_twin uuid;
  v_labels text[];
begin
  insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
  values ('mallory@evil.test', '{"display_name": "Ann"}', now()) returning id into v_mallory;
  perform tests.put('mallory', v_mallory);
  perform tests.eq((select display_name from public.profiles where id = v_mallory), 'mallory',
                   'N6: metadata display_name is ignored; the name comes from the signed-in address');
  perform tests.eq(public._derive_display_name('<script>alert(1)</script>@x.test', v_mallory), 'scriptalert1script',
                   'N6: only plain characters are kept');
  perform tests.ok(public._derive_display_name('Former member@x.test', v_mallory) like 'Member %',
                   'N6: "Former member" is reserved');
  perform tests.ok(public._derive_display_name('participant 3@x.test', v_mallory) like 'Member %',
                   'N6: "Participant N" is reserved');
  perform tests.ok(public._derive_display_name('@x.test', v_mallory) like 'Member %', 'N6: empty local part gets a neutral name');

  -- A second "ann" (different address, same local part) joins the same handover as the real ann.
  insert into auth.users (email, email_confirmed_at) values ('ann@other.test', now()) returning id into v_twin;
  perform tests.put('ann2', v_twin);
  perform tests.member('h', 'ann2', 'lead');
  perform tests.as_reader('inc');
  select array_agg(display_name order by display_name) into v_labels from public.handover_member_directory
   where handover_id = tests.id('h') and profile_id in (tests.id('ann'), tests.id('ann2'));
  perform tests.ok(v_labels[1] <> v_labels[2] and v_labels[1] like 'ann #%' and v_labels[2] like 'ann #%',
                   'N6: two members named ann are shown with distinct suffixes: ' || array_to_string(v_labels, ', '));
  perform tests.ok(public.member_label(tests.id('h'), tests.id('ann')) <> public.member_label(tests.id('h'), tests.id('ann2')),
                   'N6: history labels are distinct too');
  perform tests.eq((select display_name from public.handover_member_directory where profile_id = tests.id('rev')), 'rev',
                   'N6: unique names are shown unchanged');
  perform tests.as_owner();
end $$;

-- ── N2: anonymisation is internal and only runs inside account deletion ──────
select tests.source('h', 's');
select tests.point('h', 'pi');
select tests.cite('pi', 's', 'bob', 1, 'partial');
select tests.set_state('h', 'in_review');
do $$
declare
  v jsonb;
begin
  perform tests.as_user('rev');
  perform public.approve_point(tests.actor(), tests.id('pi'),
                               (select current_revision_id from public.handover_points where id = tests.id('pi')), true);
  perform tests.as_user('ann');
  perform tests.put('pub', public.publish_handover(tests.actor(), tests.id('h')));
  perform tests.as_owner();
  perform tests.eq((select content -> 'inferredConfirmation' ->> 'byLabel' from public.publication_points where point_id = tests.id('pi')),
                   'rev', 'setup: snapshot carries the reviewer''s name');

  foreach v in array array['"anon"', '"authenticated"', '"service_role"']::jsonb[] loop
    perform tests.ok(not has_function_privilege(v #>> '{}', 'public.anonymise_account_snapshots(uuid)', 'EXECUTE'),
                     'N2: ' || (v #>> '{}') || ' cannot call anonymise_account_snapshots');
  end loop;
  perform tests.throws(format('select public.anonymise_account_snapshots(%L)', tests.id('ann')), 'BTPF0',
                       'N2: refused for an account that is not being deleted (even for the owner role)');
  perform tests.ok((select content -> 'inferredConfirmation' ->> 'byLabel' from public.publication_points where point_id = tests.id('pi')) = 'rev',
                   'N2: nothing was anonymised');

  -- The creator cannot delete their account while they own a handover (§12.9).
  perform tests.as_service();
  perform tests.throws(format('select public.delete_account_data(%L, ''DELETE'')', tests.id('ann')), 'BTPF0', 'creator must transfer or purge first');
  -- The real flow for the reviewer.
  v := public.delete_account_data(tests.id('rev'), 'DELETE');
  perform tests.as_owner();
  perform tests.eq((v ->> 'publicationRows')::int, 1, 'N2: anonymised through the deletion flow');
  perform tests.eq((select content -> 'inferredConfirmation' ->> 'byLabel' from public.publication_points where point_id = tests.id('pi')),
                   'Former member', 'D26: snapshot label anonymised');
  perform tests.eq((select display_name || '/' || (deleted_at is not null)::text from public.profiles where id = tests.id('rev')),
                   'Former member/true', 'profile anonymised');
  perform tests.ok(not exists (select 1 from public.handover_members where profile_id = tests.id('rev') and removed_at is null),
                   'memberships revoked');
  perform tests.as_service();
  perform tests.throws(format('select public.start_revision(%L, %L)', tests.id('rev'), tests.id('h')), 'BTUA0',
                       'a deleted account can no longer act');
  perform tests.as_owner();
end $$;

-- ── M3: erasure neutralises conversation previews, participant ids and counts ──
-- (an unpublished handover: publishing prunes unreferenced messages, §12.6)
select tests.handover('h3', 'ann', 'outgoing');
select tests.source('h3', 's3');
do $$
declare
  v_conv uuid;
  v_report jsonb;
begin
  insert into public.source_conversations (handover_id, source_id, local_id, started_at, ended_at, message_count, participant_local_ids, preview)
  values (tests.id('h3'), tests.id('s3'), 'c_1', '2026-06-01', '2026-06-04', 9, array['p_alice', 'p_bob', 'p_carol'], 'Alice message 1 about the bank')
  returning id into v_conv;
  update public.source_messages set conversation_id = v_conv where source_id = tests.id('s3');
  -- erase_participant has no application grant (H2, D27); exercised as the database owner.
  v_report := public.erase_participant(gen_random_uuid(), tests.id('h3'), 'phone', sha256(convert_to('alice', 'UTF8')), 'p1', null, tests.id('ann'));
  perform tests.eq((v_report ->> 'messagesDeleted')::int, 3, 'setup: alice''s messages deleted');
  perform tests.ok((select preview is null from public.source_conversations where id = v_conv), 'M3: preview cleared');
  perform tests.eq((select participant_local_ids from public.source_conversations where id = v_conv), array['p_bob', 'p_carol'],
                   'M3: the participant''s local id is removed');
  perform tests.eq((select message_count from public.source_conversations where id = v_conv), 6, 'M3: conversation recounted');
  perform tests.eq((select message_count from public.source_participants where source_id = tests.id('s3') and local_id = 'p_alice'), 0,
                   'M3: participant count zeroed');
  perform tests.eq((select message_count from public.sources where id = tests.id('s3')), 6, 'M3: source recounted');
  perform tests.ok((select started_at = timestamptz '2026-06-02' from public.source_conversations where id = v_conv),
                   'M3: time range recomputed from remaining messages');
end $$;

-- ── M6: rate-limit counters and the 20-use cap ───────────────────────────────
do $$
declare
  v_subject text := repeat('ab', 32);
  i int;
begin
  perform tests.as_service();
  for i in 1..3 loop
    perform tests.ok(public.consume_rate_limit('invite_magic_link_token', v_subject), 'M6: within limit (' || i || ')');
  end loop;
  perform tests.ok(not public.consume_rate_limit('invite_magic_link_token', v_subject), 'M6: 4th magic link in an hour refused');
  perform tests.ok(public.consume_rate_limit('invite_magic_link_token', repeat('cd', 32)), 'M6: other subjects are independent');
  perform tests.throws($q$select public.consume_rate_limit('made_up_scope', repeat('ab', 32))$q$, 'BTVF0', 'M6: unknown scope refused');
  perform tests.throws($q$select public.consume_rate_limit('invite_magic_link_token', '203.0.113.7')$q$, 'BTVF0',
                       'M6: raw identifiers are refused; only SHA-256 digests are stored');
  perform tests.as_owner();
  update public.rate_limit_counters set window_start = now() - interval '2 hours' where subject = v_subject;
  perform tests.as_service();
  perform tests.ok(public.consume_rate_limit('invite_magic_link_token', v_subject), 'M6: a new window starts after expiry');
  perform tests.as_reader('inc');
  perform tests.throws('select count(*) from public.rate_limit_counters', '42501', 'M6: counters are never client-readable');
  perform tests.throws($q$select public.consume_rate_limit('invite_redeem_client', repeat('ab', 32))$q$, '42501',
                       'M6: the browser cannot consume or reset counters');

  -- At most 20 uses per Gap Interview link; invites are single use.
  perform tests.as_user('ann');
  perform tests.throws(format('select public.create_gap_interview_link(tests.actor(), %L, %L, %L, %L, now() + interval ''1 day'', 21)',
                              tests.id('h'), sha256('l21'),
                              array[public.create_gap_question(tests.actor(), tests.id('h'), null, 'owner', 'Who?', null, 'optional')],
                              'everyone'), 'BTVF0', 'M6: 21 uses refused');
  perform tests.as_owner();
  perform tests.throws(format($q$insert into public.access_tokens (handover_id, created_by, purpose, token_hash, expires_at, max_uses)
                                values (%L, %L, 'gap_interview', %L, now() + interval '1 day', 25)$q$,
                              tests.id('h'), tests.id('ann'), sha256('l25')), '23514', 'M6: the table refuses more than 20 uses');
  perform tests.throws(format($q$insert into public.access_tokens (handover_id, created_by, purpose, token_hash, recipient_email, grant_role, expires_at, max_uses)
                                values (%L, %L, 'member_invite', %L, 'x@example.test', 'incoming', now() + interval '1 day', 2)$q$,
                              tests.id('h'), tests.id('ann'), sha256('i2')), '23514', 'invites are single use');
end $$;

select 'ok' as hardening;
