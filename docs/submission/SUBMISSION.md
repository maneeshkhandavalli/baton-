# Baton: hackathon submission (Round 3)

Every claim below is backed by `docs/status/STATUS.md`, `docs/status/AI_RECOVERY.md`,
`docs/ai/ai-extraction-and-verification.md` §9 and `docs/review/browser/VERIFICATION.md`.

**Project link:** https://baton-seven-alpha.vercel.app · **Demo without an account:**
https://baton-seven-alpha.vercel.app/demo · **Code:** https://github.com/maneeshkhandavalli/baton- (public; `master` is
the deployed code) · **Run it locally:** [`README.md`](../../README.md#run-it-locally)

## One line

Baton turns a team's chats and documents into a handover for the next person, where every decision, owner, task and
risk links back to the message it came from.

## The problem

Student clubs, project teams and volunteer groups rotate people every term. What the next person needs (who decided
what, what is owed, what is risky) is buried in months of group chat. Handover documents are written from memory, go
stale the week after, and can't be checked.

## What Baton does

1. **Sources in, with consent.** The outgoing person uploads chat exports and documents, or connects a live channel
   (Telegram verified live; GitHub, Discord and Slack built, not verified live). Nothing from a channel is saved until
   the handover's creator reads and accepts a capture statement, and the bot tells the channel when saving starts,
   pauses or stops.
2. **A handover that cites its evidence.** Baton extracts decisions, owners, tasks, risks and open questions. Every
   point links to the exact messages it came from, flagged sourced, inferred, conflicting or missing.
3. **Review before anyone sees it.** The creator reviews each point and fills gaps (Gap Interview), then publishes.
4. **Invite the incoming person.** A single-use, expiring invitation gives them the published handover only, with
   a guided first week and acknowledgements.
5. **Living Handover.** When a source changes (a new export, new channel messages), Baton processes only what changed,
   shows the differences against the published version, and the creator reviews them before publishing a new version.
6. **Decision Timeline.** The published points in the order things happened, by the date of the cited message.

## For the judges: how to try it

* `/demo`: a fictional college coding club, no sign-in, no AI calls.
* `/login` → **Continue with Google** (email and password sign-up exists, but the default Supabase mailer only
  delivers to team addresses, so confirmation emails will not reach judges). The welcome tour and Getting Started
  checklist guide the creator journey: New handover → consent → "Use sample data" → processing (keep the page open) →
  review → Gap Interview link (answer it signed out in another browser) → publish → Published and Timeline tabs →
  Settings → invite (copy the link) → open the invitation in another browser and accept.
* Living Handover: Settings → Start a revision → New version of the chat → Process the new version → Changes.
* Connected channels: Settings → Connected channels. No provider is configured on the deployed site, so every provider
  honestly shows "Not set up on this server". The Telegram connector was verified live on a local isolated stack.

## Round 3 commitments (Round 1 proposal, "Round 3: three committed improvements")

| # | Commitment | Status |
|---|---|---|
| 1 | GitHub + decision timeline | **Timeline delivered** (real app tab + demo). **GitHub connector built**, tested with synthetic events only, not verified live and not configured on production. The timeline orders points by date; it does not link a commit to a chat decision automatically. |
| 2 | Ask the handover | **Not built.** We prioritised a reliable real-AI pipeline (recall 58.7% → 100% on labelled synthetic data), consent and privacy over a Q&A layer built on unreliable extraction. Next on the roadmap. |
| 3 | Living handover | **Delivered and browser-verified** (versions 2 and 3, Playwright, 2026-11-19) and verified live with Telegram data (2026-11-20). |

## Privacy and safety (implemented)

* Consent gate before any channel message is stored (enforced in application code, SQL and a CHECK constraint).
* Masking of phone numbers, emails, UPI IDs, bank accounts, IFSC codes, cards, government IDs, passwords, API keys and
  secrets; participant names are replaced by pseudonyms before any AI call, and the mapping is encrypted.
* AI consent statement `omega-owner-approved-2026-11-20-v1` names the Omega Plus gateway and says its retention and
  training terms are not documented.
* Provider tokens sealed with AES-256-GCM, decrypted only server-side; never sent to the browser or logs.
* Minimal provider permissions (Slack: public channels, names and the channel notice only; private channels and the
  slash command are opt-in). Telegram connect links are sent privately to the admin who asked.
* Webhooks verified (GitHub HMAC, Discord Ed25519, Slack signing secret with replay window, Telegram secret token)
  and de-duplicated; disconnecting or deleting an account revokes capture and deletes buffered messages.
* Row-level security on every table; connector tables are reachable only through server-side functions.

## Architecture

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Supabase (Postgres 17 +
RLS, Auth, Storage; 57 migrations) · Zod · fenced background processing worker · AI through one provider interface
(Omega Plus live: `claude-sonnet-5-5` extract, `claude-sonnet-5` verify; Gemini adapter; dev-only test adapter) ·
Vercel. Details: `docs/architecture/`, connectors: `docs/connectors/connectors-contract.md`.

## Verification (honest status)

See `docs/status/STATUS.md`.

* **Production (2026-11-20):** real AI processing had failed closed since 2026-11-17 (missing governance setting,
  18 unapplied migrations, missing identity-map key; `docs/status/AI_RECOVERY.md`). Fixed tonight: migrations applied
  after an upgrade rehearsal (41/41), Omega Plus configured under the owner-approved governance profile, redeployed.
* **Real-model evaluation (synthetic datasets only, `ai-extraction-and-verification.md` §9):** extraction recall
  100% (46/46) with adapter `omega-anthropic@3` (58.7% before the schema-in-instructions fix), citation accuracy
  93.6% to 96.2% across runs, unsupported claims about 2%. Live prompt-injection suite 20/25; the 5 failures are
  verifier verdicts that the deterministic PI-11 guard catches every time (documented residual). Real Gemini
  `extract@2`: recall 93.5%.
* **Browser-verified (Playwright, real interactions, 2026-11-19; local stack, built-in test AI adapter):** sign-up,
  welcome and tours with saved progress, the full creator journey, Gap Interview without an account, publish,
  invitation (reissue, accept, already-used), incoming-member restrictions and acknowledgement, and Living Handover
  (new version → 2 contradictions → corrections → version 2 → re-acknowledge; version 3 → new information).
  Evidence: `docs/review/browser/VERIFICATION.md`.
* **Automated:** 2,916 node:test tests (1 todo) plus SQL suites in throwaway Postgres containers, all passing; a fresh
  clone of `master` passes `npm ci` + `npm test` (2026-11-20).
* **Live provider delivery:** **Telegram verified live on 2026-11-20** (local isolated stack via an ngrok tunnel,
  development bot, real group messages; capture consent and capture windows, import as versions 1 and 2, processing
  with the test adapter, publication v2, incoming acknowledgement, channel and group disconnect; evidence in
  `docs/status/STATUS.md`). **GitHub, Discord, Slack:** implemented on the same shared connector infrastructure and
  tested with synthetic events only; no live event verified; not configured on production.

## Known limitations

* GitHub, Discord and Slack connectors are not verified live and not configured on production.
* Ask the handover (commitment 2) is not built.
* The verifier model can answer "supports" on injected quotes; the deterministic guard is the backstop and human
  approval is mandatory.
* Contradiction retrieval is lexical; extraction is not reproducible between runs.
* Omega Plus does not document retention, training use or upstream processors: synthetic data only.
* No email provider: invitation and Gap Interview links are copied by hand.

## Team

Autistic Griffindors: Rithika Gampa (Team Leader, Product / Research) and Maneesh Khandavalli (Design & Development).
