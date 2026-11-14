-- Round 3 (Agent 3): migration 20261113200400 — source_upload_target also returns `kind`; everything else
-- (fields, checks, grants) is unchanged.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'eve']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');

select tests.as_user('ann');
select tests.put('chat', public.create_source(tests.actor(), tests.id('h'), 'whatsapp_export', 'chat.zip', 'application/zip', 10,
                                              encode(sha256('kind chat'::bytea), 'hex')));
select tests.put('pdf', public.create_source(tests.actor(), tests.id('h'), 'pdf', 'report.pdf', 'application/pdf', 20,
                                             encode(sha256('kind pdf'::bytea), 'hex')));

select tests.eq(public.source_upload_target(tests.actor(), tests.id('chat')) ->> 'kind', 'whatsapp_export', 'kind of a chat export');
select tests.eq(public.source_upload_target(tests.actor(), tests.id('pdf')) ->> 'kind', 'pdf', 'kind of a PDF');
select tests.eq((select array_agg(k order by k) from jsonb_object_keys(public.source_upload_target(tests.actor(), tests.id('pdf'))) k),
                array['kind', 'raw_storage_path', 'sha256', 'size_bytes'], 'only one field was added');
select tests.eq(public.source_upload_target(tests.actor(), tests.id('pdf')) ->> 'raw_storage_path',
                'raw/' || tests.id('h') || '/' || tests.id('pdf'), 'path unchanged');
select tests.eq((public.source_upload_target(tests.actor(), tests.id('pdf')) ->> 'size_bytes')::bigint, 20::bigint, 'size unchanged');
select tests.eq(public.source_upload_target(tests.actor(), tests.id('pdf')) ->> 'sha256', encode(sha256('kind pdf'::bytea), 'hex'), 'checksum unchanged');

-- the checks are unchanged
select tests.as_user('rev');
select tests.throws(format('select public.source_upload_target(%L, %L)', tests.id('rev'), tests.id('pdf')), 'BTFB0', 'a reviewer does not manage sources');
select tests.as_user('eve');
select tests.throws(format('select public.source_upload_target(%L, %L)', tests.id('eve'), tests.id('pdf')), 'BTNF0', 'an outsider sees nothing');
select tests.as_owner();
insert into storage.objects (bucket_id, name, metadata)
select 'source-uploads', raw_storage_path, '{"size": "20"}'::jsonb from public.sources where id = tests.id('pdf');
select tests.as_user('ann');
select public.confirm_source_uploaded(tests.actor(), tests.id('pdf'), 20, encode(sha256('kind pdf'::bytea), 'hex'));
select tests.throws(format('select public.source_upload_target(%L, %L)', tests.id('ann'), tests.id('pdf')), 'BTIT0', 'only while awaiting upload');
select public.remove_source(tests.actor(), tests.id('chat'));
select tests.throws(format('select public.source_upload_target(%L, %L)', tests.id('ann'), tests.id('chat')), 'BTNF0', 'removed sources are not found');

-- grants are unchanged by the replace
select tests.as_owner();
select tests.ok(has_function_privilege('service_role', 'public.source_upload_target(uuid, uuid)', 'execute'), 'service_role keeps execute');
select tests.ok(not has_function_privilege('authenticated', 'public.source_upload_target(uuid, uuid)', 'execute'), 'authenticated has none');
