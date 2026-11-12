# Round 3 test plan and coverage map (Agent 5, QA/security)

Baseline `24320e1`; plan `docs/round3/plan.md`. Companion docs: `docs/qa/round3-findings.md` (defects,
branch reviews), `docs/qa/browser-scripts.md` (BS-01…08, run by the lead or by QA when the browser is
available).

## 1. How to run

| Suite | Command (Windows: add `--script-shell "C:\Program Files\Git\bin\bash.exe"`) | Docker |
|---|---|---|
| Everything Node | `npm test` (contracts, db, parsers+privacy, ui, ai, actions, pipeline, integration) | no |
| Integration only | `npm run test:integration` | no |
| SQL unit (owners) | `BATON_PG_CONTAINER=baton-pg-agent05 npm run test:sql` | yes |
| Tier P (QA SQL) | `BATON_IT_CONTAINER=baton-it-agent05 bash tests/integration/db/run.sh [filter]` | yes |
| Tier E (real-Postgres E2E) | `BATON_IT_PG=1 BATON_IT_CONTAINER=baton-it-agent05 npm run test:e2e` | yes |

**Pending convention.** Open defects never make a suite red:
- SQL: `it.todo(<holds>, '<ID>', msg)` prints `TODO(open ID)`; once the condition holds it prints
  `NOW HOLDS ID (make it a hard assertion)`. `run.sh` lists those lines after each file.
- Node: `pendingUntilFixed(t, '<ID>', check)` marks the test `# TODO open ID`, or prints the diagnostic
  `NOW HOLDS ID` when the check passes. Flip it to a hard assertion in the same commit that verifies the fix.

## 2. Coverage map: risk area → existing and new tests

| Risk area | Existing coverage (baseline) | Added in Round 3 (this branch) | Gaps left |
|---|---|---|---|
| RLS / tenant isolation | `supabase/tests/sql/30_rls.sql`; `it05_cross_handover.sql` (every read/mutation on another handover = random id); `it06_cross_clearance.sql` | **it15_role_matrix.sql**: 6 personas (creator-as-reviewer, outgoing non-creator, reviewer, lead, incoming, non-member) × 31 server functions incl. `delete_handover`, `update_handover_details`, source management, review, gaps, tokens, members, creator transfer, acknowledgement; every call rolled back so all personas see the same state; non-member must get exactly not_found | Functions added later by other agents need a row (the it09 allow-list catches any new browser grant) |
| Actor binding (H1) | 30_rls (forged actor on start_revision), it07-it09 actions (D35 order) | it15 forged-actor block (delete/invite as the creator from another session); `updateHandoverDetails` added to the D35 ACTIONS map and WRITE_RPCS | — |
| Source access + signed upload paths | 40_lifecycle (M5 measurement), it11 raw lifecycle | it15: read access to sources/evidence/messages per persona; **Storage INSERT policy** (`can_upload_source_object`) per persona, other bucket, invented path, uploaded source, foreign prefix, removed member, deleted handover; browser sessions can never read, update or delete raw objects | Real Supabase Storage signed-URL behaviour (shim only); BS-02 in the browser |
| Production refusal of the fake adapter (B5) | `lib/ai/__tests__/config.test.ts`, it08 provider matrix (actions write nothing) | **r3-production-refusal.test.ts**: the real drain route → `PIPELINE_AI` → `getAiProviderForRun(process.env)` under production / unset / staging NODE_ENV and missing flags: extract and verify_support fail closed (failed, not retried, `provider_not_configured`), no provenance, no message read, no AI write; control under the allowed test adapter | — |
| Unauthorised resource access (B5) | it05, it13 (drain route 401), 30_rls | it15; BS-06 (URLs, not-found indistinguishable) | Browser run of BS-06 |
| Privacy: masking and evidence | it01-it02 parse/privacy, it01-it03-it04 AI, it14 action masking, `lib/privacy` tests | **r3-privacy-evidence.test.ts**: QA-L5 forms (hard since `25b34b1`), residuals R1–R6 (pending), chain chat → parse → masked bodies → fake extraction → evidence quotes contain no PII or credentials | — |
| Excluded participants | it01-it02 (parse/preview) | r3-privacy-evidence: excluded participant absent from parse, preview, AI request and every evidence quote | Refresh on the Scope step drops unsaved exclusions (QA-R3-03, UI) |
| Draft resume | `components/wizard/__tests__/draft-state.test.ts` | **r3-draft-resume.test.ts**: refresh at every step × 7 draft states × 17 `?step=` values never shows a step ahead of the draft; restored sources carry no File; consent re-recording | Server loader redirect rules (page component) → BS-01 |
| Failed-job recovery / multi-source | `it10_retry_partial.sql` (retry/backoff, reaper, failed run → draft/in_review, cancel fencing) | **it18_recovery.sql**: member views after a failure (reason tokens only), retry by creator AND outgoing only, old run never reclaimed, creator-only cancel, empty-job run (QA-R3-01, pending); **r3-e2e-multisource.test.ts** (Tier E): 3 sources, one broken, run succeeds with the other two | Live run in the browser (BS-05, needs server restarts) |
| D27 fail-closed | it09_privileges.sql, it09-d27-gate.test.ts | **it16_qa_l2_d27.sql** part A/C: structural scan — any function that turns on `baton.erasure`/`baton.purge` or deletes handovers is executable by no API role nor PUBLIC; no restore role | — |
| QA-L2 | none (documented only) | it16 part B: 7 cases under a simulated grant (pending) + 3 hard controls | Fix is lead-owned |
| DB-12 / DB-13 | none (documented only) | **it17_db12_db13_fencing.sql**: legacy writers 7 + 1 reproductions (pending, DB-12-LEGACY), fenced `pipeline_*` API hard-tested (stale attempt, stage scope, cancelled run, atomic chunk, idempotent repeat, foreign point); **r3-pipeline-fencing-wiring.test.ts**: worker must call only fenced writers (pending DB-12-TS / DB-13-TS) | Revoke legacy grants; TS wiring |
| PI-11 | `lib/ai/__tests__/prompt-injection.test.ts` (15 cases), live suite gated on D11 | — | Verify Agent 4's deterministic guard when pushed |
| Conflicts (B2) | none with real evidence | **tests/fixtures/round3-conflict/** + **r3-conflict-fixture.test.ts** (Node) and **r3-e2e-multisource.test.ts** (Tier E: `conflicting` point, resolution required) | Browser run (BS-03) |
| Upload robustness (D2) | 40_lifecycle (M5), it11 | Agent 3's storage/parser tests (reviewed); BS-02 | Browser run |
| Responsive / a11y (B3, A9) | none automated | BS-07 with an overflow console check | Browser run (extension was not connected) |

## 3. Verification matrix B1–B5, F1–F3

| ID | What must hold | Automated | Browser (BS) | Status at `1a41d26` |
|---|---|---|---|---|
| B1 | Incoming member reads the publication of their handover (to their clearance), sees it on the dashboard, no review workspace, no hashes; non-member reads nothing | it15 B1 block; Tier E e2e step 4; 30_rls | BS-04 (needs a second account, **[LEAD]**) | DB/RLS **PASS**; browser pending |
| B2 | A real synthetic conflict reaches review as `conflicting` with supports + contradicts; only review roles resolve | r3-conflict-fixture (Node); r3-e2e-multisource (Tier E); it15 `resolve_conflict` row | BS-03 | Node + Tier E **PASS**; browser pending |
| B3 | 1440 / 1024 / 390 without horizontal scroll; actions reachable | — | BS-07 | pending (browser) |
| B4 | Failed job recovery, multi-source processing, refresh at every stage | it10, it18, r3-draft-resume, r3-e2e-multisource (Tier E) | BS-01, BS-05 | automated **PASS** (+ QA-R3-01 pending); browser pending |
| B5 | Fake adapter refused outside dev/test end to end; unauthorised resources look missing | r3-production-refusal, it08, it15, it05 | BS-06 | **PASS** |
| F1 | QA-L5, DB-12, DB-13, PI-11 verified or reopened | r3-privacy-evidence, it17, r3-pipeline-fencing-wiring | — | QA-L5 **VERIFIED**; DB-12/13 **PARTIAL** (DB API verified, worker wiring + legacy revoke open); PI-11 not landed |
| F2 | QA-L2 analysed and tested; D27 fail-closed | it16, it09, it09-d27-gate | — | D27 **HOLDS**; QA-L2 **OPEN** (gated) |
| F3 | RLS + unauthorised-access regression for every new function | it15, it05 (`update_handover_details`), it09 allow-lists | — | **PASS** for C1/C2/C3 and the ingestion branch's `list_orphan_upload_candidates` |

## 4. Last full run (this branch)

- `npm test`: contracts 104, db 108, parsers+privacy 472, ui 74, ai 166, actions 144, pipeline 95,
  integration 264 pass + 6 todo (QA-L5-R1…R6) — 0 fail.
- Tier P SQL: 10/10 PASS; 17 open findings reported (QA-L1 1, QA-L2 7, DB-12 7, DB-13 1, QA-R3-01 1).
- `feature/r3-ingestion` test-merged in a temporary local branch: `npm test` green (db 160, parsers 566),
  Tier P 10/10 PASS.
- `npx tsc --noEmit`: clean except Next's generated `PageProps`/`LayoutProps` types, which need `next typegen`
  (not run in worker clones).
