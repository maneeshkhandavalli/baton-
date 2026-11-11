# Draft PR: feature/main-integration → master — connected Baton application (Round 2)

**Do not merge until the open decisions below are reviewed.** Draft only.

## What this connects
The real journey now runs end to end on the existing UI:
sign in → workspace → create handover → members → upload WhatsApp TXT/ZIP or documents → consent and
preview/exclusions → parse with privacy masking → persist masked data, delete raw → structured extraction
→ exact quote verification → independent support verification → analyze and prepare review → human
review → approval → publication → incoming member reads it by membership.

| Layer | Owner | Summary |
|---|---|---|
| `lib/data`, `lib/actions` | backend | Real `BatonQueries`; every §11.3 Server Function: Zod → verified actor → service-role SECURITY DEFINER mutation → RLS re-read; per-request masking of every persisted free-text field; erasure and account deletion fail closed (D27) |
| `lib/ai`, `fixtures/ai` | ai-engine | Provider-neutral interface, `provider_not_configured` unless the dev/test fake is explicitly allowed outside production (D11), Zod-validated extraction and support verification, grapheme-safe §10.7 quote check, drops for fabricated / foreign / contradictory / unmasked output, 15-case prompt-injection suite (live suite gated on D11) |
| `lib/pipeline` | pipeline | Planner, fail-closed pepper, fenced DB-backed worker, parse (exclusions + masking before the single persist transaction; raw deleted only after commit), single-source extraction chunks at the source's access level, verify_quotes, verify_support, analyze (D21 checklist → gap questions), prepare_review; nothing auto-approves or publishes |
| `supabase/migrations/20261112000100–0400`, `lib/db` | lead | Additive: stage-aware claim with lease reaper, fenced completion and heartbeat, worker reads of masked data, DB-side quote plausibility, actor-checked preview target, run-outcome reads; legacy unfenced job functions revoked; reason-token-only run errors |
| `app/**`, `components/**` imports | lead | UI on real data/actions (`/demo` stays on synthetic mocks), real invitation flow on `/h/[token]`, `/handover/[id]/published`, drain route (POST, Bearer CRON_SECRET) |
| `tests/integration/**` | qa-security | 214 Node scenarios, 6 SQL suites, gated end-to-end run on real Postgres |
| `lib/contracts` | lead | AI output schemas named by §11.8 and their §12.10 caps |

## Verification (at 1374837)
- `npm test`: contracts 103, db 105, parsers/privacy 390, ui 64, ai 153, actions 81, pipeline 91, integration 214, 0 failures.
- `npm run test:sql` 9/9 · `npm run test:integration:sql` 6/6 · `BATON_IT_PG=1 npm run test:e2e` 4/4 (synthetic WhatsApp export → published, read by the incoming member under RLS; every job succeeded on attempt 1).
- `tsc --noEmit`, `eslint .`, `next build`: clean. No server-only variable names in client bundles; no secrets in the diff.

## Safety properties (tested)
No raw PII in any AI request or persisted row · no file names or identity hashes sent to AI · exclusions applied before AI · quotes stored as exact body slices, fabricated quotes rejected in TS and SQL · no automatic approval or publication · RLS and actor verification on every path · cross-handover and cross-clearance ids indistinguishable from unknown ids · production AI is `provider_not_configured` · erasure, purge and account deletion fail closed · drain route authenticated.

## Open decisions (need the product owner)
- **D11** AI provider, models, retention. Until then production processing stops at `provider_not_configured`. Before enabling a provider, the live prompt-injection suite must pass (PI-11: a verifier that obeys an injected quote).
- **D27** recovery store: erasure, purge and account deletion remain disabled. Fix QA-L2 (actor checks in `erase_participant`/`purge_handover`) before granting them.
- **Q3** `/handover/[id]/published` implements the reconciliation proposal (default applied).
- **Q1** identity hashes in `SourcePreview` (contract shape kept; previews limited to source managers).
- **D21 deviation** uncovered checklist categories become gap questions, not `missing` points (no fabricated AI provenance).
- **Q5 / budgets** no upload or AI rate limits; per-run budgets 200 extract / 2000 verify calls.
- Also: QA-L3 (DB accepts provider `fake`), QA-L5 (credential masker misses whitespace separators), QA-L7 (X-Forwarded-For trust), QA-I1 (member roles / author UUIDs visible to incoming members), QA-M1b, DB-12/13.

## Not done
No hosted Supabase deployment, no production AI, no erasure/purge enablement. A browser run against a full local Supabase stack was not possible without installing the Supabase CLI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
