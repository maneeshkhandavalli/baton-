# Baton — hackathon submission (DRAFT)

> Draft. Items marked **[to confirm]** are filled in only after they are verified live. Do not submit claims that the
> status checklist (`docs/round4/STATUS.md`) does not back.

**Project link:** [to confirm — hosting option and AI provider pending; see `DEPLOYMENT_PLAN.md`] · **Code:** https://github.com/maneeshkhandavalli/baton- (branch
`work/r4-integration`) · **Demo without an account:** `<link>/demo`

## One line

Baton turns a team's chats and documents into a handover for the next person, where every decision, owner, task and
risk links back to the message it came from.

## The problem

Student clubs, project teams and volunteer groups rotate people every term. What the next person needs (who decided
what, what is owed, what is risky) is buried in months of group chat. Handover documents are written from memory, go
stale the week after, and can't be checked.

## What Baton does

1. **Sources in, with consent.** The outgoing person uploads chat exports and documents, or connects a live channel
   (GitHub, Discord, Telegram, Slack). Nothing from a channel is saved until the handover's creator reads and accepts
   a capture statement, and the bot tells the channel when saving starts, pauses or stops.
2. **A handover that cites its evidence.** Baton extracts decisions, owners, tasks, risks and open questions. Every
   point links to the exact messages it came from, flagged sourced, inferred, conflicting or missing.
3. **Review before anyone sees it.** The creator reviews each point and fills gaps, then publishes.
4. **Invite the incoming person.** A single-use, expiring invitation gives them the published handover only, with
   a guided first week and acknowledgements.
5. **Living Handover.** When a source changes (a new export, new channel messages), Baton processes only what changed,
   shows the differences against the published version, and the creator reviews them before publishing a new version.

## For the judges: how to try it

* `/demo` — a fictional college coding club, no sign-in.
* `/login` → create an account → the welcome tour and Getting Started checklist guide the creator journey:
  New handover → consent → "Use sample data" → processing → review → Gap Interview link (answer it signed out in
  another browser) → publish → Settings → invite → open the invitation in another browser and accept.
* Living Handover: Settings → Start a revision → New version of the chat → Process the new version → Changes.
* [to confirm] Connected channels on a test handover: Settings → Connected channels (needs provider setup on the
  deployment; otherwise every provider honestly shows "Not set up on this server").

## Privacy and safety (implemented)

* Consent gate before any channel message is stored (enforced in application code, SQL and a CHECK constraint).
* Provider tokens sealed with AES-256-GCM, decrypted only server-side; never sent to the browser or logs.
* Minimal provider permissions (Slack: public channels, names and the channel notice only; private channels and the
  slash command are opt-in). Telegram connect links are sent privately to the admin who asked.
* Webhooks verified (GitHub HMAC, Discord Ed25519, Slack signing secret with replay window, Telegram secret token)
  and de-duplicated; disconnecting or deleting an account revokes capture and deletes buffered messages.
* Row-level security on every table; connector tables are reachable only through server-side functions.

## Architecture

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres + RLS, Auth,
Storage) · Zod · background processing worker · node:test suites (≈3,000 tests) and SQL suites in throwaway Postgres
containers. Details: `docs/architecture/`, connectors: `docs/round4/connectors-contract.md`.

## Verification (honest status)

See `docs/round4/STATUS.md`.

* **Browser-verified (Playwright, real interactions, 2026-11-19; local stack, built-in test AI adapter):** sign-up,
  welcome and tours with saved progress, the full creator journey, Gap Interview without an account, publish,
  invitation (reissue, accept, already-used), incoming-member restrictions and acknowledgement, and Living Handover
  (new version → 2 contradictions → corrections → version 2 → re-acknowledge; version 3 → new information).
  Evidence: `docs/round4/review/browser/VERIFICATION.md`.
* **Automated:** ≈3,000 unit/integration tests plus SQL suites in throwaway Postgres containers, all passing.
* **Live provider delivery (GitHub, Discord, Telegram, Slack):** [to confirm per provider] — implemented and tested
  with synthetic events only so far; no live event has been verified yet.
* **Processing with a real AI provider:** [to confirm] — verified with the deterministic test adapter only.

## Team

[to confirm]
