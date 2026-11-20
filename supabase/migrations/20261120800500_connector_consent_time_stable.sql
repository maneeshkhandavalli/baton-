-- PR #7 history-retry follow-up (2026-11-20): confirming consent again on a link that is ALREADY capturing must not
-- move its consent time. consented_at anchors (a) the first capture window's start (consented_at − history days),
-- (b) the consent-time history interval a retry must fetch again, (c) the history batch delivery ids, and (d) Discord's
-- initial pull cursor when no cursor exists yet. Overwriting it with now() on every confirmation moved all four.
--
-- Semantics (unchanged otherwise, identical to MemoryConnectorStore.recordCaptureConsent):
--   first consent          → consented_at = now(); first window opens at now() − consented history days
--   consent after a pause  → consented_at = now(); a new window opens at now()
--   already capturing      → consented_at and consented_by_profile_id are kept; no window is opened; the consent
--                            version is still recorded and the confirmation is audited
--
-- ADDITIVE: CREATE OR REPLACE of one function with the same signature, security mode and search_path (grants are
-- kept). No data is changed.

create or replace function public.connector_record_capture_consent(p_actor_kind text, p_actor_profile_id uuid, p_link_id uuid, p_consent_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_l public.connector_channel_links := public._connector_lock_link(p_link_id);
  v_first boolean;
  v_was_capturing boolean;
begin
  perform public._connector_require_creator(v_actor, v_l.handover_id);
  if v_l.state = 'revoked' then
    raise exception 'this channel was disconnected' using errcode = 'BTIT0';
  end if;
  if p_consent_version is null or p_consent_version !~ '^[a-z0-9-]{1,80}$' then
    raise exception 'consent statement is required' using errcode = 'BTVF0';
  end if;
  if not exists (select 1 from public.connector_installations i where i.id = v_l.installation_id and i.status = 'active') then
    raise exception 'this connection is not active' using errcode = 'BTIT0';
  end if;
  v_first := v_l.consented_at is null;
  v_was_capturing := v_l.state = 'capturing' and v_l.consented_at is not null;
  update public.connector_channel_links
     set state = 'capturing', consent_version = p_consent_version,
         consented_at = case when v_was_capturing then v_l.consented_at else now() end,
         consented_by_profile_id = case when v_was_capturing then v_l.consented_by_profile_id else v_actor end,
         last_flush_error = null
   where id = v_l.id
  returning * into v_l;
  if not v_was_capturing then
    perform public._connector_open_capture_window(
      v_l.id,
      case when v_first then v_l.consented_at - make_interval(days => public._connector_history_days(v_l.settings))
           else v_l.consented_at end);
  end if;
  perform public._audit(v_l.handover_id, v_actor, null, 'connector.capture_consented', 'connector_link', v_l.id, null,
                        jsonb_build_object('consentVersion', p_consent_version));
  return public._connector_link_json(v_l);
end $$;
