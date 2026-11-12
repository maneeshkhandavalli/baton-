# Draft PR: feature/main-integration → master — connected Baton application (Round 2)

**Draft, for product-owner review. Do not merge until the gates below are accepted.**

## What this connects
The real journey runs end to end on the existing UI:
1. Sign in, enter the workspace, create a handover and its members.
2. Upload WhatsApp TXT/ZIP or documents.
3. Record consent, then preview with exclusions.
4. Parse with privacy masking, persist only the masked data, then delete the raw upload.
5. Structured extraction, exact quote verification and independent support verification.
6. Analyze and prepare review; a human reviews and approves.
7. Publish; the incoming member reads the handover by membership.

The read-only `/demo` stays on synthetic mocks.

| Layer | Owner | Summary |
|---|---|---|
| `lib/data`, `lib/actions` | backend | Real `BatonQueries` and every §11.3 Server Function: Zod, then verified actor, then a service-role SECURITY DEFINER mutation, then an RLS re-read. Every persisted free-text field is masked per request. Erasure and account deletion fail closed (D27). |
| `lib/ai`, `fixtures/ai` | ai-engine | Provider-neutral interface. `provider_not_configured` unless the test adapter is explicitly allowed with `NODE_ENV` exactly `development` or `test` (D11). Zod-validated extraction and support verification, a grapheme-safe §10.7 quote check, and drops for fabricated, foreign, contradictory and unmasked output. A 15-case prompt-injection suite; the live suite is gated on D11. |
| `lib/pipeline` | pipeline | Planner, fail-closed pepper and a fenced, DB-backed worker. Parse applies exclusions and masking before a single persist transaction and deletes raw only after commit. Extraction chunks are single-source at that source's access level. Then verify_quotes, verify_support, analyze (D21 checklist → gap questions) and prepare_review. Nothing auto-approves or publishes. |
| `supabase/migrations/20261112000100–0500`, `lib/db` | lead | All additive:<br>• stage-aware claim with a lease reaper; fenced completion and heartbeat<br>• worker reads of masked data; run-outcome reads<br>• DB-side quote plausibility, including exact offsets for all-BMP bodies<br>• actor-checked preview target<br>• legacy unfenced job functions revoked<br>• reason-token-only run errors |
| `app/**`, `components/**` imports | lead | UI on real data and actions, the real invitation flow on `/h/[token]`, `/handover/[id]/published` (Q3, membership-based), and the drain route (POST, Bearer `CRON_SECRET`). |
| `tests/integration/**` | qa-security | 218 Node scenarios, 6 SQL suites, and a gated end-to-end run on real Postgres. |
| `lib/contracts` | lead | The AI output schemas named by §11.8, with §12.10 caps. |

## Verification — exact outputs at `7c58e64`
Clean tree. Every command exited 0. Later commits change only this document.

| Command | Exit | Result |
|---|---|---|
| `npm run test:contracts` | 0 | 103/103 |
| `npm run test:db` | 0 | 105/105 |
| `npm run test:parsers` (parsers + privacy) | 0 | 390/390 |
| `npm run test:ui` | 0 | 64/64 |
| `npm run test:ai` | 0 | 166/166 |
| `npm run test:actions` | 0 | 81/81 |
| `npm run test:pipeline` | 0 | 91/91 |
| `npm run test:integration` | 0 | 218/218 |
| `npm test` (all of the above) | 0 | **1,218 pass, 0 fail, 0 skipped, 0 todo** |
| `npm run test:sql` (Docker Postgres 15) | 0 | 9/9 files pass |
| `npm run test:integration:sql` (Docker) | 0 | 6/6 files pass; 1 accepted residual reported (QA-L1 DB half) |
| `BATON_IT_PG=1 npm run test:e2e` (Docker) | 0 | 4/4: a synthetic WhatsApp export runs through upload, consent, preview, processing with the test adapter, human approval and publication, and is read by the incoming member under RLS. All 6 jobs succeeded on attempt 1. |
| `npx tsc --noEmit` | 0 | 0 errors |
| `npx eslint .` | 0 | no output |
| `npm run build` | 0 | success; no server-only variable names in `.next/static` |

**Not tested:** hosted Supabase (never touched), any production AI provider (none exists, D11), and a browser run against a full local Supabase stack (it needs the Supabase CLI, which was not installed).

## Security triage (QA-verified reproductions, release review)
| Finding | Severity | Status / gate |
|---|---|---|
| QA-L3, TypeScript half: fake adapter allowed with unset `NODE_ENV` | low | **Fixed** (`ab7847d`). Only `development`/`test`; hard tests. |
| QA-M1b: exact-quote offsets not checked in SQL | low | **Fixed** (`7b49486`). Exact offsets enforced for all-BMP bodies; hard test. |
| QA-L2: `erase_participant`/`purge_handover` lack actor checks | medium (latent) | **Must fix before enabling erasure/purge.** Both functions are revoked from every role today (D27). |
| QA-L5: credential masker misses whitespace forms (`password Hunter2`, `pin 4821`) | medium | **Must fix before enabling production AI.** Needs a §12.1 contract change in `lib/privacy`. |
| DB-12: four worker writers not fenced to their job/run | medium | **Must fix before enabling production AI.** Production cannot start a run while D11 is open. |
| DB-13: point and evidence not written atomically | low | **Must fix before enabling production AI.** |
| QA-L3, DB half: the database accepts provider `fake` | low | Documented limitation; the TypeScript guard is fixed. |
| QA-L7: per-client rate limit trusts `X-Forwarded-For` | low | Documented limitation; choose the trusted header per platform at deployment. Per-token limits hold. |
| QA-I1: incoming members see member roles/ack flags and author profile UUIDs | low | Documented limitation; no content leaks, and UUIDs grant nothing under RLS. |
| QA-L1, DB half: `mark_source_raw_deleted` accepts unparsed sources | low | Documented limitation; the retention sweep needs it. The TypeScript path refuses non-parsed sources. |
| PI-11: a verifier model that obeys an injected quote | — | **Must pass the live injection suite before enabling production AI.** |

**No unresolved must-fix-before-Round-2 security finding remains.** qa-security independently reviewed
`2076b8b..5d6f412` and found no correctness or security regressions, no weakening of D11 or D27, and no
secrets.

## Product decisions
- **Q3**: retained. `/handover/[id]/published` with membership-based access.
- **D21**: retained. Uncovered checklist categories become gap questions, never fabricated missing points.
- **Q1**: contract revision proposed for owner approval in
  `docs/integration/proposals/q1-opaque-participant-refs.md`. The browser would get opaque per-preview
  participant references instead of identity hashes, and exclusion hashes would be recomputed on the
  server. The canonical contract is unchanged until approved.
- **Q5**: per-run caps retained (≤ 200 extract and ≤ 2000 verify calls per run). Per-user and per-team
  upload and AI limits are designed in `docs/integration/proposals/q5-rate-limits.md` and are required
  before production AI.

## Still closed
- **D11:** production AI is `provider_not_configured`.
- **D27:** erasure, purge and account deletion fail closed.
- **Hosted Supabase:** no deployment and no migrations applied.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
