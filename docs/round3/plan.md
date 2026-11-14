# Baton Round 3 — backlog, ownership and integration plan

Lead: main coordinator (Opus 5.5, high). Baseline: `24320e1` (Round 2 local checkpoint). Plan commit: the
commit that adds this file on `integration/round3` (published to the local coordination repo).
**Local only:** no GitHub push, no master merge, no Vercel, no hosted migrations, no production AI, no
erasure/purge (D27), no external-service changes.

## 0. Isolation and safety guards (every worker, every turn)

- Work ONLY inside your clone: `C:\Users\manee\Documents\programing\baton-multiagent\<your-clone>`. Use
  absolute paths under it for every read, edit and command (`cd "<clone>" && …`). Never touch
  `C:\Users\manee\Documents\programing\baton` (the recovery copy) or another clone.
- Before every commit run, and abort on mismatch: `git -C "<clone>" rev-parse --show-toplevel` (must be
  your clone), `git -C "<clone>" branch --show-current` (must be your branch).
- Commit only files you own (§3). Exchange work only via `git push origin <your-branch>` to the LOCAL
  coordination repo (`origin` of every clone). Never force-push, rebase, reset, stash others' work or clean.
- No secrets: clones have no `.env.local`; never create one or copy secrets. Hosted Supabase is off-limits
  to workers. SQL runs only against local Docker Postgres (each worker uses its own container name).
- Resources: no `next dev` in worker clones (the lead runs the only dev server). Before `npm run build`,
  `npm run test:sql` or Docker E2E, the lead serialises heavy jobs: run at most ONE heavy job at a time and
  prefer targeted test files while iterating.
- Package files are lead-owned (D19): never `npm install <pkg>`; request dependencies from the lead.

## 1. Backlog (category · id · priority · owner)

Priorities: P0 blocks the Round 2 demo · P1 core quality · P2 important · P3 polish/deferred.

### A. UI/UX redesign and product experience — Agent 1 (highest product priority)
| ID | P | Item |
|---|---|---|
| A1 | P0 | UI/UX audit + design-system proposal (tokens, type, colour, spacing, components, states, responsive rules, page hierarchy) — **gate: lead review before large-scale redesign** |
| A2 | P0 | New handover wizard: obvious draft save/resume, clear progress, upload reliability states, consent clarity, editable details (uses B-interface `updateHandoverDetails`) |
| A3 | P1 | Dashboard + draft cards + recovery (continue/discard, last saved, next step) |
| A4 | P1 | Review workspace: readable evidence/quotes, unambiguous approve/reject, conflicts vs gaps clearly distinct |
| A5 | P1 | Processing experience (live progress, failure + retry states) |
| A6 | P1 | Published handover + incoming-member experience (genuinely useful to the recipient) |
| A7 | P2 | Gap interview (token page), gaps manager, conflict resolution UI |
| A8 | P2 | Homepage/marketing, login, settings, account |
| A9 | P2 | Responsive 1440 / 1024 / 390, accessibility (focus, labels, contrast, keyboard) |
| A10 | P3 | Micro-interactions/motion (reduced-motion respected) |

### B. Remaining functional and browser verification gaps — Agent 5 (+ lead browser runs)
| ID | P | Item |
|---|---|---|
| B1 | P0 | Incoming member's own authenticated view (second account) — plan + lead-run browser check |
| B2 | P1 | Conflict resolution with a real synthetic conflict (fixture that yields `contradicts`) |
| B3 | P1 | Mobile/tablet layouts (needs a non-maximised browser window) |
| B4 | P1 | Live failed-job recovery; multi-source processing; refresh at every stage |
| B5 | P1 | Production refusal of the fake adapter; unauthorised resource access |

### C. Backend and persistence — Agent 2
| ID | P | Item |
|---|---|---|
| C1 | P0 | Draft metadata edit: additive migration `update_handover_details` + `lib/db` wrapper + `updateHandoverDetails` action (contract already in `lib/contracts/schemas.ts`) |
| C2 | P1 | Duplicate-draft prevention review (wizard retry, double-click) and concurrent-autosave protection (optimistic `expectedUpdatedAt`) |
| C3 | P1 | Ownership/membership verification audit of every action path; typed errors for duplicate upload (`conflict` on `(handover_id, sha256)`) surfaced as a friendly message |
| C4 | P2 | Data-consistency review (dashboard queries N+1 for drafts; `listSources` per card) |

### D. Ingestion, storage and privacy — Agent 3
| ID | P | Item |
|---|---|---|
| D2 | P1 | Upload robustness: interrupted, duplicate, invalid, oversized, retry, ownership; raw deletion; evidence provenance |
| D3 | P1 | The 4 `pending_upload` rows (all on soft-deleted drafts): analysis only + orphan-upload **retention policy recommendation** (no deletion) |
| D4 | P2 | Synthetic fixtures for a real conflict scenario and a multi-format set (TXT, ZIP, PDF, DOCX, MD) |

### E. AI extraction, verification, processing reliability — Agent 4
| ID | P | Item |
|---|---|---|
| E0 | P0 | QA-L5: mask credentials with whitespace separators (`password Hunter2`, `pin 4821`, `otp 556677`, `login … / secret`) — over-mask; §12.1 contract text change proposed to lead (assigned to Agent 4 per the execution mandate) |
| E1 | P0 | DB-12 stale-worker fencing on persist/evidence/quote-check/gap writers (additive migration + `lib/db/pipeline.ts`) |
| E2 | P0 | DB-13 atomic point+evidence persistence per candidate/chunk |
| E3 | P1 | PI-11: verifier resistance — deterministic guard + live-suite readiness (no provider selection) |
| E4 | P1 | Retry/failure recovery, accurate terminal states, multi-source runs, dev drain loop robustness |

### F. Security and privacy hardening — Agent 5 (verify) + owners (fix)
| ID | P | Item |
|---|---|---|
| F1 | P0 | Track/verify QA-L5 (E0), DB-12 (E1), DB-13 (E2), PI-11 (E3) |
| F2 | P1 | QA-L2 (erasure/purge actor validation): **analysis + tests only**; D27 stays fail-closed |
| F3 | P2 | RLS + unauthorised-access regression suite for every new function |

### G. Production infrastructure and service readiness — lead (documentation this round)
| ID | P | Item |
|---|---|---|
| G1 | P2 | Production-readiness checklist (env, cron for drain, retention sweep, monitoring hooks, X-Forwarded-For trust QA-L7) |
| G2 | P3 | Deployment remains disabled; document Vercel cron + env requirements only |

### H. Rithika-owned external dependencies (tracked, not duplicated)
Resend SMTP + auth emails · domain verification · AI provider comparison · ≥20-scenario synthetic eval set ·
provider privacy/pricing/rate limits · Supabase production readiness · backup/recovery research ·
monitoring/observability requirements.

### I. Deferred architectural decisions (owner: product)
D11 provider/model/retention · D27 recovery store · Q1 opaque participant refs (R9 proposal) · Q5 rate
limits (design exists) · orphan-upload retention policy (D3) · draft-metadata editing scope (C1) ·
deployment target.

## 2. Dependency map

```
A1 (design system + tokens, milestone 1) ──quick lead review──▶ A2..A10
C1 (action updateHandoverDetails) ──▶ A2 (editable details)
D4 (conflict fixture) ──▶ B2 (QA conflict test) ; E1/E2 ──▶ B4
E0, E1, E2, E3 ──▶ F1 (QA verification)
All worker branches ──▶ lead integration (one at a time) ──▶ QA final pass ──▶ lead browser runs (B1, B3)
```

## 3. File ownership registry (exclusive; anything unlisted is LEAD)

| Owner | Paths |
|---|---|
| **Agent 1 UI/UX** | `app/(marketing)/**`, `app/(auth)/login/page.tsx` + `login-form.tsx` (presentation only), `app/(workspace)/**`, `app/(token)/**`, `app/layout.tsx`, `app/not-found.tsx`, `app/globals.css`, `components/**` (incl. `components/wizard/**`), `config/navigation.ts`, `config/site.ts`, `config/status.ts`, `hooks/**`, `lib/fonts.ts`, `lib/utils.ts`, `docs/design/**` |
| **Agent 2 Backend** | `lib/actions/**`, `lib/data/**`, `lib/db/{actor,actor-rules,client,errors,index,mappers,mutations,queries,rate-limit,rpc,tokens}.ts`, `lib/db/__tests__/**` (except storage/pipeline tests), migrations `supabase/migrations/2026111310*.sql`, SQL tests `supabase/tests/sql/96_*.sql` |
| **Agent 3 Ingestion/privacy** | `lib/parsers/**`, `lib/privacy/**` except `mask.ts` and its tests, `lib/db/storage.ts`, `lib/db/__tests__/storage*.test.ts`, `fixtures/parser/**`, `fixtures/demo/**`, migrations `2026111320*.sql`, SQL tests `97_*.sql`, `docs/proposals/retention.md` |
| **Agent 4 AI/pipeline** | `lib/privacy/mask.ts`, `lib/privacy/__tests__/{mask,security-regressions}.test.ts` (QA-L5), `lib/ai/**`, `lib/pipeline/**`, `fixtures/ai/**`, `lib/db/pipeline.ts`, `lib/db/__tests__/pipeline*.test.ts`, `instrumentation.ts`, `app/api/pipeline/**`, migrations `2026111330*.sql`, SQL tests `98_*.sql` |
| **Agent 5 QA/security** | `tests/**`, `docs/qa/**`; may READ everything; never edits implementation files — reports defects to the lead |
| **Lead** | `lib/contracts/**`, `docs/**` (except the above), `package.json`/`package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `proxy.ts`, `lib/supabase/**`, `app/auth/**`, `app/api/**` (except pipeline), `lib/routes.ts`, `lib/mocks/**`, `supabase/config.toml`, `supabase/tests/run.sh`, `supabase/tests/shim/**`, existing `supabase/tests/sql/{10..95}_*.sql`, `.env.example`, `README.md` |

Cross-owner changes go through the lead as a written request (file, change, reason). Workers add NEW
migration/SQL-test files only in their numeric range; existing migrations are never edited.

## 4. Interfaces agreed before parallel work

- **C1 → A2:** `lib/actions/handovers.ts` exports
  `updateHandoverDetails(input: UpdateHandoverDetailsInput): Promise<Result<HandoverSummary>>`
  (`lib/contracts/schemas.ts#updateHandoverDetailsInput`). Masks free text like `createHandover`. Errors:
  `validation_failed`, `unauthenticated`, `not_found` (not visible), `forbidden` (not creator/outgoing),
  `invalid_transition` (not draft), `conflict` (stale `expectedUpdatedAt`). UI autosaves with debounce and
  sends the last seen `updatedAt`; on `conflict` it reloads the draft and tells the user.
- **E1/E2 → nothing in UI:** function signatures in `lib/db/pipeline.ts` may change; only `lib/pipeline`
  consumes them.
- **E0 → contracts:** masking stays `maskText` / `createMasker` with the same signatures; only detection
  widens. Agent 4 sends the §12.1 text change to the lead.
- **D4 → B2:** conflict fixture path `fixtures/demo/round3-conflict-chat.txt` (+ expected outcome note).
- **A1 → lead:** `docs/design/design-system.md` (+ token diff of `app/globals.css`) before the redesign.

## 5. Acceptance criteria

- **Agent 1:** design-system doc approved by the lead; every route redesigned with shared tokens/components
  (no one-off styles); wizard shows saved state, resume path and per-file upload states; review makes
  approve/reject/conflict/gap unambiguous; published view useful to a recipient; responsive at 1440/1024/390
  (structure verified by layout review; live screenshots by the lead); a11y basics; `tsc`, lint, `test:ui`,
  build pass; no change to data contracts.
- **Agent 2:** C1 migration additive + SQL tests (owner-only, draft-only, stale token → conflict, RLS) on
  Docker PG 17 and 15; action tests (masking, D35 order, conflict); no hosted apply; full `npm test` green.
- **Agent 3:** no regression in parser/privacy tests; participant exclusions verified;
  upload-robustness tests; retention proposal; conflict + multi-format fixtures; no hosted deletion.
- **Agent 4:** QA-L5 fixed with tests for every listed form (over-mask, no regressions); DB-12 fencing (stale run/attempt writers refused) + DB-13 atomicity with SQL tests and
  pipeline tests; PI-11 deterministic guard + documented live-suite gate; no provider enabled; full suites green.
- **Agent 5:** independent review of each worker branch (findings with severity, file:line); new tests for
  B1–B5 and F1–F3 (automated where possible; browser steps written as a script the lead runs);
  QA-L5/DB-12/DB-13/PI-11 verified or reopened; D27 fail-closed re-verified.

## 6. Integration protocol (lead)

1. Workers push their branch to the local coordination repo when a milestone is complete and report.
2. Lead fetches, inspects the full diff, checks ownership (no file outside the owner's registry), runs the
   owner's targeted tests, then cherry-picks/merges ONE worker at a time into `integration/round3`.
3. Conflicts are resolved by the lead only. After each integration: targeted suites; after all: full
   `npm test`, SQL (PG 17 + 15), Tier P, real-Postgres E2E, `tsc`, lint, build; then one dev server for
   browser checks.
4. Nothing is pushed beyond the local coordination repo; master is never touched.
