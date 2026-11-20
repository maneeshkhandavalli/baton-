-- Round 4 (Agent E): the sealed Gmail refresh token for invitation delivery (lib/email/gmail-store.ts).
--
-- One row per provider (only 'gmail'). The database only ever holds the SEALED envelope produced by
-- lib/connectors/secrets.ts (AES-256-GCM, "<version>.<iv>.<tag>.<ciphertext>", bound to the sender address), never the
-- refresh token itself. The only scope ever stored is gmail.send.
--
-- Access: RLS on, no policies, every table grant revoked (including service_role). The server reaches the row only
-- through the functions below, which only service_role may execute. Browser roles (anon, authenticated) can
-- neither read nor write anything here.
--
-- Additive and idempotent: safe to re-run; no existing table is touched.

create table if not exists public.email_sender_credentials (
  provider text primary key check (provider = 'gmail'),
  sender_email text not null check (length(sender_email) between 3 and 254 and sender_email = lower(sender_email)
                                    and sender_email ~ '^[^[:space:]<>@",;:()]+@[^[:space:]<>@",;:()]+\.[^[:space:]<>@",;:()]+$'),
  sealed_refresh_token text not null check (length(sealed_refresh_token) <= 8192
                                            and sealed_refresh_token ~ '^[a-z0-9]{1,8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  scopes text[] not null check (scopes = array['https://www.googleapis.com/auth/gmail.send']::text[]),
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.email_sender_credentials enable row level security;
-- no policies: server only

revoke all on public.email_sender_credentials from public, anon, authenticated, service_role;

create or replace function public.email_sender_credentials_put(
  p_provider text, p_sender_email text, p_sealed_refresh_token text, p_scopes text[], p_connected_by uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_sender_credentials as c (provider, sender_email, sealed_refresh_token, scopes, connected_by)
  values (p_provider, lower(p_sender_email), p_sealed_refresh_token, p_scopes, p_connected_by)
  on conflict (provider) do update
    set sender_email = excluded.sender_email,
        sealed_refresh_token = excluded.sealed_refresh_token,
        scopes = excluded.scopes,
        connected_by = excluded.connected_by,
        connected_at = now(),
        updated_at = now();
end $$;

create or replace function public.email_sender_credentials_get(p_provider text)
returns table (sender_email text, sealed_refresh_token text, connected_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.sender_email, c.sealed_refresh_token, c.connected_at
    from public.email_sender_credentials c
   where c.provider = p_provider
$$;

create or replace function public.email_sender_credentials_clear(p_provider text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.email_sender_credentials where provider = p_provider
$$;

revoke execute on function
  public.email_sender_credentials_put(text, text, text, text[], uuid),
  public.email_sender_credentials_get(text),
  public.email_sender_credentials_clear(text)
  from public, anon, authenticated;

grant execute on function
  public.email_sender_credentials_put(text, text, text, text[], uuid),
  public.email_sender_credentials_get(text),
  public.email_sender_credentials_clear(text)
  to service_role;
