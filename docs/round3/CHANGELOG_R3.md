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
| 68 | `b5d3480` | `f8b31b7` | refactor(r3-ingestion): parse-job raw download requires its claim; drop the unfenced writer (DB-12) | |
| 69 | `e3d83dd` | `fc6743d` | docs(r3-ingestion): retention proposal — decision summary for the product owner | |
| 70 | `a2b44a1` | `lead` | test(round3): security + IT-11 pass the job claim to downloadVerifiedRawSource (f8b31b7) | |
| 71 | `0786b1f` | `ae0601f` | test(qa-r3): QA-L1, QA-L2 (7) and QA-L5-R1..R6 now hard; UI batch 2 + hosted-apply plan review | |
| 72 | `794709f` | `31b01f8` | docs(r3-privacy): proposal — postal addresses as a §12.1 mask kind | |
| 73 | `b3f68ac` | `9ca7118` | docs(r3-privacy): proposal — participant exclusions in PDF/DOCX/MD companions | |
| 74 | `0c26c0e` | `94eb74f` | docs+test(r3-backend): C8 update - all 16 Round 3 migrations, hosted apply runbook (QA-R3-13/14) | |
| 75 | `56eaa27` | `669cc9a` | test(qa-r3): headless browser harness tests/browser/run.mjs; PI-11 residuals analysis | |
| 76 | `38f0e98` | `lead` | test(round3): browser harness ignores the Next.js dev overlay and non-overflowing decorative layers | |
| 77 | `0bb1b96` | `d635477` | feat(db): claim generation fences writers; an expired lease is not renewed | |
| 78 | `06a0fa3` | `dbeed82` | docs(r3-ingestion): retention decision summary — options, risks and consequences per choice | |
| 79 | `2f6c9b3` | `d628306` | feat(ui): processing — partial stage state and plain-language run reasons | |
| 80 | `3636804` | `d4cbdb6` | fix(ui): DEMO-SCROLL — review scrolls only on user-driven selection, never on mount | |
| 81 | `a0dd414` | `726d5b9` | feat(ui): show the PI-11 injection guard distinctly on review evidence | |
| 82 | `670c2da` | `0dad0ee` | feat(ui): wizard — wrong-type upload shows "This file isn't a valid <kind>" on the row | |
| 83 | `c1acd4c` | `88357ef` | fix(ui): QA-R3-11 — point title heading wraps its select button, not the reverse | |
| 84 | `f677338` | `a1636fb` | docs(design): route-by-route verification checklist (13 routes + boundaries) | |
| 85 | `07d8897` | `8057e21` | fix(ui): QA-R3-12 — invalid date-like values never throw or shift | |
| 86 | `f76439e` | `e3ca083` | feat(ui): QA-R3-15 — global-error boundary and (auth) error boundary | |
| 87 | `b5464f5` | `8e778aa` | feat(ui): dev-only design previews — /preview, dashboard and review | |
| 88 | `95423e9` | `70eff0d` | feat(ui): dev-only previews — wizard (4 steps, every upload state), processing, published | |
| 89 | `f24171f` | `b304bb3` | feat(ai): PI-11 residuals R1-R5 in the deterministic verifier guard | |
| 90 | `1f896b8` | `5e5230e` | docs(round3): add migration #17 (claim_generation) to the hosted-apply plan; upgrade test covers it | |
| 91 | `f52cfa6` | `08853af` | feat(review): PI-11 guard fields on PointDetail evidence (guarded, modelVerdict) | |
| 92 | `f256b92` | `1858361` | test(qa-r3): QA-R3-12 hard; preview guard + shared render checks; UI batch 3 review | |
| 93 | `43a56cd` | `05f4049` | fix(ui): preview runtime errors — DraftRow module, wizard clock, deterministic rendering | |
| 94 | `3fb28f6` | `lead` | test(round3): render-determinism imports DraftRow from its new module (05f4049) | |
| 95 | `a450123` | `ede850a` | feat(r3-ingestion): distinguishing reasons for refused uploads (QA-R3-16, storage half) | |
| 96 | `c3da9b5` | `9b616e1` | test(qa-r3): PI-11-R1..R5 hard (f24171f); guarded evidence render; link stub lint | |
| 97 | `da7dd56` | `lead` | feat(round3): toAppError passes structural snake_case details (QA-R3-16 upload reasons) | |
| 98 | `57b9461` | `aa9446f` | fix(ui): QA-R3-12-R1 — first-week due dates never roll over or guess | |
| 99 | `c9797ac` | `507eedb` | feat(ui): PI-11 — review reads EvidenceItem.guarded instead of the rationale text | |
| 100 | `186d070` | `283f2fb` | fix(ui): QA-R3-16 — confirm validation_failed messages follow details.reason | |
| 101 | `41f6dc6` | `1b3a54f` | fix(ui): preview titles dev-only; published stat labels wrap between words | |
| 102 | `dcfc98e` | `f391a16` | test(qa-r3): QA-R3-12-R1 and QA-R3-21 hard; QA-R3-16 action-level check; harness per-route status | |
| 103 | `351423c` | `62176fa` | docs(round3): add migration #18 (api_get_point guard fields) to the hosted-apply plan; upgrade test covers it | |
| 104 | `1e678b8` | `lead` | fix(round3): evidence guard fields stay undefined when the read lacks them (UI rationale fallback) | |

## Verification (integration HEAD 1e678b8)
- `npm test` suites: contracts 104, db 235, parsers+privacy 581, ui 154, ai 238, actions 152, pipeline 118, integration 349 (0 fail; 1 todo = D11-LIVE-1, a live-suite case by design)
- SQL (Docker, at 186d070, no SQL changed since): PG17 20/20, PG15 20/20 · integration SQL 10/10 (0 open findings) · Tier E E2E 4/4
- Upgrade-path test (populated DB, all 18 R3 migrations in order, api_get_point snapshot included): PG17 PASS (Agent 2), PG15 19/19 PASS (lead, 1e678b8)
- `tsc --noEmit` 0 · `eslint .` clean · `next build` PASS at 186d070 (re-run pending: host memory critically low)
- Production (`next start`, 186d070): every /preview route 404 with no mock data; titles now dev-only (41f6dc6)
- Browser harness (clean dev server, 1440/1024/390, 186d070): home, login, demo, all /preview routes PASS
  Screenshots: baton-multiagent/verification/browser-public, browser-preview-2, browser-final
- Dev server stopped by Claude Code under memory pressure; final browser pass + build re-run pending a restart

## Implemented, not integrated
- (none: every worker commit is integrated; agent 2's local merge 980bfb7 holds no changes)

## Not yet implemented / open
- Live browser verification (Chrome extension not connected) — authenticated routes at 390/1024/1440
- Hosted dev migrations — awaiting approval (plan: docs/round3/migrations.md)
- UI rendering of the new `partial` stage status and `db_schema_outdated` / `no_jobs` reasons (Agent 1)
- QA hard-assertion flips: QA-L1 and QA-L2 (7) now hold (Agent 5)
- Product decisions: address masking, exclusions in non-chat documents, retention sweep/cron, outgoing-member cancel (QA-R3-04), PI-11 residuals (D11 live suite)
