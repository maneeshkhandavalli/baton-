# Round 3 Task 06: FROZEN backend/UI contract

Status: **FROZEN by Main** (integration branch `round3/task06-integration`). Source: Worker 01's proposal
(`round3/task06-backend-onboarding` commit `d8d2b3a`, reproduced below unchanged). Any change after this point goes
through Main before implementation; workers must not invent endpoints or payloads outside this document.

## Main's decisions

| # | Decision | Ruling |
|---|---|---|
| D1 | Demo as a per-visitor, database-free sandbox | **Accepted.** No demo row ever reaches the database, auth, email or AI. |
| D1-contract | `token_invalid` carries `details.reason` on the invitation path only | **Accepted.** Gap Interview tokens stay generic. |
| D2 | Refactor `lib/mocks/queries.ts` to take its store as a parameter | **Accepted** (Worker 01). Existing `(preview)` and `/demo` behaviour must not change. |
| D3 | Show a pending-link holder the handover title, inviter display name, role, expiry and a masked address | **Accepted**, pending state only; no other handover content before acceptance. |
| D4 | Worker 01 may edit `proxy.ts` (skip session refresh on `/demo*`) and `docs/round3/release-guard.md` | **Accepted.** |
| D5 | Invitation email via the Resend HTTP API (`fetch`, no new package) | **Accepted**, enabled only when `RESEND_API_KEY` and `BATON_EMAIL_FROM` are set (server-only). Tests use an injected fake transport; no live email is sent in this task. |
| D6 | Keep the creator-only copyable link in every environment | **Accepted** (existing behaviour). |

## Binding amendments

- **A1 Demo action set (bounded).** The engine supports exactly: review a point (approve / reject / edit), answer and
  accept a gap question, decide a change-review item (accept / reject / investigate, per Task 05E semantics),
  publish, and acknowledge as the incoming member, plus `reset` and `jumpToStep`. Every other action returns
  `forbidden` with `details.reason = "demo_read_only"`. A simulated invite returns `delivery = { status: "not_sent",
  reason: "demo" }`.
- **A2 Ownership seam.** Worker 01 owns `lib/demo/engine/**`, `lib/mocks/queries.ts` refactor, `lib/email/**`,
  `lib/actions/**/invitations.ts`, contracts in `lib/contracts/{dto,schemas}.ts` listed in §6.1, migrations
  `20261118700100`–`20261118700300`, `proxy.ts`, and backend tests. Worker 02 owns `/demo`, `/demo/workspace`,
  `/h/[token]` pages and components that render engine state / invitation states. If a component needs a new
  injection point for demo queries/actions, Worker 02 asks Main; Worker 01 does not edit components.
- **A3 Demo UI uses only the published engine API** (§2.5) and the real DTO types; it never imports `lib/mocks/store.ts`.
- **A4 Accept is explicit.** `acceptInvitation` is only ever called from a user submit (never during render or
  prefetch); `getInvitation` never redeems.
- **A5 Unknown reasons** render the generic state for their code (forward compatibility).
- **A6 Delivery copy.** When `delivery.status = "not_sent"`, the UI shows the copyable link and says plainly that no
  email was sent and why (`email_not_configured` → "Email isn't set up on this server; send the link yourself").

---

# Round 3 Task 06: backend and onboarding contract (Worker 01 proposal)

Status: PROPOSAL for Main to review and freeze. Nothing here is implemented yet.
Base: `e64481b` (Task 05E). Branch: `round3/task06-backend-onboarding`.

Decisions Main must make before freeze are marked **[D1]...[D6]** and collected in section 9.

---

## 1. What exists today

### 1.1 Public demo

| Piece | Where | State |
|---|---|---|
| `/demo` page | `app/(marketing)/demo/page.tsx` | Server-rendered, read-only. Reads the CodeCell handover through `createMockQueries(PROFILES.arjun.id)` and `createMockQueries(PROFILES.neha.id)` from `lib/mocks/queries.ts`, and renders `ReviewWorkspace readOnly` and `PublishedHandoverView` in `DemoTabs`. No session, no DB, no actions. |
| Mock store | `lib/mocks/store.ts` | ONE in-memory store on `globalThis` (`__batonMockStore`), shared by every request of the server process; it resets on restart. `lib/mocks/queries.ts` imports `next/server` (`connection`) and the global store. |
| Mock actions | `lib/mocks/actions.ts` (`"use server"`) | Mutate the shared global store. Used only by the dev-only `(preview)` group (`app/(preview)/layout.tsx` calls `notFound()` unless `NODE_ENV === "development"`). |
| Demo scenario | `lib/demo/scenario/{cast,journey,points,sources}.ts` | Pure data: cast, six-step journey (`DEMO_STEPS`), fixed scenario clock, canonical actions, points, sources. The header says "the client-side demo engine (Phase B) builds its store from this". The engine does not exist yet. |
| Sample-data switch | `lib/prototype/flags.ts` | `SAMPLE_DATA_ENABLED` (wizard "Use sample data"). Not related to the demo session. |

Gaps against the criteria: no one-click interactive entry, no per-visitor isolation (the only mutable mock store is process-global and would mix visitors if it were ever used by `/demo`), no reset. The current read-only page is already safe: no DB, no auth, no email, no AI.

### 1.2 Invitations (most of the security model already exists)

| Piece | Where | State |
|---|---|---|
| Table | `supabase/migrations/20261111000100_schema.sql` `public.access_tokens` | `purpose = 'member_invite'`; `token_hash bytea` (SHA-256, `length = 32`, unique); `recipient_email citext`; `grant_role`, `grant_clearance`; `expires_at`; `max_uses = 1` forced by `access_tokens_invite_single_use`; `use_count`, `revoked_at`, `last_used_at`. No client SELECT. |
| Token format | `lib/db/tokens.ts` | 32 random bytes, base64url, 43 chars (`/^[A-Za-z0-9_-]{43}$/`); only SHA-256 reaches the DB (`tokenHashParam`). Raw token returned once, never logged. |
| Create | `invite_member(p_actor_profile_id, p_handover_id, p_email, p_role, p_clearance, p_token_hash, p_expires_at)` in `20261111000600_sources_members_tokens.sql`; `lib/db/mutations.ts inviteMember`; `lib/actions/core/members.ts inviteMember` (`"use server"` wrapper `lib/actions/members.ts`) | Creator only (`BTFB0`), `_require_actor`, handover lock, expiry 1..30 days (default 7, `inviteMemberInput`), refuses existing members (`BTCF0`), review roles forced to `reviewer_only`, audited `member.invited`. Returns `CreatedLink { tokenId, url, expiresAt }`; url built only from `BATON_SITE_URL`. **No email is sent on create.** |
| Peek (pre sign-in) | `peek_member_invite(p_token_hash)`; `lib/db/mutations.ts peekMemberInvite` | Service role only. Returns the recipient address for the magic link; never sent to the browser. Rate limited `invite_magic_link_{client,token}`. |
| Magic link | `lib/supabase/invites.ts sendInviteMagicLink`; `app/(token)/h/[token]/actions.ts requestInviteLink` | `signInWithOtp` to the INVITED address only, redirect from `BATON_SITE_URL`; same answer for valid/invalid/limited tokens. Hidden in the UI unless `NEXT_PUBLIC_BATON_EMAIL_LOGIN=on` (`lib/supabase/login-options.ts`). |
| Redeem | `redeem_member_invite(p_token_hash, p_profile_id)`; `lib/db/mutations.ts redeemMemberInvite`; `lib/supabase/invites.ts acceptInvite`; `app/(token)/h/[token]/actions.ts acceptInvitation` | Atomic: handover lock, `FOR UPDATE` on the token, re-check of revoked/expired/used, email and `email_confirmed_at` read from `auth.users` (H3), case-insensitive match, member insert or re-activation with the granted role and clearance, `use_count + 1`, two audit rows. Client-side pre-check `canRedeemInvitation`. Rate limited `invite_redeem_{client,token}`. Only on explicit form POST (prefetch can never redeem). |
| Listing / revoke | `list_access_tokens` (creator sees invitations + recipient), `revoke_access_token`; `lib/actions/gaps.ts revokeAccessToken` | Exists. |
| Landing page | `app/(token)/h/[token]/page.tsx` | States: signed out (Google, `/login?next=`, optional magic link), `?sent=1`, signed in -> "Accept", `?error=token_invalid|conflict|rate_limited|internal`. No invitation details (title, inviter, role) are shown; it cannot tell expired from used from wrong account. |
| Tests | `supabase/tests/sql/40_lifecycle_review.sql` (H3 cases, single use), `tests/integration/it13-tokens-drain.test.ts` (raw token only in URL, hashing, rate limits first, magic link only to the invited address) | Exist. |

Gaps against the criteria:

1. **Acceptance is atomic but not idempotent.** A second accept by the same, already-joined user returns `token_invalid` (asserted at `40_lifecycle_review.sql:262`). A double-submit or a back-button retry shows "This link isn't valid" to the person who just joined.
2. **No invitation details API.** The UI cannot show what the invitation is for, who sent it, the role, expiry, or why it fails (expired / revoked / used / wrong account / unconfirmed email).
3. **No invitation email.** Delivery relies on the creator copying the link, plus an optional magic link the invitee must request. There is no email transport in the codebase (no Resend/SMTP client; only Supabase Auth's own emails).
4. **No re-send.** The raw token is not stored (correctly), so "resend" must issue a new token.
5. No per-creator limit on invitations (relevant once Baton sends email: an email-sending endpoint is an abuse vector).

### 1.3 Sign-up, sign-in, email verification

| Piece | Where | State |
|---|---|---|
| Google OAuth (primary) | `lib/supabase/oauth.ts`, `oauth-core.ts`, `components/auth/google-sign-in-button` | Exists; email confirmed by Google. |
| Email + password | `lib/supabase/password-auth.ts` (`passwordSignIn`, `passwordSignUp`, `requestPasswordSetup`, `setOwnPassword`); `app/(auth)/login/actions.ts` | Exists. Sign-up never reveals whether the address exists; `emailRedirectTo` from `BATON_SITE_URL` with a sanitised `next`. When confirmation is required the user gets "check your email". |
| Magic link | `app/(auth)/login/actions.ts sendMagicLink` | Exists, hidden behind `EMAIL_LOGIN_ENABLED`. |
| Callback | `app/auth/callback/route.ts` | PKCE and OTP (`signup`, `magiclink`, `invite`, `recovery`, ...), `no-referrer`. |
| Profiles | trigger `_handle_new_auth_user` on `auth.users` (`20261111000400_lifecycle.sql`) | A profile row is created for every auth user. |
| Actor | `lib/db/actor.ts getVerifiedActor` (`auth.getUser()`), `_require_actor` in SQL | Exists; `emailConfirmed` from `email_confirmed_at`. |
| Local stack | `supabase/config.toml` | `[auth.email] enable_signup = true`; `enable_confirmations` not set, so it is **false locally** (password sign-up is confirmed immediately). The local stack runs without mailpit/inbucket, so magic links, confirmation and reset emails cannot be delivered locally. |

Gaps: nothing in code enforces that the hosted project requires email confirmation; the invite flow's correctness (H3) depends on it for password accounts.

### 1.4 Rate limits

`public.rate_limit_counters` + `consume_rate_limit(p_scope, p_subject)` (`20261111000550_rate_limits.sql`): fixed scopes in a CHECK constraint and a VALUES list (`gap_interview_*`, `invite_magic_link_*`, `invite_redeem_*`); subjects are SHA-256 hex (client IP hashed, token by its stored hash). `lib/db/rate-limit.ts consumeRateLimits` commits each hit in its own call before the protected operation.

---

## 2. Demo

### 2.1 Recommendation: an isolated, per-visitor, database-free demo sandbox **[D1]**

Each visitor gets their own demo workspace whose entire state lives in their own browser tab, built deterministically from `lib/demo/scenario`. The server holds no demo state, the demo touches no database, no Supabase Auth, no service-role key, no email transport and no AI provider.

Why not a database-backed demo (a seeded handover per visitor, e.g. with Supabase anonymous sign-in)?

- It would put demo users in the production `auth.users` and demo handovers in the real `handovers` table: one RLS or query mistake mixes them with real workspaces, the exact failure the criteria forbid.
- Every click on "Enter demo" would be an unauthenticated DB write: a cheap denial-of-service and storage-growth vector needing its own rate limits, quotas and a cleanup cron.
- The real pipeline would make live AI calls in production; the demo would need a parallel "fake pipeline" path inside production code.
- Reset and expiry need a scheduled job and idempotent teardown across many tables, plus the account-purge path.

Why not a shared read-only demo (today's page)? It is safe but not interactive: a judge cannot review, publish or acknowledge. It stays as the no-JavaScript / first-paint fallback (2.4).

Why not the existing mock actions? `lib/mocks/store.ts` is one store per server process: two visitors would see each other's changes, and on serverless the state would be lost between instances.

### 2.2 Demo entry (one click)

- `/demo` stays the public landing (UI-owned). Its primary button "Enter the demo" is a plain link to the demo workspace route (proposed `routes.demo.workspace = "/demo/workspace"`, optional `?step=<DemoStepId>`). No server function, no cookie, no sign-in, no form.
- `/demo/**` is public in `proxy.ts` (it already is: not in `PROTECTED_PREFIXES`). Proposal (backend-owned, small): skip `updateSession` for `/demo` paths so demo requests never touch the Auth server or session cookies. A signed-in user who opens `/demo` sees only the demo; demo pages must never call `getSessionUser`/`getVerifiedActor`.
- `routes.ts` gains `demo: { home: "/demo", workspace: (step?) => ... }` (backend adds the helper; `routes.demo` today is a string, so this is a small compatible change: keep `routes.demo` and add `routes.demoWorkspace(step?)`).

### 2.3 Demo session behaviour

New pure module `lib/demo/engine/` (backend-owned). No React, no I/O, no `server-only`, no `fetch`. Runs in the browser (and in server components for the first paint).

- `startDemoSession({ step })` creates `{ id, version, startedAt, step, log: [] }`. `id` is random (`crypto.randomUUID()`), used only as a React key / storage key, never sent anywhere.
- State = `replay(seed(scenario), canonicalActionsUpTo(step), session.log)`. Deterministic: same session -> same state. Timestamps come from `DEMO_STEP_CLOCK`, never the visitor's clock.
- Visitor actions go through `applyDemoAction(session, action)`: validated with the SAME Zod schemas as the real actions (`lib/contracts/schemas.ts`), with the same permission/lifecycle rules as the mock layer, returning the real `Result<T>` shapes. Actions outside the demo's whitelist (uploads, account deletion, real invitations, anything that would send or call out) return `forbidden` with `details.reason = "demo_read_only"`.
- "Invite someone" in the demo is simulated: it returns a `CreatedInvitation`-shaped value with `url` = a fake in-demo path (`/demo/workspace?step=receive`) and `delivery = { status: "not_sent", reason: "demo" }`. No email, no token, no network.
- Persistence is the UI's per-viewer convenience: the UI stores `serializeDemoSession(session)` in `sessionStorage` (key `baton.demo.v1`, wrapped in try/catch). `parseDemoSession(raw)` validates it and returns `null` for anything malformed, from another engine version, or older than 24 hours; the UI then starts a fresh session. Nothing is shared between tabs, browsers or visitors.

### 2.4 Demo reset, expiry and cleanup

- `resetDemoSession(session)` -> fresh state at the session's current step (same id, empty log). `jumpToStep(session, step)` -> canonical state for that step. Both are pure and idempotent: calling them twice gives the same result.
- Expiry: the session dies with the tab (`sessionStorage`); stored sessions older than 24 h or from another `DEMO_ENGINE_VERSION` are discarded on read. Bumping the version invalidates every stored demo.
- Cleanup: none needed on the server. There is nothing to purge, so there is no cron, no orphan risk and no idempotency problem across instances.
- First paint / no JavaScript: `demoSnapshot(step)` returns the canonical state for a step, so a server component can render it read-only. Today's `/demo` behaviour remains as that fallback.

### 2.5 Demo API (TypeScript)

```ts
// lib/demo/engine/index.ts  (pure; importable from client and server components)
export const DEMO_ENGINE_VERSION = 1;
export const DEMO_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface DemoSession {
  id: string;
  version: typeof DEMO_ENGINE_VERSION;
  startedAt: string;            // real ISO time, used only for expiry
  step: DemoStepId;             // from lib/demo/scenario
  log: DemoAction[];            // visitor actions since the step's canonical state
}

export type DemoAction =
  | { type: "reviewPoint"; input: ReviewPointInput }        // canonical schemas, ids from the demo store
  | { type: "editPoint"; input: EditPointInput }
  | { type: "resolveConflict"; input: ResolveConflictInput }
  | { type: "answerGapQuestion"; input: AnswerGapInput }
  | { type: "publish"; input: PublishHandoverInput }
  | { type: "acknowledge"; input: AcknowledgePublicationInput }
  | { type: "inviteMember"; input: InviteMemberInput };   // simulated; never sends
// The exact action list follows the review inputs the UI uses; Main/UI confirm at freeze.

export type DemoViewer = "priya" | "neha" | "kabir";        // DemoPersonKey subset

export function startDemoSession(opts?: { step?: DemoStepId }): DemoSession;
export function resetDemoSession(session: DemoSession): DemoSession;
export function jumpToStep(session: DemoSession, step: DemoStepId): DemoSession;
export function applyDemoAction(session: DemoSession, action: DemoAction): { session: DemoSession; result: Result<unknown> };
export function demoQueries(session: DemoSession, viewer: DemoViewer): DemoQueries; // subset of BatonQueries, same DTOs
export function demoSnapshot(step: DemoStepId, viewer: DemoViewer): DemoQueries;    // server-renderable, canonical
export function serializeDemoSession(session: DemoSession): string;
export function parseDemoSession(raw: unknown, now?: number): DemoSession | null;

export type DemoQueries = Pick<BatonQueries,
  | "listMyHandovers" | "getHandover" | "listMembers" | "listSources" | "listPoints" | "getPoint"
  | "getSourceMessageContext" | "listGapQuestions" | "getReadiness" | "getPublishedHandover"
  | "getProcessingStatus" | "getExtractionReport">;
```

Implementation note: `lib/mocks/queries.ts` cannot run in the browser (it imports `next/server` and the global store). I propose a refactor that extracts its pure query logic into a store-parameterised function (`createStoreQueries(store, viewerId)`) which both `lib/mocks/queries.ts` (with `getStore()`) and the engine (with a per-session store) call. This touches `lib/mocks/**` **[D2: confirm backend may refactor lib/mocks, or the UI worker owns it]**.

### 2.6 Demo safety guarantees (enforced by tests)

- Boundary test `lib/demo/__tests__/engine-boundaries.test.ts`: no file under `lib/demo/**` imports `lib/supabase`, `lib/db`, `lib/actions`, `lib/ai`, `lib/pipeline`, `lib/mocks/store`, `lib/mocks/actions`, `server-only`, `next/headers`, or contains `fetch(`, `XMLHttpRequest`, `process.env`. No file under `app/**/demo/**` imports `lib/actions`, `lib/supabase` or `lib/db` (read-only scan of UI files; the test does not modify them).
- So the demo has no service-role credential, cannot send an email, cannot call an AI provider and cannot read or write a real workspace.

---

## 3. Invitations

### 3.1 Token, storage, expiry, single use (unchanged, confirmed)

- Raw token: 32 bytes from `crypto.getRandomValues`, base64url, 43 chars. Only in the invite URL returned once to the creator and in the invitation email body. Never logged, never stored.
- At rest: `SHA-256(raw)` in `access_tokens.token_hash` (unique). 256 bits of entropy make an unsalted hash sufficient (no offline guessing is possible).
- Expiry: 1..30 days, default 7 (`inviteMemberInput.expiresInDays`); enforced in SQL.
- Single use: `max_uses = 1` CHECK; `use_count` incremented in the redeeming transaction.
- Email matching: the address is fixed at creation (`lower(btrim(email))`, citext); redemption compares it to `auth.users.email` of the verified session user and requires `email_confirmed_at`. The visitor never types or sees the full address.
- Access scope: membership row for exactly `token.handover_id` with exactly `grant_role` and the computed clearance (review roles always `reviewer_only`). Nothing else is granted; reads then go through membership RLS.

### 3.2 Changes

1. **Idempotent acceptance.** `redeem_member_invite` (replaced in a new migration) adds a replay branch: if the token hash exists, is used, and a non-removed `handover_members` row has `invitation_token_id = token.id` and `profile_id = p_profile_id`, return the same JSON plus `"replayed": true` without writing or auditing. Any other user still gets `BTTI0`. The H3 checks run before the replay branch, so a replay still requires the same confirmed address. `40_lifecycle_review.sql:262` changes from "throws BTTI0" to "returns replayed"; a new assertion keeps "another user cannot redeem a used invite".
2. **Invitation details** `get_member_invite_details(p_token_hash bytea, p_viewer_profile_id uuid)` (service role only). Looks the hash up WITHOUT the usability filter so it can classify. Returns:
   - unknown hash -> raises `BTTI0` (reason computed in TS as `unknown`);
   - otherwise jsonb `{ state, handover_title, inviter_name, role, expires_at, recipient_email_masked, viewer }` where `state` is `pending | expired | revoked | used | unavailable` (handover deleted) and, when `p_viewer_profile_id` is given, `viewer = { email_matches, email_confirmed, already_member, accepted_this }` (computed from `auth.users` and `handover_members` in SQL; the viewer id comes from `getVerifiedActor()`).
   - For states other than `pending`, title/inviter/role are NOT returned (only `state`), except `used` + `accepted_this` (the viewer is the member).
   - Masking in SQL: first character of the local part + `***` + `@` + full domain (`n***@example.com`). **[D3]**
3. **Invitation email** on create (and on reissue). See section 5.
4. **Reissue** `reissue_member_invite(p_actor_profile_id, p_token_id, p_token_hash, p_expires_at)` returns the new token id: creator only, in one transaction revokes the old invitation (if still active or expired) and inserts a new one with the same handover, address, role and clearance. Audited `member.invite_reissued`. A used invitation cannot be reissued (`BTIT0`).
5. **Delivery record** `public.invitation_deliveries` (service role only, no client policy) and `record_invitation_delivery(p_actor_profile_id, p_token_id, p_status, p_provider_ref)`; `list_access_tokens` gains `delivery_status` (`sent | not_sent | failed | null`) for invitations only (key added, nothing removed).
6. **Rate limits** (new scopes): `invite_view_client` 60/10 min, `invite_view_token` 120/h, `invite_send_actor` 20/h, `invite_send_recipient` 5/h (recipient subject = SHA-256 of `baton-rate-limit:recipient:<lower email>`). Create/reissue consume the send scopes BEFORE the token is created; when exceeded the action fails `rate_limited` and creates nothing.

### 3.3 Sign-up and email-verification requirements

- Acceptance always requires a verified session user (`auth.getUser()`) whose `email_confirmed_at` is set and whose email equals the invited address (SQL, H3). No change.
- Supported ways for an invitee to get such a session: Google (confirmed by Google); email + password via `/login?next=/h/<token>` (sign-up requires email confirmation on the hosted project; the confirmation link returns to the invitation through `/auth/callback`); magic link to the invited address (`sendInviteMagicLink`, only when `EMAIL_LOGIN_ENABLED`).
- No invitation-specific password sign-up that takes the address from the token: that would let anyone holding a forwarded link pre-create the invitee's password account. The visitor types their own address on `/login`; the H3 match decides.
- Release guard (docs + check): the hosted Supabase project must have "Confirm email" enabled and custom SMTP configured. Add this to `docs/round3/release-guard.md`. **[D4: may I edit release-guard.md?]**
- Local stack: confirmations are off, so a password sign-up with the invited address is confirmed immediately and can accept without any email. This is dev-only behaviour of the local config, not of the code.

---

## 4. Error codes and UI states

All server functions return `Result<T>`. Codes are existing `ErrorCode`s; reasons are new `details.reason` tokens.
The UI must treat an unknown reason as the generic state for that code.

**[D1-contract]** §3.2 says `token_invalid` never says which check failed. I propose an amendment for the invitation path only: the reason is given to the holder of a well-formed token, because the token is a 256-bit bearer secret (knowing that a link expired or was used tells an attacker nothing, since they cannot guess a link). Gap Interview links stay generic. If Main rejects this, every `token_invalid` reason below collapses to `invalid` and the UI shows one state.

### 4.1 `getInvitation(token)`

| Outcome | UI state (UI worker renders) |
|---|---|
| `ok`, `data.state = "pending"`, `viewer = null` | **sign_in_required**: show title, inviter, role, expiry, masked address; offer Google, "Sign in or create an account with email" (`/login?next=`), and magic link only if `EMAIL_LOGIN_ENABLED`. |
| `ok`, `pending`, `viewer.emailMatches && viewer.emailConfirmed && !viewer.alreadyMember` | **ready_to_accept**: one "Accept invitation" button (form POST to `acceptInvitation`). |
| `ok`, `pending`, `viewer.emailMatches = false` | **wrong_account**: "This invitation is for n***@example.com. You're signed in with another address." Sign out (POST `routes.signOut`) and sign in again. |
| `ok`, `pending`, `viewer.emailMatches && !viewer.emailConfirmed` | **email_unconfirmed**: "Confirm your email address first", link to resend via `/login`. |
| `ok`, `pending`, `viewer.alreadyMember` | **already_member**: link to `data.memberHref`. |
| `ok`, `data.state = "accepted"` (viewer redeemed this token) | **already_accepted**: link to `data.memberHref`. |
| `token_invalid` / `reason: "invalid"` (malformed or unknown) | **invalid_link** |
| `token_invalid` / `reason: "expired"` | **expired**: "Ask the person who invited you for a new link." (no title or inviter shown) |
| `token_invalid` / `reason: "revoked"` | **revoked** |
| `token_invalid` / `reason: "used"` | **used**: already accepted by someone; if this was you, sign in with that account. |
| `token_invalid` / `reason: "unavailable"` | **unavailable**: the handover no longer exists. |
| `rate_limited` (retryable) | **too_many_attempts** |
| `internal` | **error**, retry |

### 4.2 `acceptInvitation(token)`

| Outcome | UI |
|---|---|
| `ok` `{ handoverId, role, redirectTo, replayed }` | Navigate to `redirectTo` (published view for lead/incoming, review for outgoing/reviewer, as today). `replayed` needs no special UI. |
| `unauthenticated` | sign_in_required |
| `token_invalid` + `reason` in `invalid | expired | revoked | used | unavailable` | same states as 4.1 |
| `token_invalid` + `reason: "email_mismatch"` | wrong_account |
| `token_invalid` + `reason: "email_unconfirmed"` | email_unconfirmed |
| `conflict` + `reason: "already_member"` (+ `details.handoverId`) | already_member |
| `rate_limited` | too_many_attempts |
| `internal` | error |

### 4.3 `inviteMember` / `reissueInvitation` / `revokeAccessToken`

| Outcome | UI |
|---|---|
| `ok` `CreatedInvitation` with `delivery.status = "sent"` | "Invitation emailed to <address>." Copy-link button also available. |
| `ok`, `delivery = { status: "not_sent", reason: "email_not_configured" }` | "Email isn't set up here. Copy the link and send it yourself." Copy-link is primary. |
| `ok`, `delivery = { status: "not_sent", reason: "provider_failed" }` | "We couldn't email the invitation. Copy the link and send it yourself, or try Resend later." |
| `validation_failed` + `fieldErrors.{email,role,clearance,expiresInDays}` | inline field errors |
| `unauthenticated` | sign in |
| `forbidden` | "Only the creator can invite members." |
| `not_found` | handover/invitation gone |
| `conflict` + `reason: "already_member"` | "This person is already a member." |
| `invalid_transition` + `reason: "invite_used"` (reissue only) | "This invitation was already accepted." |
| `rate_limited` + `reason: "invite_send"` | "You've sent a lot of invitations. Try again in an hour." |
| `internal` | retry |

---

## 5. Email delivery, and behaviour when email is unavailable

- New server-only module `lib/email/` with an `EmailTransport` interface `send({ to, subject, text, html }): Promise<{ ok: true; ref: string } | { ok: false; kind: "failed" | "rate_limited" }>`, injected through `ActionDeps.email` so tests use a fake.
- Production transport: Resend HTTP API via `fetch` (no new npm dependency; `npm install` is not allowed here anyway). Configured only when `RESEND_API_KEY` and `BATON_EMAIL_FROM` are set (server-only env, never `NEXT_PUBLIC_`). **[D5: Resend HTTP API vs. relying only on Supabase Auth emails]**
- No transport configured (local stack, previews without keys): nothing is sent; `inviteMember` succeeds with `delivery = { status: "not_sent", reason: "email_not_configured" }`; the creator copies the link from the response, as today.
- The copy link is the creator's existing product feature (authenticated, creator-only, shown once) and stays available in every environment. **[D6]** The brief says "dev-only copyable link; never in production": if Main wants the URL hidden in production when the email was sent, the response can omit `url` when `delivery.status = "sent"` and `NODE_ENV === "production"`. I recommend keeping it (email may land in spam; the creator can always resend through chat), but this is a product decision.
- There is no dev outbox that logs the email: the email body contains the raw token and tokens are never logged. Locally, the copy link is the outbox.
- Email content: plain text + minimal HTML, all user-controlled values (handover title, inviter display name) escaped; no tracking pixels; link = `BATON_SITE_URL + /h/<token>`; subject "<Inviter> invited you to a Baton handover".
- Failure logging: provider status code and the token id only, never the address, token or URL.
- Supabase Auth emails (magic link, sign-up confirmation, reset) are separate: they use the hosted project's SMTP (Resend SMTP per REMAINING_WORK P1-5). Locally they cannot be delivered (no mailpit); the existing code already answers with its generic error or "check your email".
- Demo: never reaches `lib/email` (boundary test, section 2.6).

---

## 6. Server functions and routes

### 6.1 New contracts (`lib/contracts/dto.ts`, `lib/contracts/schemas.ts`)

```ts
export type InvitationDelivery =
  | { status: "sent" }
  | { status: "not_sent"; reason: "email_not_configured" | "provider_failed" | "demo" };

export interface CreatedInvitation extends CreatedLink {   // CreatedLink = { tokenId, url, expiresAt }
  delivery: InvitationDelivery;
}

export interface InvitationViewer {
  emailMatches: boolean;
  emailConfirmed: boolean;
  alreadyMember: boolean;
}

export type InvitationDetails =
  | {
      state: "pending";
      handoverTitle: string;
      inviterName: string;
      role: MemberRole;
      expiresAt: string;
      recipientEmailMasked: string;
      viewer: InvitationViewer | null;          // null = signed out
    }
  | { state: "accepted"; handoverId: string; memberHref: string };   // the viewer already accepted it

export interface AcceptedInvitation {
  handoverId: string;
  role: MemberRole;
  redirectTo: string;
  replayed: boolean;
}

export type InvitationFailureReason =
  | "invalid" | "expired" | "revoked" | "used" | "unavailable" | "email_mismatch" | "email_unconfirmed";

// schemas
export const invitationTokenInput = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const reissueInvitationInput = z.object({ tokenId: uuidSchema, expiresInDays: z.number().int().min(1).max(30).default(7) });
```

`AccessTokenSummary` gains `deliveryStatus: "sent" | "not_sent" | "failed" | null` (invitations only).

### 6.2 Server Functions (`lib/actions/invitations.ts`, `"use server"`; logic in `lib/actions/core/invitations.ts`)

```ts
export async function getInvitation(input: { token: string }): Promise<Result<InvitationDetails>>;
export async function acceptInvitation(input: { token: string }): Promise<Result<AcceptedInvitation>>;
export async function reissueInvitation(input: { tokenId: string; expiresInDays?: number }): Promise<Result<CreatedInvitation>>;
export async function requestInvitationSignInLink(input: { token: string }): Promise<Result<{ sent: true }>>; // wraps sendInviteMagicLink; always { sent: true }
```

Changed (compatible):

```ts
// lib/actions/members.ts
export async function inviteMember(input: InviteMemberInput): Promise<Result<CreatedInvitation>>; // was Result<CreatedLink>; adds `delivery`
// lib/actions/gaps.ts revokeAccessToken: unchanged
```

- `getInvitation` works signed out; when a session exists it passes `getVerifiedActor().profileId` as the viewer. It is called from the `/h/[token]` server component during render: it is read-only and never redeems, so prefetch is harmless.
- `acceptInvitation` must be called only from an explicit form submit / button (never during render). It is a Server Function returning `Result`; the UI decides navigation (`redirectTo`). The existing `app/(token)/h/[token]/actions.ts` (UI-owned) can switch to these or keep calling `lib/supabase/invites.ts`, which I will update to return the same reasons.
- `lib/supabase/invites.ts acceptInvite` keeps its signature but its failure gains `reason?: InvitationFailureReason`.

### 6.3 Routes

No new route handlers. Pages (UI worker): `/h/[token]` (existing, reworked with the states above), `/demo` (existing), `/demo/workspace` (new, client demo). `lib/routes.ts`: add `demoWorkspace(step?)`.

---

## 7. Migrations (additive; new files only)

| File | Contents |
|---|---|
| `20261118700100_invitation_details.sql` | `get_member_invite_details(bytea, uuid)`; `create or replace` of `redeem_member_invite` with the replay branch (same signature); service_role-only grants (`revoke all ... from public, anon, authenticated`). |
| `20261118700200_invitation_delivery.sql` | `invitation_deliveries` table (RLS on, no policies); `record_invitation_delivery(...)`; `reissue_member_invite(...)`; `create or replace list_access_tokens` adding `delivery_status`; grants. |
| `20261118700300_invitation_rate_limits.sql` | Drop/re-add the `rate_limit_counters.scope` CHECK with the four new scopes; `create or replace consume_rate_limit` with the extended VALUES list (existing limits unchanged). |

All functions: `security definer`, `set search_path = ''`, `_require_actor(p_actor_profile_id)` for actor functions, fixed exception messages with Baton SQLSTATEs, `_audit` for writes, handover lock before token lock (same order as `redeem_member_invite`, so no new deadlock order). `docs/round3/migrations.md` gets the three entries.

---

## 8. Test plan

SQL (`bash supabase/tests/run.sh 99_invitations`, container `BATON_PG_CONTAINER=baton-pg-w01`), new file `supabase/tests/sql/99_invitations_r3t06.sql`:
- details: each state (pending / expired / revoked / used / unavailable / unknown -> BTTI0); non-pending returns no title/role/inviter; viewer flags (match, case-insensitive match, mismatch, unconfirmed, already member, accepted_this); masking.
- replay: same user second redeem returns `replayed = true`, no extra audit, `use_count` stays 1; other confirmed user -> BTTI0; removed member replay -> BTTI0; unconfirmed same address -> BTTI0.
- scope: accepted invite on H1 grants nothing on H2; role and clearance exactly as granted; review roles `reviewer_only`.
- reissue: creator only (non-creator member BTNF0/BTFB0 as today's pattern), old revoked + new active in one transaction, used -> BTIT0, audit row.
- delivery record: creator only; `list_access_tokens` shows `delivery_status` to the creator only.
- rate limits: new scopes accepted, unknown scope still BTVF0.
- privileges: `anon` and `authenticated` cannot execute any new function.
- update `40_lifecycle_review.sql:262` for the replay behaviour.

Tier E (`BATON_IT_PG=1 BATON_IT_CONTAINER=baton-it-w01-inv`, `--test-concurrency=1`): `tests/integration/db/sql/it23_invitations.sql` (two concurrent redeems of one token: exactly one membership, the other session gets replay or BTTI0; privileges matrix).

Node integration (`tests/integration/r3-invitations.test.ts`, real actions with the existing `actionWorld` harness):
- `inviteMember` with fake transport: sent / not configured / provider failure; send rate limit consumed before the token exists (no orphan token on limit); email body escapes title and inviter; raw token only in URL and email body, never in logs (`captureConsole`); transport never called when site URL is invalid.
- `getInvitation` / `acceptInvitation`: every row of the tables in 4.1 and 4.2; rate limits consumed before DB; malformed token makes no DB call; accept never runs on GET/render.
- Production guard: no transport without `RESEND_API_KEY`/`BATON_EMAIL_FROM`; env values never in client bundles (no `NEXT_PUBLIC_`).

Demo (`npm run test:ui` picks up `lib/demo/__tests__`): engine determinism, two sessions never share state, reset/jump idempotent, expiry and version rejection in `parseDemoSession`, forbidden actions return `demo_read_only`, simulated invite never has a real token shape, boundary test from 2.6.

Regression: `npm run typecheck`, `lint`, `test:contracts`, `test:db`, `test:actions`, `test:ui`, `test:integration`, `it13`.

---

## 9. Decisions for Main and risks

| # | Decision | Recommendation |
|---|---|---|
| D1 | Demo: per-visitor DB-free client sandbox vs. DB-backed demo workspaces | DB-free sandbox (2.1). |
| D1-contract | Give `token_invalid` reasons on the invitation path (amend §3.2) | Yes, invitation path only. |
| D2 | Backend refactors `lib/mocks/queries.ts` into a store-parameterised core | Yes (no behaviour change for `(preview)`). |
| D3 | Show masked recipient address, handover title and inviter name to a holder of a pending invitation link | Yes (the email shows them anyway). |
| D4 | Backend may edit `docs/round3/release-guard.md` and `proxy.ts` (skip session refresh on `/demo`) | Yes. |
| D5 | Invitation email via Resend HTTP API (`RESEND_API_KEY`, `BATON_EMAIL_FROM`) | Yes; otherwise invitations stay copy-link only. |
| D6 | Keep returning the copy link in production when the email was sent | Keep. |

Risks:
- Changing `redeem_member_invite` alters an asserted behaviour (single use now replays for the same user). Mitigated by the H3 checks staying first and by the new "other user" assertion.
- Contract amendment on `token_invalid` reasons (D1-contract) is a deliberate relaxation of §3.2.
- Sending email makes Baton an email relay; the per-actor and per-recipient limits bound it, and recipients are only addresses a signed-in creator types.
- Hosted Supabase must require email confirmation; if it does not, password accounts with an unverified address would still be blocked by `email_confirmed_at` only if Supabase leaves it null. Release guard check.
- Client demo ships the fictional scenario in the JS bundle (size, not secrecy).
- Pre-account takeover through generic password sign-up is a Supabase-level concern; the invitation flow does not add a new path.
- Local stack cannot deliver auth emails; local acceptance testing uses password sign-up (auto-confirmed locally) or the copy link.
- Mainline merge: the new migrations must sort after any other Task 06 worker's migrations; Main assigns the final timestamps if two workers collide.

## 10. Phase B rules (acknowledged)

Migrations tested only in throwaway Docker Postgres (`BATON_PG_CONTAINER=baton-pg-w01`, `BATON_IT_CONTAINER=baton-it-w01-*`, `--test-concurrency=1`), one container at a time, removed afterwards. Never apply to `supabase_db_baton-dev`, never stop or reset `supabase_*` containers. No dev server. No `npm install`. Local commits on `round3/task06-backend-onboarding` only; no push, no master. No UI component or page-layout edits without asking Main.
