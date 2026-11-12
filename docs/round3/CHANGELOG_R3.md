# Round 3 changelog (integration/round3)

Lead-maintained. Each row is a commit on `integration/round3` (local coordination repo only). `Source` is the
worker commit it was cherry-picked from (`lead` = lead commit). Verification is recorded per batch below the table.

## Status legend
- **Integrated and tested**: on integration/round3, suites in "Verification" green.
- **Implemented, not integrated**: pushed on a worker branch, awaiting lead review.
- **Not yet implemented**: listed under "Open".

## Integrated commits
| # | Integration | Source | Change | Areas |
|---|---|---|---|---|
| 1 | `25b34b1` | `61552db` | fix(privacy): QA-L5 mask credentials written with whitespace and other separators | lib/privacy |
| 2 | `7708e52` | `663c30e` | feat(r3-backend): C1 draft metadata editing (update_handover_details + updateHandoverDetails) | lib/actions, lib/db, supabase/migrations, supabase/tests |
| 3 | `2c1f918` | `516d38b` | feat(r3-backend): C2 duplicate-draft prevention in create_handover | supabase/migrations, supabase/tests |
| 4 | `2037776` | `60ff634` | feat(r3-backend): C3 typed duplicate-upload conflict + unauthorised-access regression tests | lib/actions, lib/db |
| 5 | `014b41b` | `lead` | chore(round3): mock updateHandoverDetails; drop boundary-test tolerance | lib/actions, lib/mocks |
| 6 | `6faaa27` | `6e34bf3` | feat(db): DB-12 fenced pipeline writers, DB-13 atomic extract chunk, E4 yield checkpoint | supabase/migrations, supabase/tests |
| 7 | `17cf053` | `32edad0` | feat(r3-ingestion): parser robustness, provenance and privacy coverage (D2) | fixtures/parser, lib/parsers, lib/privacy |
| 8 | `8e7b430` | `3350293` | feat(r3-ingestion): signed-upload robustness and orphan detection (D2, D3) | lib/db, supabase/migrations, supabase/tests |
| 9 | `2ce161f` | `eccee43` | refactor(r3-ingestion): drop storage-side stale-row replacement (now Agent 2's create_source) | lib/db, supabase/migrations, supabase/tests |
| 10 | `474891e` | `0f3fbd1` | feat(r3-ingestion): multi-format synthetic QA set (D4) | fixtures/demo, lib/parsers |
| 11 | `ece7656` | `2b127a8` | docs(r3-ingestion): orphan-upload and raw retention proposal (D3) | docs/proposals, fixtures/parser |
| 12 | `66fb221` | `3e55554` | test(qa-r3): role matrix, QA-L2/D27 and DB-12/DB-13 Tier P suites | tests/integration |
| 13 | `3eca0ce` | `319b9e2` | test(qa-r3): privacy/QA-L5 pending, worker production refusal, draft resume, recovery | tests/integration |
| 14 | `e1b664f` | `0779bc3` | test(qa-r3): QA-L5 verified on integration (25b34b1) - flip to hard, add residual pending cases | tests/integration |
| 15 | `fc1ad24` | `e6a4d6e` | test(qa-r3): synthetic conflict fixture (B2) proven to yield contradicts with the fake adapter | tests/fixtures, tests/integration |
| 16 | `6d58ae9` | `c483ce0` | docs(qa-r3): browser scripts BS-01..08 for the lead's dev server | docs/qa |
| 17 | `e2d338d` | `9338692` | feat(ui): design system foundation — tokens, primitives, shell (A1) | app/(marketing), app/(workspace), app/globals.css, app/layout.tsx … |
| 18 | `5a37555` | `3e8c90c` | feat(ui): shell error boundaries and not-found on the design system (A9) | app/(token), app/(workspace), app/not-found.tsx, components/shared |
| 19 | `901369d` | `1d4def0` | feat(ui): dashboard — drafts-to-finish list with resume, prioritised handover cards (A3) | app/(workspace), components/dashboard |
| 20 | `07f3c24` | `lead` | test(qa-r3): integrate cb97ff8 + 1a41d26 (C1 coverage, TS2719 fix, findings doc) | docs/qa, tests/integration |
| 21 | `62adbda` | `ab96beb` | feat(pipeline): wire DB-12 fenced writers and DB-13 atomic chunks; loud schema errors | lib/db, lib/pipeline, supabase/migrations, supabase/tests |
| 22 | `f751202` | `48b2126` | fix(db): QA-R3-01 start_processing refuses an empty job list | supabase/migrations, supabase/tests |
| 23 | `6ff9dfe` | `lead` | test(round3): fixtures start runs with a non-empty job list (QA-R3-01) | supabase/tests, tests/integration |
| 24 | `4462119` | `bf82708` | feat(r3-ingestion): raw cleanup on discard (R3-D5) | docs/proposals, lib/db, supabase/migrations, supabase/tests |
| 25 | `ca5c01c` | `lead` | test(round3): it11 starts runs with a non-empty job list (QA-R3-01) | tests/integration |
| 26 | `3439ebd` | `lead` | test(qa-r3): integrate 4488d9a + 5986859 (test plan, fenced-API checks, Tier E multi-source); refusal test follows fenced writers | docs/qa, tests/integration |
| 27 | `d5e23dc` | `4c02b02` | feat(r3-backend): C5 interrupted-upload retry in create_source | lib/actions, supabase/migrations, supabase/tests |
| 28 | `d63baca` | `8c11d0b` | feat(r3-backend): HandoverSummary.description (lead-approved contract change) | lib/actions, lib/contracts, lib/db, lib/mocks … |
| 29 | `8433e0f` | `275ad4a` | fix(r3-backend): createGapQuestion never reports not_found after its commit | lib/actions |
| 30 | `7c03432` | `d99fc1d` | feat(ui): new-handover wizard — editable details with autosave, stepper, per-file upload states (A2) | app/(workspace), components/shared, components/wizard |
| 31 | `5b2eb18` | `75e37cc` | feat(ui): wizard upload robustness — confirm retries, cleanup errors, .txt chat vs plain text (A2, Agent 3 requests) | components/wizard |
| 32 | `1009b50` | `37c2356` | refactor(ui): app-wide token sweep — no arbitrary type sizes, eyebrow/title roles, danger text token | app/(auth), app/(marketing), components/account, components/auth … |
| 33 | `9d7533d` | `93f3376` | feat(ui): review workspace — unambiguous approve/reject, conflicts vs gaps, readable evidence (A4) | components/review |
| 34 | `e461f19` | `24fb5a3` | feat(ui): published handover — editorial document for the incoming member (A6) | components/published |
| 35 | `7e44c67` | `8015ad0` | feat(ui): processing — live indicator, failure alert with retry path, single summary sheet (A5) | components/processing |
| 36 | `4a093c9` | `027de93` | feat(ui): gaps manager, gap interview, settings, account on shared controls (A7, A8) | components/account, components/gap-interview, components/gaps, components/settings |
| 37 | `67b22f0` | `a9b8131` | feat(ui): homepage, demo, login and token pages on the design system (A8) | app/(auth), app/(marketing), app/(token), components/marketing |
| 38 | `3bcc148` | `99bade6` | docs(design): milestone 2 status and per-area notes | docs/design |
| 39 | `2abb426` | `50d59cf` | feat(r3-backend): C6 deleteHandover removes the discarded draft's raw uploads | lib/actions |
| 40 | `d6386c4` | `lead` | chore(round3): routes.signOut for the workspace sign-out form (Agent 1 request) | lib/routes.ts |
| 41 | `915aa14` | `6b0feaf` | fix(r3-ingestion): check the handover segment of raw paths (QA-R3-06) | lib/db |
| 42 | `0d31d8f` | `31e7830` | feat(ai): PI-11 deterministic guard against verifier prompt injection | fixtures/ai, lib/ai, lib/pipeline |
| 43 | `5695dec` | `cab0489` | test(qa-r3): it11 rows share one handover with their raw path (QA-R3-06 fixed in 6b0feaf) | docs/qa, tests/integration |
| 44 | `470a736` | `b7b1553` | test(qa-r3): flip DB-12-TS, DB-13-TS, QA-R3-01 and QA-R3-05 to hard assertions | tests/integration |
| 45 | `03fa514` | `8cac176` | fix(r3-privacy): mask residual credential forms QA-L5-R1..R6 | lib/privacy |
| 46 | `64a6797` | `60731d3` | fix(r3-backend): C7 QA-L2 actor-first validation in erase_participant / purge_handover | supabase/migrations, supabase/tests |
| 47 | `182e715` | `lead` | test(round3): 40_lifecycle follows C5 (retrying an unfinished upload reuses the pending source) | supabase/tests |
| 48 | `4149cd4` | `fe665d0` | feat(pipeline): E4 recovery, multi-source and dev drain robustness; apply-order note | docs/round3, lib/pipeline |
| 49 | `e450931` | `ca51b14` | fix(r3-ingestion): bind the preview raw path to the source's handover (QA-R3-06) | lib/db |
| 50 | `4b92456` | `d4f4d46` | feat(r3-ingestion): fenced integrity-mismatch writer for the parse job (DB-12) | lib/db |
| 51 | `720bfee` | `76b4cd7` | fix(db): DB-12-LEGACY revoke the unfenced pipeline writers from API roles | supabase/migrations |
| 52 | `4c9aaf1` | `68a0476` | test(qa-r3): fixtures for DB-12-LEGACY revoke (76b4cd7); legacy reproductions now hard | supabase/tests, tests/integration |
| 53 | `e8174d8` | `62e861b` | feat(ui): sign-out via routes.signOut; wizard edits the stored description on resumed drafts | app/(workspace), components/layout, components/wizard, config/navigation.ts |
| 54 | `0105c6b` | `7078e4f` | fix(ui): responsive hardening at 390/1024/1440 on the priority surfaces | app/globals.css, components/dashboard, components/handover, components/layout … |
| 55 | `0117f91` | `056448f` | feat(ui): decisions and action items first-class — owner, due date, status strip | components/published, components/review, components/shared |
| 56 | `87294dc` | `5eaeb83` | feat(ui): consistent loading skeletons and error boundaries on every route | app/(marketing), app/(token), app/(workspace), components/shared |
| 57 | `a17732e` | `2e110f1` | fix(ui): a11y pass — heading order, live upload/save states, focus after step changes and review actions, reduced motion | app/(token), components/gap-interview, components/published, components/review … |
| 58 | `e5c7e6d` | `c2c548f` | test(qa-r3): details autosave A2 x C1 end to end; UI batch code review; findings updated | docs/qa, tests/integration |
| 59 | `e56aec6` | `198e6bf` | test(qa-r3): independent PI-11 guard probe; findings: PI-11 verified (floor) with residuals R1-R5, DB-12 verified | docs/qa, tests/integration |
| 60 | `013c870` | `lead` | test(round3): IT-04 ignores escaped attribute values when looking for event handlers | tests/integration |
| 61 | `a641b9d` | `0d222b3` | fix(pipeline): parse writes an integrity mismatch under its claim (fenced) | lib/pipeline |
| 62 | `5263d04` | `94b451b` | fix(db): DB-12-LEGACY revoke mark_source_parse_failed from API roles | supabase/migrations |
| 63 | `4236e4c` | `65c0134` | feat(status): E4 partial stage status in processing status (lead-approved) | docs/round3, lib/contracts, lib/db, lib/mocks … |
| 64 | `e8c139a` | `7615c3c` | fix(r3-ingestion): mark_source_raw_deleted refuses sources that still need their raw upload (QA-L1) | docs/proposals, supabase/migrations, supabase/tests |
| 65 | `307554a` | `4ee390b` | feat(r3-ingestion): confirm refuses a renamed or wrong-type upload early (request #4) | lib/db, supabase/migrations, supabase/tests |
| 66 | `643b302` | `lead` | test(round3): fixtures follow the mark_source_parse_failed revoke (300600) | supabase/tests, tests/integration |
| 67 | `498818d` | `961278f` | docs+test(r3-backend): C8 hosted-apply readiness for every Round 3 migration | docs/round3, supabase/tests |

## Verification (latest full run on the integration HEAD at the time of writing)
- `npm test`: contracts 104, db 216, parsers+privacy 581, ui 100, ai 200, actions 152, pipeline 116, integration 294 (0 fail)
- SQL (Docker): PG17 19/19, PG15 19/19 · integration SQL 10/10 · Tier E real-Postgres E2E 4/4 · multi-source 5/5
- `tsc --noEmit` 0 errors · `eslint .` clean · `next build` passed (at 470a736; re-run at the end)
- Upgrade-path test (populated DB, every R3 migration in order): PG17 + PG15 pass (Agent 2, C8)

## Implemented, not integrated
(none at the time of writing; see the latest status update)

## Not yet implemented / open
- Live browser verification (Chrome extension not connected) — authenticated routes at 390/1024/1440
- Hosted dev migrations — awaiting approval (plan: docs/round3/migrations.md)
- UI rendering of the new `partial` stage status and `db_schema_outdated` / `no_jobs` reasons (Agent 1)
- QA hard-assertion flips: QA-L1 and QA-L2 (7) now hold (Agent 5)
- Product decisions: address masking, exclusions in non-chat documents, retention sweep/cron, outgoing-member cancel (QA-R3-04), PI-11 residuals (D11 live suite)
