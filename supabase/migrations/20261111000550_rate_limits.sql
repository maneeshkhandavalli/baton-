-- Rate limiting (D12: "Postgres-backed counters, no new infrastructure"; §12.4 "redemption is rate-limited
-- per IP and per token"). Audit finding M6.
--
-- ARCHITECTURE PROPOSAL (§13.3): §6 defines no entity for these counters. This table is new and must be
-- reviewed by main before adoption. It holds no personal data: subjects are SHA-256 hex digests computed on
-- the server (of the token hash, or of the client IP), never raw IPs or tokens.
--
-- A counter is consumed in ITS OWN request, before the protected operation runs, so it is committed even
-- when that operation later fails (an invalid token must still count). lib/db/rate-limit.ts does this for
-- every token and invitation path.

create table public.rate_limit_counters (
  scope text not null check (scope in (
    'gap_interview_view_client', 'gap_interview_view_token',
    'gap_interview_submit_client', 'gap_interview_submit_token',
    'invite_magic_link_client', 'invite_magic_link_token',
    'invite_redeem_client', 'invite_redeem_token')),
  subject text not null check (subject ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits int not null check (hits >= 1),
  primary key (scope, subject)
);
alter table public.rate_limit_counters enable row level security; -- no policies: server only

-- Limits live here, not with the caller. Returns true while the subject is within its limit.
create function public.consume_rate_limit(p_scope text, p_subject text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_window interval;
  v_hits int;
begin
  select l.max_hits, l.win into v_limit, v_window
    from (values
      ('gap_interview_view_client',   60, interval '10 minutes'),
      ('gap_interview_view_token',   300, interval '1 hour'),
      ('gap_interview_submit_client', 10, interval '10 minutes'),
      ('gap_interview_submit_token',  30, interval '1 hour'),
      ('invite_magic_link_client',     5, interval '1 hour'),
      ('invite_magic_link_token',      3, interval '1 hour'),
      ('invite_redeem_client',        10, interval '10 minutes'),
      ('invite_redeem_token',         10, interval '1 hour')
    ) as l (scope, max_hits, win)
   where l.scope = p_scope;
  if v_limit is null then
    raise exception 'unknown rate-limit scope' using errcode = 'BTVF0';
  end if;
  if p_subject is null or p_subject !~ '^[0-9a-f]{64}$' then
    raise exception 'rate-limit subject must be a SHA-256 hex digest' using errcode = 'BTVF0';
  end if;

  insert into public.rate_limit_counters as c (scope, subject, window_start, hits)
  values (p_scope, p_subject, now(), 1)
  on conflict (scope, subject) do update
     set hits = case when c.window_start <= now() - v_window then 1 else c.hits + 1 end,
         window_start = case when c.window_start <= now() - v_window then now() else c.window_start end
  returning hits into v_hits;
  return v_hits <= v_limit;
end $$;

-- Retention sweep (cron, service role): counters older than the longest window are useless.
create function public.prune_rate_limit_counters()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v int;
begin
  delete from public.rate_limit_counters where window_start < now() - interval '1 day';
  get diagnostics v = row_count;
  return v;
end $$;
