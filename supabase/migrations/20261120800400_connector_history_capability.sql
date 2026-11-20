-- PR #7 review, finding 1 (2026-11-20): a provider WITHOUT history import (Telegram) must never obtain a back-dated
-- capture window. connector_record_capture_consent back-dates the FIRST window by the link's consented history days;
-- the app now refuses historyDays for such providers before writing anything, and this migration makes it a database
-- invariant on every path (consent, resume, backfill, a direct insert): a window of a link whose provider has no
-- history import may not open before the link's consent time.
--
-- ADDITIVE: one helper, one trigger function, one trigger. No existing function, row or grant is changed. Existing
-- windows are not re-validated (the trigger fires on INSERT and on UPDATE OF opened_at only). Slack, Discord and
-- GitHub keep their consented-history behaviour.

-- Mirrors lib/connectors/types.ts CONNECTOR_HISTORY_PROVIDERS (adapters with fetchHistory).
create function public._connector_provider_has_history(p_provider text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_provider in ('github', 'discord', 'slack') $$;

create function public._trg_connector_capture_window_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_consented timestamptz;
begin
  select i.provider, l.consented_at into v_provider, v_consented
    from public.connector_channel_links l
    join public.connector_installations i on i.id = l.installation_id
   where l.id = new.link_id;
  if v_provider is not null and not public._connector_provider_has_history(v_provider)
     and (v_consented is null or new.opened_at < v_consented) then
    raise exception 'this provider cannot capture messages sent before consent' using errcode = 'BTVF0';
  end if;
  return new;
end $$;

create trigger connector_capture_windows_history
  before insert or update of opened_at on public.connector_capture_windows
  for each row execute function public._trg_connector_capture_window_history();

revoke all on function public._connector_provider_has_history(text),
                       public._trg_connector_capture_window_history() from public, anon, authenticated, service_role;
