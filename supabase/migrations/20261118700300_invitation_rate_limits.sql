-- Round 3 Task 06: rate limits for invitation details and invitation email (docs/round3/task06-contract.md §3.2 item 6).
-- ADDITIVE: four new scopes in the rate_limit_counters CHECK and in consume_rate_limit's fixed list. Every existing scope
-- keeps exactly its limit and window; existing counters are untouched.
--
--   invite_view_client      60 / 10 minutes   per hashed client IP    (getInvitation)
--   invite_view_token      120 / hour         per token hash          (getInvitation)
--   invite_send_actor       20 / hour         per hashed creator id   (inviteMember, reissueInvitation)
--   invite_send_recipient    5 / hour         per hashed address      (inviteMember, reissueInvitation)
-- The send limits are consumed BEFORE the invitation is created, so an exceeded limit creates no token and sends no
-- email: Baton can never be used to send large amounts of email to one address.

alter table public.rate_limit_counters
  drop constraint rate_limit_counters_scope_check,
  add constraint rate_limit_counters_scope_check check (scope in (
    'gap_interview_view_client', 'gap_interview_view_token',
    'gap_interview_submit_client', 'gap_interview_submit_token',
    'invite_magic_link_client', 'invite_magic_link_token',
    'invite_redeem_client', 'invite_redeem_token',
    'invite_view_client', 'invite_view_token',
    'invite_send_actor', 'invite_send_recipient'));

create or replace function public.consume_rate_limit(p_scope text, p_subject text)
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
      ('invite_redeem_token',         10, interval '1 hour'),
      ('invite_view_client',          60, interval '10 minutes'),
      ('invite_view_token',          120, interval '1 hour'),
      ('invite_send_actor',           20, interval '1 hour'),
      ('invite_send_recipient',        5, interval '1 hour')
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
