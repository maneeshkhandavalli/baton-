# Baton — product completion audit (Round 3)

Audited at `integration/round3` HEAD `8e482d5` (local coordination repo; original repo untouched at
`24320e1`; 110 commits since the Round 3 baseline). Single lead developer; no workers running.

## 0. How this audit was done (and its limits)

- Code: every route (`app/**/page.tsx`, 3 route handlers), every server action (29 in `lib/actions`), the
  contract (`lib/contracts`), 18 Round 3 migrations, the pipeline and AI layer, and the test suites.
- Each server action was traced to its UI caller (`grep` of `components/**` and `app/**`).
- Tests run for this audit (host had ~0.7 GB free RAM, so no Docker/build/browser this pass):
  `tsc --noEmit` 0 errors · `eslint .` clean · `npm test` all suites green — contracts 104, db 235,
  parsers+privacy 581, ui 154, ai 238, actions 152, pipeline 118, integration 349 (1 todo by design).
- Most recent heavier runs (from the Round 3 log, same SQL since): SQL suite PG17 20/20 and PG15 20/20,
  integration SQL 10/10, real-Postgres E2E 4/4, multi-source E2E 5/5, upgrade-path test with all 18
  migrations on populated data PG17 + PG15, `next build` PASS (186d070), production `/preview/*` → 404.
- Browser: headless harness (`tests/browser/run.mjs`) verified public routes and the dev-only `/preview/*`
  design previews at 1440/1024/390 (0 overflow, one h1, visible focus, no console errors).
  **The real signed-in routes have NOT been exercised in a browser since the Round 3 redesign**: the
  Chrome extension is disconnected, and signing in on the user's behalf is not allowed.
- **Biggest environment fact:** the hosted dev Supabase project does not have the 18 Round 3 migrations.
  The integrated app therefore cannot edit draft details or process sources against hosted dev
  (it fails loudly with `db_schema_outdated`). End-to-end flows are verified only against local Postgres.

Status key: **COMPLETE** (implemented + verified end to end) · **IMPLEMENTED, UNVERIFIED** · **PARTIAL** ·
**NOT IMPLEMENTED** · **BLOCKED** (external decision/service).

"Verified" below means: an automated test exercises the behaviour through the real code path (SQL on real
Postgres, or the action/route layer), or it was exercised in a browser in Round 2 and its code path did not
change materially since. Unit tests alone never count as COMPLETE.

## 1. Feature matrix

### Authentication and accounts
| Feature | Status | Evidence | What remains | Deps | Pri |
|---|---|---|---|---|---|
| Magic-link sign-in / sign-up | IMPLEMENTED, UNVERIFIED (R3) | `app/(auth)/login/actions.ts` `signInWithOtp({shouldCreateUser:true})`; callback handles PKCE + OTP (`app/auth/callback/route.ts`); R2 browser sign-in worked | Re-run in browser after redesign; production email deliverability | Hosted SMTP (Resend, Rithika) for real volume | P1 |
| Session persistence / protected routes | COMPLETE | `proxy.ts` redirects signed-out users from workspace prefixes; harness: `/dashboard` → `/login`; boundary tests H1 | — | — | — |
| Sign-out | IMPLEMENTED, UNVERIFIED | POST `app/auth/signout/route.ts`; sidebar form now posts to `routes.signOut` | Browser click-through | — | P2 |
| Account page / creatorship offers | IMPLEMENTED, UNVERIFIED | `components/account/*`, `respondToCreatorTransfer`, `offerCreatorTransfer` tested at action + SQL level | Browser pass | — | P2 |
| Account deletion | BLOCKED (fail-closed by design) | `lib/actions/core/account.ts` fully fail-closed (D27); UI explains blockers | Decide D27 recovery store | D27 | P2 |
| Auth failure states | IMPLEMENTED, UNVERIFIED | login error copy, `app/(auth)/error.tsx`, callback error redirect | Browser pass | — | P3 |

### Dashboard and handovers
| Feature | Status | Evidence | What remains | Deps | Pri |
|---|---|---|---|---|---|
| Dashboard list, sections, empty/loading/error | IMPLEMENTED, UNVERIFIED (real route) | `app/(workspace)/dashboard/page.tsx`; preview verified in harness; render-determinism tests | Signed-in browser pass | Browser access | P1 |
| Create handover | COMPLETE (local) | action + SQL tests; R2 E2E; idempotent double-submit (`96_create_handover_dedupe.sql`) | Hosted needs migration 100200 for dedupe | Hosted apply | — |
| Edit draft title/team/role/description | IMPLEMENTED, UNVERIFIED in browser | `updateHandoverDetails`; `96_update_handover_details.sql`; autosave tests `r3-details-autosave` | Browser pass; hosted needs 100100/100400 | Hosted apply | P1 |
| Resume draft (`?draft=&step=`) | COMPLETE (local) | `r3-draft-resume.test.ts`; R2 browser | — | — | — |
| Discard draft (+ raw cleanup) | COMPLETE (local) | `deleteHandover` + `deleteHandoverRawObjects` (C6), SQL 97, action tests | Hosted needs 200200 | Hosted apply | — |
| Ownership / membership permissions | COMPLETE | it15 role matrix (~186 checks), it05/it06, r3-access tests | — | — | — |

### Wizard
| Feature | Status | Evidence | What remains | Deps | Pri |
|---|---|---|---|---|---|
| Details → Privacy & consent → Sources → Scope | IMPLEMENTED, UNVERIFIED (redesign) | `components/wizard/*`; preview steps 1–4 pass harness; R2 browser E2E on old UI | Signed-in browser run of the full wizard | Browser access, hosted apply | P1 |
| Upload: signed URL, confirm, checksum, kind check, reasons | COMPLETE (local) | storage tests, `r3-upload-rejection-reasons` (11 tests through the real action), SQL 97 | Hosted needs 200400 | Hosted apply | — |
| Interrupted-upload retry, duplicates | COMPLETE (local) | `96_create_source_upload_retry.sql`, action tests | Hosted needs 100300 | Hosted apply | — |
| Start processing / cancel | COMPLETE (local) | E2E Tier E; `start_processing` refuses empty job list (300400) | — | — | — |

### Source ingestion
| Feature | Status | Evidence | What remains | Deps | Pri |
|---|---|---|---|---|---|
| WhatsApp TXT (Android/iOS), ZIP | COMPLETE | 581 parser/privacy tests; multi-format fixture set; ZIP traversal/bomb/split refused | — | — | — |
| PDF (text layer), DOCX, Markdown | COMPLETE | parser tests + `round3-multiformat` fixtures (scanned PDF → `no_text_layer`) | OCR is out of scope | — | — |
| Validation, checksum, ownership of raw paths | COMPLETE | `isOwnedRawPath` bound to handover; integrity re-check under the job claim | — | — | — |
| Plain `.txt` vs chat export | IMPLEMENTED, UNVERIFIED | wizard row toggle (75e37cc) | Browser pass | — | P2 |

### Privacy and security
| Feature | Status | Evidence | What remains | Deps | Pri |
|---|---|---|---|---|---|
| Consent per source | COMPLETE | `recordSourceConsent`; provider must match consent at `start_processing` | — | — | — |
| Participant / conversation / date exclusions (chats) | COMPLETE | exclusions tests; it-level evidence checks | — | — | — |
| Exclusions inside PDF/DOCX/MD | NOT IMPLEMENTED (decision pending) | proposal `docs/proposals/exclusions-in-documents.md` | Approve option A, then ~4–6 days | Product decision | P2 |
| Credential masking (QA-L5 + R1–R6) | COMPLETE | mask tests; `r3-privacy-evidence` end to end | — | — | — |
| PII masking: phone/email/ids | COMPLETE | privacy tests | Addresses: decision pending (`address-masking.md`) | Product decision | P3 |
| Evidence provenance | COMPLETE | `provenance-r3.test.ts`, quote offset checks, it03 | — | — | — |
| Prompt-injection guard (PI-11, R1–R5) | COMPLETE (deterministic floor) | `injection-guard` tests, PI fixtures 11–24, QA probe | Live multilingual/paraphrase suite before any real provider | D11 | P1 (gates D11) |
| Unauthorized access / RLS | COMPLETE | it15/it05/it06/it09 privileges; boundary tests | — | — | — |
| Erasure / purge authorization (QA-L2) | COMPLETE (hardened; still fail-closed) | it16 hard; 96_qa_l2_actor_first | Enabling it needs D27 | D27 | — |
| DB fencing (DB-12/13, claim generation) | COMPLETE | SQL 98, it17, pipeline tests, Tier E | Heartbeat/complete still attempt-fenced (low risk) | — | P3 |
| Retention / orphan cleanup | PARTIAL | discard cleanup + orphan detection built; sweep not built | Approve the 6 choices, then build sweep | Product decision | P2 |
| Rate limits (Q5) | IMPLEMENTED, UNVERIFIED | `consume_rate_limit` used in `lib/db`; X-Forwarded-For trust (QA-L7) open | Production trust config | Deployment target | P2 |

### AI and processing pipeline
| Feature | Status | Evidence | What remains | Deps | Pri |
|---|---|---|---|---|---|
| Extraction of decisions, tasks, owners, deadlines, risks/blockers, contacts, access | COMPLETE with the fake adapter | `lib/ai` tests (238), E2E Tier E (12 sourced points in R2 browser run) | Real model quality is unknown | D11 | — |
| Conflict detection (`contradicts`) | COMPLETE (fake adapter) | `r3-conflict-fixture`, multi-source Tier E shows `conflicting` point | Real-model behaviour | D11 | — |
| Unanswered questions / gaps | COMPLETE | system gap questions, gap interview tests | — | — | — |
| Multi-source, retries, partial failure, recovery | COMPLETE (local) | Tier E multi-source 5/5, recovery tests, `partial` status (300700) | Hosted needs 300100–300800 | Hosted apply | — |
| Fake adapter dev/test only | COMPLETE | `r3-production-refusal` (11), drain route refusal | — | — | — |
| Real provider integration | BLOCKED | only `lib/ai/providers/fake.ts` exists | Provider choice, privacy/pricing review, live eval suite (≥20 scenarios) | D11, Rithika's research | P0 for launch, blocked |
| Dev drain loop | IMPLEMENTED, UNVERIFIED after E4 | unit-tested tick (timeouts/overlap) | One live dev run against migrated DB | Hosted apply or local stack | P2 |

### Review and approval
| Feature | Status | Evidence | What remains | Deps | Pri |
|---|---|---|---|---|---|
| Review list, filters, approve/reject/reopen, inferred confirm | IMPLEMENTED, UNVERIFIED (redesign) | `reviewPoint` action + SQL 40; preview harness; R2 browser on old UI | Signed-in browser pass | Browser access | P1 |
| Edit an extracted point | IMPLEMENTED, UNVERIFIED | `review-dialogs.tsx` uses `action: "edit"`; SQL + action tests | Browser pass | — | P1 |
| Resolve conflicts (resolution note) | IMPLEMENTED, UNVERIFIED | dialog requires `resolutionNote`; Tier E asserts it | Browser pass | — | P1 |
| Add a point the AI missed (`createManualPoint`) | IMPLEMENTED, UNVERIFIED in browser (built in `9f528b5`) | `components/review/add-point-dialog.tsx` + `manual-point.ts`; 15 tests check every category's fields against the contract schema; SQL/action layer already tested | Browser run on a live in-review handover; typed-in direct contacts intentionally not offered | Browser access, hosted apply | P1 |
| Gaps: create question, interview link, answers, review answer | IMPLEMENTED, UNVERIFIED (redesign) | gaps manager + `/g/[token]`; action/SQL tests; R2 browser | Browser pass | — | P1 |
| PI-11 guard notice | COMPLETE | reads `e.guarded` with rationale fallback (1e678b8); render tests | — | — | — |

### Publishing and recipients
| Feature | Status | Evidence | What remains | Deps | Pri |
|---|---|---|---|---|---|
| Publish, versioning, start revision | COMPLETE (local) | SQL 40/90, E2E Tier E; R2 browser published v1 | Browser pass on redesign | — | P1 |
| Invite member (link + magic-link email) | IMPLEMENTED, UNVERIFIED | `inviteMember` returns the URL; `lib/supabase/invites.ts` emails via OTP | Real delivery depends on SMTP | Resend/SMTP (Rithika) | P1 |
| Invite redemption, invalid/expired link states | IMPLEMENTED, UNVERIFIED | `/h/[token]` with `token_invalid` copy; SQL token tests | Browser run with a second account | Second account / SMTP | P1 |
| Incoming member's published view, acknowledgement | IMPLEMENTED, UNVERIFIED | preview verified; `acknowledgePublication` SQL tests; it15 B1 role checks | Signed-in run as incoming member | Second account | P1 |

### UI/UX (Round 3 redesign)
| Feature | Status | Evidence | What remains | Deps | Pri |
|---|---|---|---|---|---|
| Design system + every route redesigned | IMPLEMENTED; previews VERIFIED | `docs/design/design-system.md`, `route-verification.md`; harness PASS on previews + public routes | Fill route-verification screenshots for real routes | Browser access | P1 |
| Responsive 1440/1024/390 | VERIFIED on previews/public; UNVERIFIED on real routes | harness report (0 overflow) | Real routes | Browser access | P1 |
| Accessibility basics | VERIFIED on previews (focus, one h1) | harness keyboard check | Screen-reader pass | — | P2 |
| Dark mode | NOT IMPLEMENTED (out of scope) | tokens exist, no switch | — | — | P3 |

## 2. Migrations (18) — readiness recommendation

- Order and dependencies documented in `docs/round3/migrations.md` (#1–#18, kind, dependency, rollback with
  the old definition's file:line, a Verify query each, and a two-phase hosted runbook).
- Compatibility: 17 are additive or replace-same-signature (grants carried); #14–#15 only revoke grants.
  No table/column/policy/row is dropped. #9 (300200) and #17 (300800) add one column each (#17's
  `claim_generation` is `bigint not null default 0`, backfilled to `attempt`).
- Upgrade behaviour: the populated-database upgrade test applies all 18 in order and diffs every pre-upgrade
  read after each step (PG17 + PG15 PASS), then `verify.sql` exercises the new behaviour on old rows.
- Security: every new function is service_role-only or SECURITY INVOKER under RLS; verified by `verify.sql`
  grants checks, it09 privileges and the it15 role matrix.
- App/schema coupling: the runbook requires the Round 3 app/worker deploy between phase 1 (#1–#13) and
  phase 2 (#14–#18). Hard rule: worker ≥ `0bb1b96` before #17; reload the PostgREST schema after.
- **Recommendation: READY for application to the hosted *development* project**, following the runbook,
  after a backup/PITR marker. The deploy coupling is the real risk; on hosted *dev* a temporary mismatch
  only breaks processing, never data. Requires the user's explicit approval (not given).
- **Update 2026-11-13: APPLIED to the isolated hosted dev project baton-dev (`xnwppnzvrpthukxjfojj`)**, with
  the user's explicit approval for each phase. Phase A (#1–#13) first, then Phase D (#14–#18) at 16:54 UTC through
  `supabase/hosted-apply/run-hosted.sh r3phaseD` (pinned checksums, gates re-run, one locked transaction). Result:
  36 history rows, newest `20261113300900`, each Phase D version once; all **19/19** Verify rows `true`;
  `claim_generation = attempt` on all 30 jobs; no job in flight. The original project was not touched; no
  production project has these migrations. Record: `supabase/hosted-apply/README.md` → "Execution record".

## 3. Blockers (external)

1. ~~**Hosted dev migrations not applied**~~ — **resolved 2026-11-13**: all 18 Round 3 migrations are applied to
   baton-dev (see §2 update). Still open: a live processing run on baton-dev after Phase D (the claim-generation
   path is covered by the local rehearsal and `it17`, not yet by a hosted run).
2. **Browser access to signed-in routes** (Chrome extension disconnected) — blocks the real-route UI
   verification. Alternative: the user signs in once in the browser the harness can use, or a local
   Supabase stack with a test account (needs ~2 GB free RAM).
3. **D11 real AI provider** (provider choice, live injection/quality eval) — blocks launch, not local use.
4. **D27 recovery store** — keeps account deletion/erasure fail-closed.
5. **SMTP/Resend** (Rithika) — real invitation and sign-in email delivery.
6. **Product decisions** — retention (6 choices), address masking, exclusions in documents, outgoing-member
   cancel rights (QA-R3-04).

## 4. Verdict

Baton is a **feature-complete local prototype** of the brief: the entire journey (create → consent →
upload → process → review → gaps → publish → invite → incoming read) exists in code, and every step is
verified at the action/SQL/real-Postgres level. It is **not yet a verified usable product in its hosted
dev environment**, because (a) the schema it needs was not applied there (resolved 2026-11-13: all 18 Round 3
migrations are on baton-dev) and (b) the redesigned signed-in
UI has not been walked through in a browser. The one brief feature that lacked UI (manually adding a point) was built after this audit (`9f528b5`). Launch
additionally needs a real AI provider (D11) and email delivery.
