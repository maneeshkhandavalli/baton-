# Round 3 QA findings and branch reviews (Agent 5)

Severity: **P0** blocks the demo · **P1** must fix before the gated capability is enabled / core quality ·
**P2** important · **P3** polish or defence in depth. "Gated" = the code path is unreachable today (D11/D27).
Every open item has an automated check that reports it without turning the suite red: SQL `TODO(open <id>)`
lines from `bash tests/integration/db/run.sh`, or Node `# open <id>` TODO tests. When a fix lands they print
`NOW HOLDS` and must be turned into hard assertions.

## Status of tracked items (F1, F2)

| ID | Sev | Owner | Status | Evidence |
|---|---|---|---|---|
| QA-L5 | P1 | Agent 4 | **VERIFIED FIXED** on `integration/round3` (`25b34b1`). All 12 plan forms masked, including through parse → persisted body → evidence quote. Residuals below (QA-L5-R1…R6). | `tests/integration/r3-privacy-evidence.test.ts` (hard), `lib/privacy/__tests__/mask.test.ts` |
| DB-12 | P1 (gated: production AI) | Agent 4 | **VERIFIED for the worker** — fenced twins `pipeline_*` (`20261113300100_pipeline_fencing.sql`) refuse stale attempts, cancelled runs, wrong stage and cross-handover targets (hard, it17); the worker calls only them since ab96beb (DB-12-TS hard). **Residual DB-12-LEGACY (open):** the 9 legacy writers stay granted to `service_role` (7 reproductions kept as TODO until Agent 4 revokes them) | `it17_db12_db13_fencing.sql`, `tests/integration/r3-pipeline-fencing-wiring.test.ts` |
| DB-13 | P2 (gated: production AI) | Agent 4 | **VERIFIED** — `pipeline_store_extract_chunk` (no evidence-less point, partial citations kept, idempotent repeat, foreign point refused; hard in it17) is what extraction calls since ab96beb (DB-13-TS hard) | same |
| PI-11 | — (gated: D11) | Agent 4 | **NOT LANDED** — no commit on `feature/r3-ai-pipeline` yet | to verify when pushed |
| QA-L2 | P1 (gated: D27) | lead (migration) | **OPEN** — analysis + 7 reproductions under a simulated grant | `tests/integration/db/sql/it16_qa_l2_d27.sql` |
| D27 | — | — | **RE-VERIFIED fail-closed**: no API role (nor PUBLIC) can execute any function that turns on the erasure/purge flag or hard-deletes handovers (structural scan, so a new function cannot slip in); TS gate refuses every receipt before any DB call | `it16` parts A/C, `it09_privileges.sql`, `it09-d27-gate.test.ts` |

### DB-12 reproductions (stale worker writes) — Agent 4 (E1)
Setup: extract job claimed (attempt 1), lease expired, re-claimed as attempt 2; then run 1 cancelled, run 2 active.

| # | Writer | Where | What a stale worker can do today |
|---|---|---|---|
| 1 | `insert_extracted_point` | `supabase/migrations/20261111000500_review_gaps_pipeline.sql:808` | attempt 1 inserts a point while attempt 2 owns the job (fenced to the run only, not the claim) |
| 2 | `add_source_quote_evidence` | `20261112000100_integration_worker_support.sql:460` | attempt 1 attaches evidence; **and** run 1's worker attaches evidence while run 2 is active (`_require_active_run` without a run id) |
| 3 | `record_quote_check` | `20261112000100_integration_worker_support.sql:429` | attempt 1 overwrites a quote check |
| 4 | `create_system_gap_question` | `20261111000500_review_gaps_pipeline.sql:435` | attempt 1 creates a gap question |
| 5 | `record_support_verdict` | `20261111000500_review_gaps_pipeline.sql:914` | run 1's worker writes a verdict during run 2; **and** a late worker writes a verdict with NO run active (state `in_review`) — it has no run check at all |

Expected fix: every writer takes the claim (job id + attempt, or run id at minimum) and refuses a superseded
claim with `conflict`, like `complete_processing_job` already does (DB-2). Controls that already hold
(hard in it17): stale `complete_processing_job` → BTCF0, stale heartbeat → `lost`, run-scoped
`insert_extracted_point`/`set_point_sort_keys` refuse a cancelled run id.

### DB-13 — Agent 4 (E2)
`lib/pipeline/stages/extract.ts:90` (`insertExtractedPoint`) and `:108` (`addSourceQuoteEvidence`) are
separate RPCs/transactions; a crash or a refusal between them leaves an evidence-less extracted point
(reproduced in it17). The check flips when a writer inserts a point and its evidence link in one function,
or `insert_extracted_point` refuses to create a point without evidence. QA will then add a hard test that a
failing citation rolls the point back.

### QA-L2 analysis (F2) — lead-owned migrations; fix before D27 grants anything
`erase_participant` (`20261111000700_privacy.sql:550`) and `purge_handover` (`20261111000800_account_purge.sql:171`)
compare the actor id with `handovers.created_by` but never call `public._require_actor`. Simulating the
future reviewed grant to `service_role` in a throw-away database (it16 part B):

| # | Case | Today | Expected |
|---|---|---|---|
| a | session for `rev` names the creator as actor → erase | erases (3 messages deleted) | BTFB0 (actor ≠ session subject) |
| b | known erasure id replayed by a non-member | answers `alreadyApplied: true` — the idempotency branch (`:596`) runs BEFORE the actor check (`:603`) | BTFB0/BTNF0 before any read |
| c | deleted creator account erases | erases | BTUA0 |
| d | mistaken grant to `authenticated` → browser erases directly | erases | refused inside the function (defence in depth) |
| e | session mismatch → purge | purges | BTFB0 |
| f | deleted creator purges | purges | BTUA0 |
| g | actor-less retention path (`p_actor_profile_id` null) called by a USER session for a due handover it is not a member of | purges | only the sweep caller (no JWT subject / dedicated role) |

Holds today (hard): a reviewer or non-member actor is refused (BTFB0); the actor-less path refuses a live
handover (BTPF0). Fix: call `_require_actor` first in both (except the restore-role replay), move idempotency
after it, and restrict the actor-less purge to callers without a JWT subject.

## New findings (this round)

| ID | Sev | Owner | Where | Finding | Repro |
|---|---|---|---|---|---|
| QA-L5-R1 | P2 | Agent 4 | `lib/privacy/mask.ts` credential keywords (`:373`–`:540`) | Card security codes are not credentials: `cvv 123`, `CVV: 456` survive | `r3-privacy-evidence.test.ts` residual R1 |
| QA-L5-R2 | P2 | Agent 4 | `mask.ts:427` `FILLER` | `pin no: 4821` (common Indian phrasing) survives: the filler is not followed by an explicit separator | residual R2 |
| QA-L5-R3 | P3 | Agent 4 | `mask.ts` keyword lists | `pass code 4821` survives (`pass` weak + `code`) | residual R3 |
| QA-L5-R4 | P3 | Agent 4 | `mask.ts:424` `QUALIFIER` | `the pin for the locker 4821`: the qualifier is honoured only before an explicit separator | residual R4 |
| QA-L5-R5 | P3 | Agent 4 | `mask.ts` `VALUE` (one token) | spaced values leak their tail: `OTP 556 677` → `[PASSWORD] 677`; `password Hunter 2` → `[PASSWORD] 2` | residual R5 |
| QA-L5-R6 | P3 | Agent 4 | `mask.ts` `VALUE` | multi-word passphrase after `password:` keeps all but the first word (pre-existing) | residual R6 |
| QA-R3-01 | P3 — **FIXED** (48b2126: empty job list → BTVF0; hard in it18) | lead / Agent 2 | `20261111000400_lifecycle.sql:507` + `lib/pipeline/finish.ts:37` | `start_processing` accepts `p_jobs = []`; such a run is nominated by `list_finishable_runs` on every drain but `decideRunOutcome([])` always waits, so the handover stays `processing` until the creator cancels. Unreachable from the UI (the planner always adds 3 per-handover stages): defence in depth. | `it18_recovery.sql` (QA-R3-01) |
| QA-R3-03 | P2 → P3 (mitigated on `feature/r3-uiux` d99fc1d: Scope step now says "People you leave out are saved when you continue"; a refresh still drops unsaved ticks) | Agent 1 | `components/wizard/draft-state.ts:24-27`, `new-handover-wizard.tsx:424` | Privacy-relevant UX: participants/conversations ticked off on the Scope step are kept only in memory until "Start processing"; a refresh (or a second tab) silently drops them, and the preview again shows the person as included. Persist on tick (addExclusion) or warn before unload / show "not saved". | `r3-draft-resume.test.ts` (documents current behaviour); browser BS-01 step 7 |
| QA-R3-04 | P3 | lead (product) | `20261111000400_lifecycle.sql:581` | An outgoing member (not the creator) may start/retry processing but cannot cancel it; §8.2 is silent on cancel. | `it15` matrix (cancel_processing creator-only), `it18` |
| QA-R3-05 | P2 — **FIXED** (C5 4c02b02, integrated; hard in it15): create_source reuses the actor's own stale `pending_upload` row (no object) or retires it (object present). Reviewed: same-actor only, storage policy still binds the uploader, advisory lock per (handover, sha256). | Agent 2 + Agent 3 | `feature/r3-ingestion:lib/db/storage.ts:12`; `create_source` (`20261111000600_sources_members_tokens.sql:23`) unchanged | Coordination gap: Agent 3's storage.ts says "reusing a stale `pending_upload` row … is done by create_source itself (Agent 2)", but no Round 3 migration changes `create_source`. Re-adding a file whose upload was interrupted returns `duplicate_source` until the user removes the stale row (the message says so). Decide: reuse the stale row in SQL, or keep the message and fix the comment. | browser BS-02 steps 4–5 |
| QA-R3-06 | P3 — **FIXED** (6b0feaf, integrated): raw paths are bound to the source's handover and id; it11 now builds rows whose path and handover agree | Agent 3 | `feature/r3-ingestion:lib/db/storage.ts:134` | `isOwnedRawPath` accepts any `raw/<a>/<b>` when either id is not a UUID, and never binds the handover segment to the source's handover. The DB row is authoritative, so this is belt-and-braces only; bind both segments. | review |
| QA-R3-07 | P3 | Agent 2 | `20261113100100_update_handover_details.sql:82` | Optimistic token compared at millisecond precision: two saves landing in the same millisecond as the previous write would both pass. Negligible in practice; documented. | review |
| QA-R3-08 | P3 | Agent 1 | `new-handover-wizard.tsx:137,153` | Consent ticks are remembered only once a source has consent recorded; refreshing on Sources before the first upload sends the user back to re-tick consent. Fine for privacy, surprising for "obvious draft resume" (A2). | `r3-draft-resume.test.ts`; BS-01 step 5 |
| QA-R3-10 | P3 | Agent 4 | `lib/db/pipeline.ts:37` | Dead code: a wrapper for the legacy `claim_processing_jobs` (revoked from every role by QA-N1) is still exported; remove it with the DB-12 wiring. | review |
| QA-R3-09 | P3 | Agent 4 | `lib/pipeline/stages/verify-support.ts:60,79` | Observation: verify_support reads its first page of links before resolving the provider (lazy prelude). No call or write happens; the run still fails closed when links exist. | `r3-production-refusal.test.ts` |

## Tier E (real Postgres) — `tests/integration/r3-e2e-multisource.test.ts`

5/5 PASS (`BATON_IT_PG=1`, PG 17, ~56 s): one run over three sources — the conflict pair plus a broken
"WhatsApp export". The broken source fails alone (`parser:unsupported_format`, raw kept, downstream jobs
cancelled `upstream_failed`), the other two parse/extract/verify, the run succeeds, handover `in_review`, no
PII or file text persisted. The banking owner point is `conflicting` with one `supports` and one
`contradicts` link (one per source); plain approve is refused, approve with a resolution note succeeds.
B2 and B4 are therefore verified end to end below the UI.

## Browser runs

BS-01…08 (`docs/qa/browser-scripts.md`): **not run yet** — the Claude in Chrome extension was not connected
(2026-11-12; same for the lead). Resume when it is reconnected; results go here.

## Branch reviews

### `feature/r3-backend` (Agent 2) — integrated as `7708e52`, `2c1f918`, `2037776` (+ lead `014b41b`)
- **C1 `update_handover_details`**: server-only grant, `_require_actor` first, not_found before forbidden before
  state (§8.5 order holds — added to IT-05 `hidden_like_missing` and to the it15 role matrix: creator +
  outgoing pass the gate, reviewer/lead/incoming refused, non-member BTNF0). Action masks every free-text field
  with one masker and re-validates (D35 order). Audit stores field names only. OK. Note QA-R3-07.
- **C2 idempotent `create_handover`**: reuse limited to the same actor's untouched draft (< 2 min, no source,
  member or token), serialised by a per-actor advisory lock; no cross-user path. OK.
- **C3 `duplicate_source`**: only the non-retryable `conflict` from `create_source` is mapped; message is
  content-free. OK. See QA-R3-05.
- QA additions requested by Agent 2: done (`cb97ff8`): `updateHandoverDetails` in the D35 ACTIONS map,
  `update_handover_details` in WRITE_RPCS, IT-05 case. Full `npm test` green after the merge.

### `feature/r3-ai-pipeline` (Agent 4) — QA-L5 integrated as `25b34b1`
- Reviewed the credential detector rewrite (`lib/privacy/mask.ts`): strong/weak keyword split, prose-word
  stoplist, login pairs, short-token detector. No regression in parsers/privacy (472/472) or in my evidence
  chain test; over-masking of ordinary prose stays bounded ("pin the message", "password manager", "the token
  expired", "Key: Ravi holds the safe" untouched). Residuals QA-L5-R1…R6 above.
- DB-12 / DB-13 / PI-11: nothing pushed yet.

### `feature/r3-ingestion` (Agent 3) — `32edad0`, `3350293`, `eccee43`, `0f3fbd1` (not yet integrated)
- Test-merged into a temporary local branch on top of `integration/round3` + this branch: `npm test` all green
  (contracts 104, db 160, parsers 566, ui 74, ai 166, actions 144, pipeline 95, integration 264 + 6 todo);
  Tier P SQL 10/10 PASS with `20261113200100_upload_retention_support.sql` applied (D27 structural scan and the
  privilege allow-lists still hold: `list_orphan_upload_candidates` is service_role-only, read-only).
- Parser hardening (PDF header in text kinds, unsafe ZIP entry names, nested archives, ymd/same-day date
  contradiction, data-descriptor ZIPs) looks correct; ZIP entry names are never used as paths.
- `createSourceUpload` now rolls back the row when signing fails and confirm is idempotent; OK. QA-R3-05, QA-R3-06.

### `feature/r3-uiux` (Agent 1) — integrated batch `e2d338d`…`027de93` (code review)
- **Data calls unchanged.** Every route's server-side guards and reads are identical before/after
  (`await connection()`, `notFound()`, `redirect(...)`, `getQueries()` reads, `viewerIsCreator`/`viewerRole`
  checks) for login, demo, marketing, token pages, dashboard, handover layout, new-handover loader, error
  boundaries. Action usage across `components/**` and `app/**` is unchanged except the new
  `updateHandoverDetails` (C1). No `dangerouslySetInnerHTML`/`innerHTML`; mask tokens are rendered by
  `MaskedText` as text. Published/review/processing components never reference identity hashes, clearances or
  profile ids.
- **Draft resume intact.** The wizard still clamps `initial.step` and caps the shown step with `maxStepFor`
  (`new-handover-wizard.tsx:165,652-653`); the stepper can request any step but `shownStep` stays capped;
  `r3-draft-resume.test.ts` still matches the composition.
- **Conflict/approve intact.** `components/review/review-dialogs.tsx` sends `confirmInferred` for inferred,
  `resolutionNote` (required, trimmed) for conflicting, `asKnownGap` for missing, and a separate
  `resolve_conflict` action — the same inputs the Tier E test proves against the database.
- **Details autosave (A2 × C1)** is now tested end to end: `r3-details-autosave.test.ts` (7 tests) drives the
  wizard's `detailsInput`/`classifySaveError` through the real `updateHandoverDetails`: masked text, unknown
  description never sent, stale → reload, not-draft → processing page, not_found/forbidden content-free.
- **QA-R3-11 (P3, Agent 1)** `components/review/point-card.tsx:93`: an `<h3>` inside a `<button>` (heading
  is not phrasing content; screen readers flatten it, so the heading outline of the review list is lost).
  Put the button inside the heading (or use `aria-labelledby` on a non-button wrapper).
- A heuristic scan for icon-only buttons without accessible names and `<img>` without `alt` found nothing
  real (6 hits, all buttons whose text is in an expression).
- `test:ui` 95/95, integration 275 pass + 6 todo, tsc clean (apart from Next typegen types).
