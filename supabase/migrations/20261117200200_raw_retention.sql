-- Round 3 Task 02 (PRIV-2): raw-upload retention (docs/proposals/retention.md §7, policy defaults from §6).
-- ADDITIVE: two tables and new service_role-only functions. No existing function is replaced; nothing here
-- deletes a database row of a handover or any normalized / published content (the purge stays behind D27).
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY, and the sweep stays OFF until the owner enables it
-- (BATON_RETENTION_MODE, docs/round3/privacy-and-data-protection.md).
--
-- Model:
--   * raw_retention_inventory(...)  read-only: what the policy WOULD clean (the dry run), with protection.
--   * claim_raw_for_retention(...)  under locks, re-checks one source, applies its row change
--       pending_upload_expired → state 'removed' (soft removal, like remove_source)
--       raw_ceiling            → state 'failed', error_code 'raw_expired' (uploaded or failed, older than the ceiling)
--       others                 → no state change (already parsed, removed or discarded)
--     moves the object path into raw_retention_items (status 'pending') and clears sources.raw_storage_path,
--     so start_processing can no longer include the source while its object is being deleted.
--   * The server deletes the object through Supabase Storage (service role) and reports the outcome with
--     complete_raw_retention_item: 'deleted' (sources.raw_deleted_at set) or 'failed' (attempts + 1,
--     exponential backoff, visible in raw_retention_report). Storage deletes are idempotent.
--   * Protected (never claimed): a source that is parsing, or that belongs to an active run (queued/running).
--     The claim holds the handover lock (FOR SHARE), so a run cannot start on the source mid-claim.
--   * Retention records hold source and handover ids, the raw path (raw/{uuid}/{uuid}: ids only), reasons,
--     counts and error classes. Never a file name, title, label or content.

create table public.raw_retention_items (
  source_id uuid primary key references public.sources (id) on delete cascade,
  handover_id uuid not null references public.handovers (id) on delete cascade,
  object_path text not null check (object_path ~ '^raw/[0-9A-Za-z-]{1,64}/[0-9A-Za-z-]{1,64}$'),
  reason text not null check (reason in ('handover_deleted', 'removed_raw_pending', 'parsed_raw_pending',
                                         'pending_upload_expired', 'raw_ceiling')),
  status text not null default 'pending' check (status in ('pending', 'deleted', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  last_error text check (last_error in ('storage_error', 'path_refused')),
  claimed_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint raw_retention_items_deleted check ((status = 'deleted') = (deleted_at is not null))
);
create index raw_retention_items_due_idx on public.raw_retention_items (next_attempt_at) where status <> 'deleted';
alter table public.raw_retention_items enable row level security;
revoke all on public.raw_retention_items from public, anon, authenticated, service_role;

create table public.raw_retention_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('dry_run', 'live')),
  trigger text not null check (trigger in ('pg_cron', 'vercel_schedule', 'manual', 'other')),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  policy jsonb not null,
  counts jsonb not null
);
create index raw_retention_runs_finished_idx on public.raw_retention_runs (finished_at desc);
alter table public.raw_retention_runs enable row level security;
revoke all on public.raw_retention_runs from public, anon, authenticated, service_role;

-- Policy guard rails shared by every function (same minimums as list_orphan_upload_candidates).
create function public._raw_retention_check_policy(p_pending_grace interval, p_raw_ceiling interval)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_pending_grace is null or p_pending_grace < interval '2 hours' then
    raise exception 'pending grace must be at least 2 hours' using errcode = 'BTVF0';
  end if;
  if p_raw_ceiling is null or p_raw_ceiling < interval '1 day' or p_raw_ceiling > interval '365 days' then
    raise exception 'raw ceiling must be between 1 and 365 days' using errcode = 'BTVF0';
  end if;
end $$;
revoke execute on function public._raw_retention_check_policy(interval, interval) from public, anon, authenticated, service_role;

-- Why a source's raw upload is eligible now (NULL: not eligible). Same rules as list_orphan_upload_candidates.
create function public._raw_retention_reason(s public.sources, p_handover_deleted boolean, p_pending_grace interval, p_raw_ceiling interval)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when s.raw_storage_path is null then null
    when p_handover_deleted then 'handover_deleted'
    when s.deleted_at is not null or s.state = 'removed' then 'removed_raw_pending'
    when s.state = 'parsed' and s.updated_at < now() - p_pending_grace then 'parsed_raw_pending'
    when s.state = 'pending_upload' and s.created_at < now() - p_pending_grace then 'pending_upload_expired'
    when s.state in ('uploaded', 'failed') and s.created_at < now() - p_raw_ceiling then 'raw_ceiling'
  end
$$;
revoke execute on function public._raw_retention_reason(public.sources, boolean, interval, interval) from public, anon, authenticated, service_role;

-- True while processing may still need the source's raw upload.
create function public._raw_retention_protected(s public.sources)
returns boolean
language sql
stable
set search_path = ''
as $$
  select s.state = 'parsing'
      or exists (select 1 from public.processing_runs r
                  where r.handover_id = s.handover_id and r.status in ('queued', 'running') and s.id = any (r.source_ids))
$$;
revoke execute on function public._raw_retention_protected(public.sources) from public, anon, authenticated, service_role;

-- The dry run: every source the policy would clean now, protected or not, oldest first, plus totals.
create function public.raw_retention_inventory(
  p_pending_grace interval default interval '24 hours',
  p_raw_ceiling interval default interval '7 days',
  p_limit int default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._raw_retention_check_policy(p_pending_grace, p_raw_ceiling);
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'invalid limit' using errcode = 'BTVF0';
  end if;
  return (
    with c as (
      select s.id, s.handover_id, s.state, s.created_at,
             public._raw_retention_reason(s, h.deleted_at is not null, p_pending_grace, p_raw_ceiling) as reason,
             public._raw_retention_protected(s) as protected,
             exists (select 1 from storage.objects o where o.bucket_id = 'source-uploads' and o.name = s.raw_storage_path) as present
        from public.sources s
        join public.handovers h on h.id = s.handover_id
       where s.raw_storage_path is not null
    ), e as (select * from c where reason is not null)
    select jsonb_build_object(
      'eligible', (select count(*) from e where not protected),
      'protected', (select count(*) from e where protected),
      'byReason', coalesce((select jsonb_object_agg(reason, n) from (select reason, count(*) as n from e where not protected group by reason) x), '{}'::jsonb),
      'objectsPresent', (select count(*) from e where present),
      'candidates', coalesce((select jsonb_agg(jsonb_build_object(
          'sourceId', id, 'handoverId', handover_id, 'state', state, 'reason', reason, 'protected', protected,
          'rawObjectPresent', present, 'ageHours', floor(extract(epoch from now() - created_at) / 3600))
          order by created_at, id)
        from (select * from e order by created_at, id limit p_limit) l), '[]'::jsonb))
  );
end $$;

-- Claims ONE source for deletion. Returns {"claimed": true, "reason", "path"} or {"claimed": false, "why"}.
-- Lock order: handover FOR SHARE, then the source FOR UPDATE (start_processing and remove_source lock the
-- handover first too), so a run cannot start on this source between the check and the row change.
create function public.claim_raw_for_retention(
  p_source_id uuid,
  p_pending_grace interval default interval '24 hours',
  p_raw_ceiling interval default interval '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.sources;
  v_h public.handovers;
  v_reason text;
begin
  perform public._raw_retention_check_policy(p_pending_grace, p_raw_ceiling);
  select * into v_s from public.sources where id = p_source_id;
  if not found then
    return jsonb_build_object('claimed', false, 'why', 'not_found');
  end if;
  select * into v_h from public.handovers where id = v_s.handover_id for share;
  select * into v_s from public.sources where id = p_source_id for update;
  v_reason := public._raw_retention_reason(v_s, v_h.deleted_at is not null, p_pending_grace, p_raw_ceiling);
  if v_reason is null then
    return jsonb_build_object('claimed', false, 'why', 'not_eligible');
  end if;
  if public._raw_retention_protected(v_s) then
    return jsonb_build_object('claimed', false, 'why', 'protected');
  end if;
  if v_s.raw_storage_path !~ '^raw/[0-9A-Za-z-]{1,64}/[0-9A-Za-z-]{1,64}$'
     or split_part(v_s.raw_storage_path, '/', 3) <> v_s.id::text
     or split_part(v_s.raw_storage_path, '/', 2) <> v_s.handover_id::text then
    return jsonb_build_object('claimed', false, 'why', 'path_refused'); -- never delete an object that is not this source's
  end if;

  if v_reason = 'pending_upload_expired' then
    update public.sources set state = 'removed', deleted_at = coalesce(deleted_at, now()) where id = v_s.id;
  elsif v_reason = 'raw_ceiling' then
    update public.sources set state = 'failed', error_code = 'raw_expired' where id = v_s.id;
  end if;
  insert into public.raw_retention_items (source_id, handover_id, object_path, reason)
  values (v_s.id, v_s.handover_id, v_s.raw_storage_path, v_reason)
  on conflict (source_id) do update
     set object_path = excluded.object_path, reason = excluded.reason, status = 'pending', last_error = null,
         claimed_at = now(), next_attempt_at = now(), deleted_at = null, updated_at = now();
  update public.sources set raw_storage_path = null where id = v_s.id;
  perform public._audit(v_s.handover_id, null, null, 'source.raw_retention_claimed', 'source', v_s.id,
                        jsonb_build_object('state', v_s.state), jsonb_build_object('reason', v_reason));
  return jsonb_build_object('claimed', true, 'reason', v_reason, 'path', v_s.raw_storage_path);
end $$;

-- Items whose object still has to be deleted (new claims and failed retries that are due), oldest first.
create function public.due_raw_retention_items(p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'invalid limit' using errcode = 'BTVF0';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('sourceId', i.source_id, 'handoverId', i.handover_id, 'path', i.object_path,
                                        'reason', i.reason, 'attempts', i.attempts) order by i.next_attempt_at, i.source_id)
      from (select * from public.raw_retention_items
             where status <> 'deleted' and next_attempt_at <= now()
             order by next_attempt_at, source_id limit p_limit) i), '[]'::jsonb);
end $$;

-- Records the outcome of one storage delete. Idempotent: a repeated 'deleted' changes nothing.
create function public.complete_raw_retention_item(p_source_id uuid, p_outcome text, p_error text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.raw_retention_items;
begin
  if p_outcome is null or p_outcome not in ('deleted', 'failed') then
    raise exception 'invalid outcome' using errcode = 'BTVF0';
  end if;
  if p_outcome = 'failed' and (p_error is null or p_error not in ('storage_error', 'path_refused')) then
    raise exception 'invalid error class' using errcode = 'BTVF0';
  end if;
  select * into v_i from public.raw_retention_items where source_id = p_source_id for update;
  if not found then
    raise exception 'retention item not found' using errcode = 'BTNF0';
  end if;
  if v_i.status = 'deleted' then
    return 'deleted';
  end if;
  if p_outcome = 'deleted' then
    update public.raw_retention_items
       set status = 'deleted', deleted_at = now(), last_error = null, attempts = attempts + 1, updated_at = now()
     where source_id = p_source_id;
    update public.sources set raw_deleted_at = coalesce(raw_deleted_at, now())
     where id = p_source_id and raw_storage_path is null;
    perform public._audit(v_i.handover_id, null, null, 'source.raw_deleted', 'source', p_source_id, null,
                          jsonb_build_object('reason', v_i.reason, 'via', 'retention'));
    return 'deleted';
  end if;
  update public.raw_retention_items
     set status = 'failed', attempts = attempts + 1, last_error = p_error, updated_at = now(),
         -- 5 min, 10 min, 20 min … capped at 24 h; a failing item keeps retrying and stays visible
         next_attempt_at = now() + least(interval '24 hours', interval '5 minutes' * power(2, least(attempts, 12)))
   where source_id = p_source_id;
  return 'failed';
end $$;

create function public.record_raw_retention_run(p_mode text, p_trigger text, p_started_at timestamptz, p_policy jsonb, p_counts jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_policy) <> 'object' or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'policy and counts must be objects' using errcode = 'BTVF0';
  end if;
  insert into public.raw_retention_runs (mode, trigger, started_at, policy, counts)
  values (p_mode, p_trigger, p_started_at, p_policy, p_counts) returning id into v_id;
  delete from public.raw_retention_runs where finished_at < now() - interval '90 days';
  return v_id;
end $$;

-- The repeatable operational report: counts only, no paths, names or content.
create function public.raw_retention_report(
  p_pending_grace interval default interval '24 hours',
  p_raw_ceiling interval default interval '7 days'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv jsonb;
begin
  v_inv := public.raw_retention_inventory(p_pending_grace, p_raw_ceiling, 1);
  return jsonb_build_object(
    'generatedAt', now(),
    'policy', jsonb_build_object('pendingGraceHours', extract(epoch from p_pending_grace) / 3600,
                                 'rawCeilingDays', extract(epoch from p_raw_ceiling) / 86400),
    'eligibleNow', v_inv -> 'eligible',
    'protectedNow', v_inv -> 'protected',
    'eligibleByReason', v_inv -> 'byReason',
    'rawUploadsHeld', (select count(*) from public.sources where raw_storage_path is not null),
    'oldestRawUploadHours', (select floor(extract(epoch from now() - min(created_at)) / 3600)
                               from public.sources where raw_storage_path is not null),
    'items', jsonb_build_object(
      'pending', (select count(*) from public.raw_retention_items where status = 'pending'),
      'failed', (select count(*) from public.raw_retention_items where status = 'failed'),
      'failingRepeatedly', (select count(*) from public.raw_retention_items where status = 'failed' and attempts >= 3),
      'deleted', (select count(*) from public.raw_retention_items where status = 'deleted'),
      'oldestUndeletedHours', (select floor(extract(epoch from now() - min(claimed_at)) / 3600)
                                 from public.raw_retention_items where status <> 'deleted')),
    'lastRuns', coalesce((select jsonb_agg(jsonb_build_object('mode', r.mode, 'trigger', r.trigger, 'finishedAt', r.finished_at,
                                                              'counts', r.counts) order by r.finished_at desc)
                            from (select * from public.raw_retention_runs order by finished_at desc limit 5) r), '[]'::jsonb));
end $$;

revoke execute on function public.raw_retention_inventory(interval, interval, int) from public, anon, authenticated, service_role;
revoke execute on function public.claim_raw_for_retention(uuid, interval, interval) from public, anon, authenticated, service_role;
revoke execute on function public.due_raw_retention_items(int) from public, anon, authenticated, service_role;
revoke execute on function public.complete_raw_retention_item(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.record_raw_retention_run(text, text, timestamptz, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.raw_retention_report(interval, interval) from public, anon, authenticated, service_role;
grant execute on function public.raw_retention_inventory(interval, interval, int) to service_role;
grant execute on function public.claim_raw_for_retention(uuid, interval, interval) to service_role;
grant execute on function public.due_raw_retention_items(int) to service_role;
grant execute on function public.complete_raw_retention_item(uuid, text, text) to service_role;
grant execute on function public.record_raw_retention_run(text, text, timestamptz, jsonb, jsonb) to service_role;
grant execute on function public.raw_retention_report(interval, interval) to service_role;
