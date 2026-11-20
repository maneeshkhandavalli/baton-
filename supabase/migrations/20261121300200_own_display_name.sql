-- Round 4 A (audit D1): people can choose the name others see, instead of the email prefix.
--
-- set_own_display_name(actor, name): the signed-in user changes their OWN profiles.display_name. Server-only (the
-- same actor rules as every mutation: _require_actor), SECURITY DEFINER, executable by service_role only.
--   * trimmed, inner whitespace collapsed, 1 to 60 characters;
--   * no control characters and no square brackets (names can't imitate a masking token such as [PERSON_1]);
--   * "Former member" is reserved for deleted accounts;
--   * a deleted (anonymised) profile can't be renamed.
-- Same-name clashes inside a handover are already told apart by _handover_label (" #abcd"). Labels snapshotted into
-- existing publications, evidence and answers are NOT rewritten (they record who said what at the time); live
-- labels (members, "published by") follow the new name. Additive: one new function, no table change.
-- Rollback: drop function public.set_own_display_name(uuid, text);

create or replace function public.set_own_display_name(p_actor_profile_id uuid, p_display_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_name text := regexp_replace(btrim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
begin
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'a display name needs 1 to 60 characters' using errcode = 'BTVF0';
  end if;
  if v_name ~ '[[:cntrl:]]' or v_name ~ '[\[\]]' then
    raise exception 'a display name cannot contain control characters or square brackets' using errcode = 'BTVF0';
  end if;
  if lower(v_name) = 'former member' then
    raise exception 'that name is reserved' using errcode = 'BTVF0';
  end if;
  update public.profiles set display_name = v_name where id = v_actor and deleted_at is null;
  if not found then
    raise exception 'profile not found' using errcode = 'BTNF0';
  end if;
  return v_name;
end $$;

revoke execute on function public.set_own_display_name(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_own_display_name(uuid, text) to service_role;
