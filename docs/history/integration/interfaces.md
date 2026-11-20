# Integration interface agreements (overnight sprint, 2026-11-12)

Lead-owned. These are the **only** cross-worker interfaces. A worker that needs a change asks the lead;
nobody invents a parallel interface. Canonical sources win over this file: `lib/contracts/**` and
`docs/architecture/shared-contracts.md` (cited as §). Base: `feature/main-integration` @ `1f2b635`
(adds `extractionCandidateSchema`, `extractionResponseSchema`, `supportVerdictResponseSchema`).

## Ownership (exclusive; nobody else edits these paths)

| Owner | Paths |
|---|---|
| lead | `app/**` (incl. `app/api/**` worker and cron routes), `hooks/**`, UI import rewiring in `components/**` and `config/**`, `lib/routes.ts`, `lib/contracts/**`, **`lib/db/**` and `supabase/**` additive DB requests**, `.env.example`, `package.json`, `docs/**` |
| backend | `lib/data/**`, `lib/actions/**` and their tests |
| ai-engine | `lib/ai/**`, `fixtures/ai/**` (prompt-injection suite, §11.8 rule 7) and their tests |
| pipeline | `lib/pipeline/**` and its tests |
| qa-security | read-only; later `tests/integration/**` after lead approval of the test plan |

Frozen for everyone unless the lead lands it: `lib/parsers/**`, `lib/privacy/**`, `lib/supabase/**`,
`proxy.ts`, `app/auth/**`, `app/(auth)/**`, `lib/mocks/**` (kept for `/demo`).
Package files are lead-only (D19). Workers may run plain `npm ci`, never `npm install <pkg>`.

**DB requests.** `lib/db` has no worker-side *read* functions and no actor-checked raw-preview path.
Workers never write SQL. They send the lead a request: function name, arguments, return shape,
`SECURITY DEFINER`/`INVOKER`, grant (`service_role` or `authenticated`), and which § it implements.
The lead lands it as an **additive** migration + `lib/db` wrapper + SQL test on
`feature/main-integration`; the worker then runs `git merge feature/main-integration` (no rebase).

## I1 — `lib/ai` (ai-engine)

All server-only (`import "server-only"`) except `quote-check.ts`, which is pure.

```ts
// lib/ai/provider.ts — §11.8 verbatim: AiProvenance, AiRunConfig, AiAttemptRecord,
// ExtractRequest, VerifySupportRequest, AiCallResult, AiProvider.

// lib/ai/config.ts — the only reader of AI_PROVIDER, AI_API_KEY, AI_MODEL_EXTRACT, AI_MODEL_VERIFY.
export type AiConfiguration =
  | { ok: true; mode: "production" | "fake"; provider: { id: string; displayName: string }; runConfig: AiRunConfig }
  | { ok: false; reason: "provider_not_configured" };
export function getAiConfiguration(env?: Record<string, string | undefined>): AiConfiguration;
/** precondition_failed, details.reason = "provider_not_configured", retryable false. */
export function getAiProvider(env?: Record<string, string | undefined>): Result<AiProvider>;

// lib/ai/quote-check.ts — §10.7, deterministic, no AI. Single implementation for the whole app.
export function normalizeForQuoteMatch(s: string): string;
export function checkQuote(body: string, quote: string):
  { check: "exact" | "normalized" | "not_found"; start: number | null; end: number | null }; // body coordinates

// lib/ai/extract.ts
export interface CheckedCitation extends ExtractionCitation {
  quoteCheck: "exact" | "normalized" | "not_found"; quoteStart: number | null; quoteEnd: number | null;
}
export interface CheckedCandidate extends Omit<ExtractionCandidate, "citations"> { citations: CheckedCitation[] }
export interface ExtractOutcome {
  candidates: CheckedCandidate[];
  dropped: Record<string, number>;   // counts by reason code only, never content
  provenance: AiProvenance;
  attempt: AiAttemptRecord;
}
export function extractCandidates(provider: AiProvider, req: ExtractRequest, opts?: { signal?: AbortSignal }): Promise<Result<ExtractOutcome>>;

// lib/ai/verify-support.ts — independent call; never sees stance or extractor reasoning (§11.8 rule 1)
export interface SupportOutcome {
  verdict: Exclude<SupportVerdict, "unchecked">; rationale: string; provenance: AiProvenance; attempt: AiAttemptRecord;
}
export function verifySupport(provider: AiProvider, req: VerifySupportRequest, opts?: { signal?: AbortSignal }): Promise<Result<SupportOutcome>>;

// lib/ai/providers/fake.ts — deterministic test double (§11.8 rule 7)
export function createFakeProvider(script?: FakeProviderScript): AiProvider; // id "fake"
```

Agreed rules:
- **D11 open.** No real adapter. `AI_PROVIDER` unset or any value other than `fake` →
  `provider_not_configured`. `fake` is accepted only when `NODE_ENV` is exactly `development` or `test` (QA-L3) **and**
  `BATON_ALLOW_FAKE_AI=1`; its `displayName` must say it is a test adapter, and `mode: "fake"` is
  carried into `AiRunConfig.provider = "fake"` so provenance can never pass for real extraction.
- Extraction drops: a citation whose `messageId` was not in the request; a candidate failing
  `extractionCandidateSchema`; a candidate left with **no `exact`/`normalized` citation and no
  `inferenceRationale`** (fabricated). Surviving candidates keep their `not_found` citations, which
  pipeline stores for audit (§10.7.3); they never count towards status (§4.2).
- Malformed envelope or provider failure → `Result` error, `retryable: true` for transient cases.
  Error codes come from `ERROR_CODES` only; no new codes.
- Never log prompts, message text, model output, credentials or raw provider error bodies.

## I2 — `lib/pipeline` (pipeline)

```ts
// lib/pipeline/plan.ts — pure
export const PIPELINE_VERSION: string;
export interface PlannedJob { stage: PipelineStage; sourceId: string | null; inputHashHex: string }
export function planProcessingRun(input: {
  handoverId: string;
  sources: ReadonlyArray<Pick<SourceSummary, "id" | "state"> & { rawAvailable: boolean }>;
  aiConfig: AiRunConfig;
}): Result<{ pipelineVersion: string; aiConfig: AiRunConfig; jobs: PlannedJob[] }>;

// lib/pipeline/worker.ts — server-only
export interface DrainReport { claimed: number; succeeded: number; retried: number; failed: number; deferred: number }
export function drainJobs(opts?: { maxJobs?: number; deadlineMs?: number }): Promise<DrainReport>;
/** Fire-and-forget after a response (next/server `after()`); never awaited by actions. */
export function scheduleDrain(): void;

// lib/pipeline/pepper.ts — server-only. D27/D30: verify IDENTITY_PEPPER against IDENTITY_PEPPER_CANARY
// with lib/privacy/identity helpers; version must be "p1". Fails closed: no verified pepper → no parse.
export function getVerifiedPepper(): Result<{ pepper: string; version: "p1" }>;
```

Agreed rules: the workflow and order are §10 (parse → extract → verify_quotes → verify_support →
analyze → prepare_review). `start_processing` enqueues all jobs at once and `claim_processing_jobs`
has no stage dependencies, so pipeline enforces ordering itself and must not burn `max_attempts` on
deferral (send a DB request if needed). Exclusions and masking happen inside `parseSource` before
anything is persisted. Nothing auto-approves or publishes. Raw bytes are deleted only after
`persistParsedSource` commits (D14). Logs carry ids and counts only.

## I3 — `lib/data` and `lib/actions` (backend)

```ts
// lib/data/index.ts — server-only
export function getQueries(): BatonQueries; // the real lib/db implementation (§11.1 switch)

// lib/actions/{handovers,sources,review,gaps,members,privacy,account}.ts — "use server"
// Exactly the §11.3 signatures, with export names identical to lib/mocks/actions.ts, so UI rewiring
// is an import-path change only.
```

Agreed rules (D35): Zod-parse input → `requireVerifiedActor()` (null → `unauthenticated`) → `lib/db`
mutation with `serverDb()` → DTO re-read through the user-scoped `dbQueries` (RLS) → `toAppError`.
Actor, role, creator and membership never come from the browser. `startProcessing` = `listSources`
+ `getAiConfiguration()` (I1) + `planProcessingRun` (I2) + `lib/db.startProcessing` + `scheduleDrain()`.
`recordSourceConsent` records the configured provider id and fails `precondition_failed` when it is
`provider_not_configured`. `eraseParticipant` and the purge part of `deleteAccount` stay fail-closed
behind `lib/db/recovery-gate` (D27): never register a receipt verifier, never fake a receipt.

## Sequencing

1. ai-engine pushes `provider.ts`, `config.ts`, `quote-check.ts`, `providers/fake.ts` first; lead
   reviews and merges into `feature/main-integration`.
2. backend and pipeline merge `feature/main-integration` before importing `lib/ai`.
3. pipeline pushes `plan.ts` + `worker.ts` signatures early; backend wires `startProcessing` after
   lead merges them.
4. lead lands DB requests, wires `app/**`, `components/**` imports and `app/api/pipeline/drain`.

---

# W0 decisions (lead, 2026-11-12) — these amend I1–I3 above

Base for implementation: `feature/main-integration` @ `7257fae` (adds L5 DB support and AI output caps).
Every worker runs `git merge feature/main-integration` (no rebase) before implementing.

## Cross-cutting
- **Offsets** (`quote_start`/`quote_end`, `checkQuote`) are JavaScript UTF-16 code-unit indices into the
  persisted masked `body`.
- **Reason tokens.** Job, run and handover `error_message` values are tokens matching `^[a-z0-9_:]{1,64}$`
  (enforced by `complete_processing_job`); `finish_processing_run` gets the same tokens (QA-L8).
- **No unmasked model text is persisted** (QA-M6): see I1.
- **Deferred DB items** (documented gaps, not built tonight): DB-12 run fencing on persist/evidence/gap
  writers; DB-13 atomic per-chunk extraction insert; QA-L2/L3/L4/L7.

## I1 amendments (ai-engine)
1. Result-compatible failure branch that still carries records: `{ ok: false; error: AppError; attempt?: AiAttemptRecord; provenance?: AiProvenance }`.
2. `opts: { signal?: AbortSignal; attempt: number; runConfig: AiRunConfig }` on `extractCandidates` and `verifySupport`.
3. Add `getAiProviderForRun(runConfig, env?) → Result<AiProvider>`: `provider_not_configured`, or
   `precondition_failed` with `details.reason = "ai_config_changed"` when the live configuration differs from
   the run snapshot. Guarantee `runConfig.provider === provider.id`.
4. Drop reasons (closed union): `schema_invalid`, `unknown_message` (citation), `all_citations_foreign`
   (candidate dropped even with a rationale, §10.6), `category_not_requested`, `contradictory_citations`,
   `fabricated` (no exact/normalized citation and no rationale), `unmasked_content`, `over_budget`; duplicate
   citations are de-duplicated. A candidate whose only verified citations are `contradicts` is **kept**.
5. **Unmasked model output (QA-M6):** if `maskText` would change any model string (title, statement, string
   attributes, inferenceRationale), drop the candidate (`unmasked_content`); a `not_found` quote that would
   change is dropped as a citation. A support rationale that would change becomes `null`
   (`SupportOutcome.rationale: string | null`). Never re-mask (token numbering would collide).
6. `CheckedCitation.matchedText: string | null` = `body.slice(start, end)` for exact/normalized, `null` for not_found.
7. Malformed envelope: retryable on attempt 1; on the final attempt a non-retryable `processing_failed`
   with `details.reason = "ai_invalid_output"`. Never "ok with zero candidates".
8. Normalisation extensions approved: the normalized tier also strips zero-width and bidi format characters
   except ZWJ/ZWNJ; mask tokens and `[EXCLUDED_PARTICIPANT]` do not count towards the 12-character/3-word minimum.
9. Export `EXTRACT_REQUEST_LIMITS` (max messages and characters per call); oversized requests are
   `validation_failed`. Caps on output are now in the contract (`EXTRACTION_*_MAX`).

## I2 amendments (pipeline)
1. Use only the new lib/db worker API: `claimReadyJobs`, `completeJob`, `heartbeatJob`, `getJobContext`,
   `listExtractionMessages`, `listPointsForPipeline`, `listQuotesForCheck`, `listLinksNeedingSupport`,
   `listGapQuestionsForPipeline`, `setPointSortKeys`, `downloadVerifiedRawSourceWithMeta`,
   `deleteParsedRawSource`. Never `claimJobs`, `recordJobAttempt` or `deleteRawSource`.
2. Plan: per source `parse` (unparsed only) → `extract` → `verify_quotes`; per handover `verify_support` →
   `analyze` → `prepare_review`. `sourceId` is the content key in `inputHash`.
3. Dedup and conflict attachment happen in the (serial) extract stage, not in analyze (deviation from §10.9,
   because points cannot be deleted and links added after verify_support would stay unchecked). Merge only
   within the same `extraction_access_level`; never merge into or verify privacy-held points; evidence for a
   rejected point attaches to it and it stays rejected.
4. **Access isolation (QA-M8):** an extract request contains messages of one source only, and
   `insertExtractedPoint.extractionAccessLevel` is that source's `access_level`.
5. Stored quote text: `matchedText` for exact/normalized, the model quote for not_found (already mask-checked).
   `verify_quotes` records the authoritative check against the persisted body; the DB re-checks plausibility.
6. **D21:** the checklist creates category-level system gap questions (`pointId: null`), not `missing`
   points with fabricated AI provenance (deviation, flagged to the user).
7. Run outcome: failed on `provider_not_configured`, when every extract fails, or when
   verify_support/analyze/prepare_review exhaust retries; otherwise succeeded. Nothing approves or publishes.
8. Budgets (engineering defaults, flagged): ≤ 200 extract and ≤ 2000 verify calls per run; drain deadline
   240 s, lease 300 s with a heartbeat per chunk; the drain route's `maxDuration` is 300 s.
9. Pepper: env canary for now (flagged under D27); production rejects the golden test canary.

## I3 amendments (backend)
1. Consent records `runConfig.provider`.
2. No barrel: the UI imports from the individual `lib/actions/<file>.ts` modules (lead rewires).
3. **Masking (QA-H1):** one shared helper runs `maskText({ context: "user_input" })` on every persisted
   free-text field, including handover title, team name, role title and description; attributes are
   re-validated with `parsePointAttributes` after masking; categories come from a server re-read.
4. **`deleteAccount` is fully fail-closed** (account erasure, D27): Zod + actor, then `precondition_failed`
   with `details.reason = "recovery_manifest_unavailable"` before any write. `getAccountDeletionBlockers` works.
5. **`eraseParticipant`:** Zod + actor, then the same `precondition_failed`; no `erasure_target` call.
6. `CreatedLink.url` is absolute, built from `getSiteUrl()` (lib/supabase/site-url), checked before the token
   is created so a misconfiguration leaves no orphan token.
7. Q1 (identity hashes in `SourcePreview`) is open: return the contract shape; previews are limited to source
   managers by R2.
8. Use `getSourceSummary` (R1) and `loadRawSourceForPreview` (R2). `previewSource`/`startProcessing` wait for
   I1 A1 and I2 P1 to be merged.

## QA decisions
1. Tier P SQL tests live in `tests/integration/db/*.sql` with their own runner and container name
   (`baton-pg-it`); they may reuse `supabase/tests/shim`.
2. The stub set is approved for framework/platform modules only (`server-only`, `next/*`, `@supabase/ssr`).
   Never stub `lib/db`, `lib/privacy`, `lib/parsers` or `lib/ai` logic.
3. `todo` marking only for findings still open on `feature/main-integration`. M1–M5, M7 and L1 are fixed by
   L5 and must be hard tests.
