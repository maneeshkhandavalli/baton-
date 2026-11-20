-- Round 4 (Agent E): migration 20261121400100_email_sender_credentials. Synthetic values only (no real token).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['own', 'mal']) u;

-- ── 0. browser roles have no access at all ───────────────────────────────────
do $$
begin
  perform tests.as_reader('mal');
  perform tests.throws('select * from public.email_sender_credentials', '42501', 'authenticated cannot read the table');
  perform tests.throws($q$insert into public.email_sender_credentials (provider, sender_email, sealed_refresh_token, scopes)
                          values ('gmail', 'x@example.test', 'c1.a.b.c', array['https://www.googleapis.com/auth/gmail.send'])$q$,
                       '42501', 'authenticated cannot insert');
  perform tests.throws($q$select * from public.email_sender_credentials_get('gmail')$q$, '42501', 'authenticated cannot call get');
  perform tests.throws($q$select public.email_sender_credentials_put('gmail', 'x@example.test', 'c1.a.b.c',
                          array['https://www.googleapis.com/auth/gmail.send'], null)$q$, '42501', 'authenticated cannot call put');
  perform tests.throws($q$select public.email_sender_credentials_clear('gmail')$q$, '42501', 'authenticated cannot call clear');
  perform tests.as_anon();
  perform tests.throws('select * from public.email_sender_credentials', '42501', 'anon cannot read the table');
  perform tests.throws($q$select * from public.email_sender_credentials_get('gmail')$q$, '42501', 'anon cannot call get');
  perform tests.as_service();
  perform tests.throws('select * from public.email_sender_credentials', '42501', 'even service_role reads only through the functions');
  perform tests.as_owner();
  perform tests.ok((select relrowsecurity from pg_class where oid = 'public.email_sender_credentials'::regclass), 'RLS is enabled');
  perform tests.eq((select count(*)::int from pg_policies where tablename = 'email_sender_credentials'), 0, 'no policies');
end $$;

-- ── 1. service_role stores, reads, replaces and clears one sealed row ─────────
do $$
declare
  v record;
begin
  perform tests.as_service();
  perform public.email_sender_credentials_put('gmail', 'Owner@Example.test', 'c1.aXY.dGFn.Y3Q',
                                              array['https://www.googleapis.com/auth/gmail.send'], tests.id('own'));
  select * into v from public.email_sender_credentials_get('gmail');
  perform tests.eq(v.sender_email, 'owner@example.test', 'the sender address is stored lower-case');
  perform tests.eq(v.sealed_refresh_token, 'c1.aXY.dGFn.Y3Q', 'the envelope round-trips');

  perform public.email_sender_credentials_put('gmail', 'owner@example.test', 'c1.bmV3.dGFn.Y3Q',
                                              array['https://www.googleapis.com/auth/gmail.send'], tests.id('own'));
  perform tests.eq((select count(*)::int from public.email_sender_credentials_get('gmail')), 1, 'a reconnect replaces the row');
  perform tests.eq((select g.sealed_refresh_token from public.email_sender_credentials_get('gmail') g), 'c1.bmV3.dGFn.Y3Q',
                   'the newest envelope wins');

  -- constraints: only sealed envelopes, only gmail.send, only provider gmail, a real address
  perform tests.throws($q$select public.email_sender_credentials_put('gmail', 'owner@example.test', '1//plain-refresh-token-not-sealed',
                          array['https://www.googleapis.com/auth/gmail.send'], null)$q$, '23514', 'a plaintext token is refused');
  perform tests.throws($q$select public.email_sender_credentials_put('gmail', 'owner@example.test', 'c1.a.b.c',
                          array['https://mail.google.com/'], null)$q$, '23514', 'a broader scope is refused');
  perform tests.throws($q$select public.email_sender_credentials_put('gmail', 'owner@example.test', 'c1.a.b.c',
                          array['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'], null)$q$,
                       '23514', 'an extra scope is refused');
  perform tests.throws($q$select public.email_sender_credentials_put('resend', 'owner@example.test', 'c1.a.b.c',
                          array['https://www.googleapis.com/auth/gmail.send'], null)$q$, '23514', 'only the gmail provider');
  perform tests.throws($q$select public.email_sender_credentials_put('gmail', 'not an address', 'c1.a.b.c',
                          array['https://www.googleapis.com/auth/gmail.send'], null)$q$, '23514', 'the sender must be an address');

  perform public.email_sender_credentials_clear('gmail');
  perform tests.eq((select count(*)::int from public.email_sender_credentials_get('gmail')), 0, 'clear removes the row');
  perform tests.as_owner();
end $$;
