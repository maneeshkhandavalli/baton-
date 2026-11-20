-- Round 3 Task 02 (PRIV-1): participant pseudonymisation and the encrypted identity vault.
-- ADDITIVE: one table, one nullable column on sources, new functions. No existing function is replaced.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY (docs/architecture/privacy-and-data-protection.md).
--
-- * public.handover_people: one row per KNOWN participant of a handover (a chat sender). `ordinal` is the
--   stable placeholder number ([PERSON_n]) used in every source of the handover. `person_key` is
--   HMAC(server key, handover id ‖ identity), so it is keyed and handover-scoped: the same person has
--   unrelated keys in different handovers. `sealed_label` is the masked display label encrypted with
--   AES-256-GCM on the application server (the database never sees the key or the plaintext). NULL when the
--   sender has no usable name (phone-number senders).
-- * No role has any direct privilege on the table and RLS is on with no policy: the browser (anon,
--   authenticated) can never read it, and even service_role reaches it only through the functions below.
-- * Writers and readers for the pipeline are FENCED by the job claim (DB-12): only a live parse job may add
--   people; only live parse / extract / verify_support jobs may read the sealed labels.
-- * resolve_handover_people returns sealed labels only to a member of the (live) handover, and only for
--   people who appear as a participant of a parsed source within that member's clearance. Decryption
--   happens on the server, after this check.
-- * sources.identity_scheme marks sources whose stored content was pseudonymised ('person_v1'); NULL is a
--   legacy source parsed before this migration (plain-text names).

create table public.handover_people (
  handover_id uuid not null references public.handovers (id) on delete cascade,
  ordinal int not null check (ordinal between 1 and 100000),
  person_key bytea not null check (length(person_key) = 32),
  sealed_label bytea check (sealed_label is null or length(sealed_label) between 29 and 8192),
  key_version text not null check (key_version in ('k1')),
  created_at timestamptz not null default now(),
  primary key (handover_id, ordinal),
  constraint handover_people_person_key unique (handover_id, person_key)
);
alter table public.handover_people enable row level security;
revoke all on public.handover_people from public, anon, authenticated, service_role;

alter table public.sources add column identity_scheme text check (identity_scheme in ('person_v1'));

-- People as jsonb for the server: ordinal, person key (hex), sealed label (base64) and key version.
create function public._handover_people_json(p_handover_id uuid, p_ordinals int[] default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'ordinal', p.ordinal,
           'personKey', encode(p.person_key, 'hex'),
           'sealed', case when p.sealed_label is null then null else encode(p.sealed_label, 'base64') end,
           'keyVersion', p.key_version) order by p.ordinal), '[]'::jsonb)
    from public.handover_people p
   where p.handover_id = p_handover_id and (p_ordinals is null or p.ordinal = any (p_ordinals))
$$;
revoke execute on function public._handover_people_json(uuid, int[]) from public, anon, authenticated, service_role;

-- Parse job only (fenced). Adds every person not yet known (by person key) with the next free ordinals,
-- in input order, and returns ALL the handover's people. Serialised per handover, so two parse jobs never
-- hand out the same ordinal. Input: [{"personKey": hex64, "sealed": base64|null, "keyVersion": "k1"}, ...]
create function public.pipeline_reserve_handover_people(
  p_job_id uuid, p_attempt int, p_people jsonb, p_claim_generation bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_next int;
begin
  if p_claim_generation is not null then
    perform public._pipeline_use_generation(p_claim_generation);
  end if;
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['parse']);
  perform set_config('baton.claim_generation', '', true);
  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) > 5000 then
    raise exception 'people must be an array of at most 5000 entries' using errcode = 'BTVF0';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_people) e
     where coalesce(e ->> 'personKey', '') !~ '^[0-9a-f]{64}$'
        or coalesce(e ->> 'keyVersion', '') <> 'k1'
        or (e -> 'sealed' is not null and jsonb_typeof(e -> 'sealed') not in ('string', 'null'))
  ) then
    raise exception 'invalid person entry' using errcode = 'BTVF0';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('baton.handover_people:' || v_job.handover_id::text, 0));
  select coalesce(max(ordinal), 0) into v_next from public.handover_people where handover_id = v_job.handover_id;
  insert into public.handover_people (handover_id, ordinal, person_key, sealed_label, key_version)
  select v_job.handover_id, v_next + row_number() over (order by n.first_idx), n.pk, n.sealed, 'k1'
    from (
      select decode(e ->> 'personKey', 'hex') as pk,
             min(i) as first_idx,
             (array_agg(case when jsonb_typeof(e -> 'sealed') = 'string' then decode(e ->> 'sealed', 'base64') end order by i))[1] as sealed
        from jsonb_array_elements(p_people) with ordinality as x(e, i)
       group by decode(e ->> 'personKey', 'hex')
    ) n
   where not exists (select 1 from public.handover_people p where p.handover_id = v_job.handover_id and p.person_key = n.pk);
  return public._handover_people_json(v_job.handover_id);
end $$;

-- Parse, extract and verify_support jobs (fenced): the handover's people, and whether the job's own source
-- (if any) was pseudonymised. The sealed labels are decrypted only in the worker's memory.
create function public.pipeline_list_handover_people(p_job_id uuid, p_attempt int, p_claim_generation bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_scheme text;
begin
  if p_claim_generation is not null then
    perform public._pipeline_use_generation(p_claim_generation);
  end if;
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['parse', 'extract', 'verify_support']);
  perform set_config('baton.claim_generation', '', true);
  if v_job.source_id is not null then
    select identity_scheme into v_scheme from public.sources where id = v_job.source_id;
  end if;
  return jsonb_build_object('people', public._handover_people_json(v_job.handover_id), 'sourceIdentityScheme', v_scheme);
end $$;

-- Parse job only (fenced): persists exactly like pipeline_persist_parsed_source, then checks that every
-- participant label is a [PERSON_n] placeholder of a known person of this handover and marks the source
-- 'person_v1'. One transaction: a source is never stored half-pseudonymised.
create function public.pipeline_persist_pseudonymized_source(
  p_job_id uuid, p_attempt int, p_parsed jsonb, p_pepper_version text, p_claim_generation bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  if p_claim_generation is not null then
    perform public._pipeline_use_generation(p_claim_generation);
  end if;
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['parse']);
  if v_job.source_id is null then
    raise exception 'parse job without a source' using errcode = 'BTVF0';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_parsed -> 'participants', '[]'::jsonb)) p
     where coalesce(p ->> 'displayLabel', '') !~ '^\[PERSON_[1-9][0-9]{0,5}\]$'
        or not exists (select 1 from public.handover_people hp
                        where hp.handover_id = v_job.handover_id
                          and hp.ordinal = substring(p ->> 'displayLabel' from '^\[PERSON_([0-9]+)\]$')::int)
  ) then
    raise exception 'every participant label must be a known [PERSON_n] placeholder' using errcode = 'BTVF0';
  end if;
  perform public.persist_parsed_source(v_job.source_id, p_parsed, p_pepper_version);
  update public.sources set identity_scheme = 'person_v1' where id = v_job.source_id;
  perform set_config('baton.claim_generation', '', true);
end $$;

-- Server actions (service_role) on behalf of a verified actor: sealed labels of the people this member may
-- see. A person is visible when they are a participant of a parsed, live source of the handover whose
-- access level is within the actor's clearance. Non-members, deleted handovers and unknown handovers get
-- not_found (BTNF0): the caller cannot tell them apart.
create function public.resolve_handover_people(p_actor_profile_id uuid, p_handover_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_ordinals int[];
begin
  if not exists (select 1 from public.handovers h where h.id = p_handover_id and h.deleted_at is null)
     or public._clearance_of(p_handover_id, v_actor) is null then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  select array_agg(distinct substring(sp.display_label from '^\[PERSON_([0-9]+)\]$')::int)
    into v_ordinals
    from public.source_participants sp
    join public.sources s on s.id = sp.source_id
   where sp.handover_id = p_handover_id
     and sp.display_label ~ '^\[PERSON_[1-9][0-9]{0,5}\]$'
     and s.deleted_at is null and s.state = 'parsed' and s.identity_scheme = 'person_v1'
     and public._within_clearance_as(v_actor, p_handover_id, s.access_level);
  if v_ordinals is null then
    return '[]'::jsonb;
  end if;
  return public._handover_people_json(p_handover_id, v_ordinals);
end $$;

-- Operator report (service_role, read-only): legacy plain-text identities that predate this migration.
-- Counts and ids only; never a label, name or message.
create function public.identity_backfill_report()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with legacy as (
    select s.handover_id, s.id as source_id, s.kind
      from public.sources s
     where s.state = 'parsed' and s.deleted_at is null and s.identity_scheme is null
  ), per_handover as (
    select h.id as handover_id, h.state,
           (h.deleted_at is not null) as deleted,
           exists (select 1 from public.handover_publications p where p.handover_id = h.id) as published,
           count(distinct l.source_id) as legacy_sources,
           count(distinct l.source_id) filter (where l.kind = 'whatsapp_export') as legacy_chat_sources,
           (select count(*) from public.source_participants sp
             where sp.handover_id = h.id and sp.source_id in (select source_id from legacy)
               and sp.display_label !~ '^Participant [0-9]+$') as named_participants,
           (select count(*) from public.source_messages m where m.source_id in (select source_id from legacy l2 where l2.handover_id = h.id)) as legacy_messages,
           (select count(*) from public.handover_points pt where pt.handover_id = h.id) as points
      from public.handovers h
      join legacy l on l.handover_id = h.id
     group by h.id, h.state, h.deleted_at
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'totals', jsonb_build_object(
      'handovers', (select count(*) from per_handover),
      'publishedHandovers', (select count(*) from per_handover where published),
      'draftHandovers', (select count(*) from per_handover where not published and not deleted),
      'deletedHandovers', (select count(*) from per_handover where deleted),
      'legacySources', (select coalesce(sum(legacy_sources), 0) from per_handover),
      'namedParticipants', (select coalesce(sum(named_participants), 0) from per_handover),
      'legacyMessages', (select coalesce(sum(legacy_messages), 0) from per_handover)),
    'handovers', coalesce((select jsonb_agg(jsonb_build_object(
        'handoverId', handover_id, 'state', state, 'deleted', deleted, 'published', published,
        'legacySources', legacy_sources, 'legacyChatSources', legacy_chat_sources,
        'namedParticipants', named_participants, 'legacyMessages', legacy_messages, 'points', points,
        'action', case when deleted then 'none: discarded (purge stays behind D27)'
                       when published then 'keep: published content is never rewritten; names stay visible under existing clearance'
                       else 're-upload to pseudonymise: the new source is parsed with [PERSON_n] placeholders' end)
        order by handover_id) from per_handover), '[]'::jsonb))
$$;

revoke execute on function public.pipeline_reserve_handover_people(uuid, int, jsonb, bigint) from public, anon, authenticated, service_role;
revoke execute on function public.pipeline_list_handover_people(uuid, int, bigint) from public, anon, authenticated, service_role;
revoke execute on function public.pipeline_persist_pseudonymized_source(uuid, int, jsonb, text, bigint) from public, anon, authenticated, service_role;
revoke execute on function public.resolve_handover_people(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.identity_backfill_report() from public, anon, authenticated, service_role;
grant execute on function public.pipeline_reserve_handover_people(uuid, int, jsonb, bigint) to service_role;
grant execute on function public.pipeline_list_handover_people(uuid, int, bigint) to service_role;
grant execute on function public.pipeline_persist_pseudonymized_source(uuid, int, jsonb, text, bigint) to service_role;
grant execute on function public.resolve_handover_people(uuid, uuid) to service_role;
grant execute on function public.identity_backfill_report() to service_role;
