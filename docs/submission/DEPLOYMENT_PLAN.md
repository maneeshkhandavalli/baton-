# Judge-facing deployment plan (PROPOSAL — nothing deployed, nothing hosted changed)

Goal: one public HTTPS link where judges can (a) open the landing page and the no-account demo, and (b) create an
account and run a real handover end to end. Every step marked **[approval]** needs the owner's explicit go-ahead.

## 1. What the build needs at runtime

| Concern | Requirement (from the code) |
|---|---|
| Hosting | Next.js 16 App Router (Cache Components). Vercel is the native target (no `vercel.json` needed). Node 24 default runtime. |
| Database/Auth/Storage | A Supabase project with **all 54 migrations** in `supabase/migrations` (through `20261119800200_connectors.sql`). Email + password sign-in works without email delivery; invitations and Gap Interview links are copied by hand when email is not configured. |
| AI | Production refuses the built-in test adapter (it needs `NODE_ENV=development`). A real provider needs `AI_PROVIDER=gemini`, `AI_API_KEY` and **`AI_DATA_GOVERNANCE=gemini-paid-dpa`** (a key from a Google Cloud project with active billing, attested by the operator). Without it processing shows "No AI provider is configured" — honest, but the core flow cannot run. The Gemini free tier is refused by the governance gate and is also limited to ~20 requests/day/model. |
| Background work | `/api/pipeline/drain` (CRON_SECRET bearer — what Vercel Cron sends) and `/api/connectors/sync` (**`CONNECTOR_SYNC_SECRET` only**). Vercel Cron can only send `CRON_SECRET`, so the connector sync must be scheduled elsewhere: an external scheduler (e.g. a GitHub Actions schedule or cron-job.org) sending `Authorization: Bearer <CONNECTOR_SYNC_SECRET>`, or the database scheduler with a `connector_sync` dispatch header. Without a schedule, Discord capture still works via **Bring in new messages**. |
| Site URL | `BATON_SITE_URL=https://<deployment-domain>`; Supabase Auth `site_url` + redirect URLs set to the same origin. |
| Secrets (server-only) | `SUPABASE_SERVICE_ROLE_KEY`, `IDENTITY_PEPPER`/`_VERSION`/`_CANARY`, `IDENTITY_MAP_KEY`/`_VERSION`, `CRON_SECRET`, `CONNECTOR_STATE_SECRET`, `CONNECTOR_SECRET_KEY`(`_VERSION`), `CONNECTOR_SYNC_SECRET`, `AI_API_KEY`, provider secrets. All freshly generated for the deployment; none copied from local files. |

## 2. Options

| Option | Database | Pros | Cons / risk |
|---|---|---|---|
| **A (recommended)**: Vercel + a **new, dedicated** Supabase project for judging | fresh project; `supabase db push` of the 54 migrations to THAT project only **[approval]** | isolated from every existing project (the original and the hosted `baton-dev` `xnwppnzvrpthukxjfojj`); nothing real in it; easy to delete after judging | a second hosted project; free-tier limits (pauses after inactivity); needs Auth URL config |
| B: Vercel + existing hosted `baton-dev` (`xnwppnzvrpthukxjfojj`) | apply the Round 3 Task 05/06 and Round 4 migrations it lacks via the reviewed runner (`supabase/hosted-apply`, new pinned bundle) **[approval]** | reuses an existing project | writes to a shared hosted database; larger rehearsal burden; mixes judge traffic with dev data |
| C (fallback): tunnel the local 3110 preview | local stacks | zero hosted changes; already verified | laptop must stay on and awake; `next dev` performance; tunnel URL changes per session; test AI only |

## 3. Option A steps (each **[approval]**)

1. Create the Supabase project (region near judges); record the project ref; enable email sign-up, disable email
   confirmation (or configure SMTP); set Auth `site_url`/redirects to the Vercel domain.
2. Link the CLI to that ref only and `npx supabase@2.122.1 db push` (54 migrations); verify with read-only queries
   (migration count, RLS enabled on every table, connector functions granted to `service_role` only).
3. Create the Vercel project from `work/r4-integration` (or a release branch); set the env vars of §1 in Vercel
   (Production + Preview), `NODE_ENV` is set by Vercel. Do not set `BATON_ALLOW_FAKE_AI`.
4. Vercel Cron for `/api/pipeline/drain` (e.g. every minute) and an external schedule for `/api/connectors/sync`.
5. Deploy; smoke: `/`, `/demo`, `/login` 200; sign-up; one handover with the sample data processed by the real
   provider; invite + accept in a second browser; Living Handover new version → change review → publish v2.
6. Connectors (optional for judging): register production callback/webhook URLs as a second set (or re-point the dev
   apps after the live local tests); Telegram's single webhook must be re-set to the production URL.
7. After judging: revoke provider apps/tokens, delete the judge Supabase project and Vercel deployment.

## 4. What judges can use without any of this

`/` (landing) and `/demo` (no account, scripted scenario, no AI) work on any deployment, including one with no AI
provider configured. The signed-in flow needs §1 AI + database.

## 5. Decisions needed from the owner

1. Option A, B or C. 2. AI: approve a billed Gemini key with `AI_DATA_GOVERNANCE=gemini-paid-dpa` (or accept that
judges see the "No AI provider" state beyond the demo). 3. Whether connectors are part of the judged deployment or
shown from the local live tests (recording/screenshots).
