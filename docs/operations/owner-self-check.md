# Owner self-check (`/test`)

A server-rendered page that checks the live deployment end to end before a demo. Only the owner can see it.

## Access

- Set `BATON_OWNER_EMAILS` in Vercel (Production), e.g. `BATON_OWNER_EMAILS=owner@example.com`. Comma-separated,
  trimmed, case-insensitive. The account's email must be **confirmed**. Unset or empty: the page is a 404 for everyone.
- Signed out: `proxy.ts` redirects to `/login?next=/test`, like every protected route.
- Signed in but not on the list: `proxy.ts` answers **404** (the app's not-found page). The page itself checks the
  verified session (`getVerifiedActor`, Auth server) and the list again and calls `notFound()`; so does the Server Action.
- `robots: noindex, nofollow`; there is no sitemap. No nav link points to it.

## What it shows (one row each: OK / WARN / FAIL)

| Section | Checks |
|---|---|
| Config | AI configuration (mode, provider id and name), extract/verify model ids, governance profile; `BATON_SITE_URL` vs the host this request came to; identity pepper (verified against the canary) and map key (+ versions); `CRON_SECRET`, `CONNECTOR_STATE_SECRET`, `CONNECTOR_SECRET_KEY`, `CONNECTOR_SYNC_SECRET` present and at least 32 chars, and sync ≠ cron; `BATON_ALLOW_FAKE_AI`, `BATON_ALLOW_EVAL_PROVIDER`, `BATON_DEV_WORKER` (FAIL if set in production); Supabase service key present |
| Database | head/count on handovers, sources, processing_runs, processing_jobs, pipeline_worker_slots, handover_people, connector_installations, connector_capture_windows, invitation_deliveries, profiles; queued/running jobs, active runs, failed jobs in the last 24h. Latest migration version is not shown (no read API) |
| Auth and storage | Auth admin `listUsers` (page size 1, total users); bucket `source-uploads` exists and is private |
| Processing worker | `pipeline_work_due()`; last succeeded run time and provider; Vercel cron (none: no `vercel.json`). On Hobby, processing completes while the processing page is open |
| Connectors | telegram, discord, slack, github configured (names of missing variables only); Telegram `getWebhookInfo`: webhook host, whether it equals the site host, pending count, last error (URLs and secrets stripped) |
| Pages | Server-side GET of `/`, `/login`, `/demo`, `/demo/workspace` on `BATON_SITE_URL` (never the request host), status and ms, redirects not followed |
| Omega usage | When `AI_PROVIDER=omega`: `GET <OMEGA_API_BASE_URL>/v1/usage`, showing remaining, used and percent only |
| Build info | Short commit SHA, Vercel env and region, NODE_ENV, server time |

Every check runs in parallel with a 5 s timeout and catches its own errors (FAIL with a fixed message or an error
code, never an error text or URL). Before rendering, every row passes a redaction step that replaces any secret env
value (names matching KEY / SECRET / TOKEN / PEPPER / PASSWORD / PRIVATE / CREDENTIAL). Tests:
`npm run test:selftest`.

## Live AI check (opt-in, paid)

The "Run live AI check" button calls a Server Action (owner-gated) that sends ONE fixed synthetic claim and quote
through `getAiProvider` → `verifySupport`. It shows provider, requested vs reported model, verdict and latency.
Cooldown: 60 s (module variable plus an httpOnly cookie scoped to `/test`). No real data is ever sent.

Code: `app/(workspace)/test/page.tsx`, `lib/selftest/*`, `components/selftest/*`.
