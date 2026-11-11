import "server-only";

/**
 * Provider-neutral AI interface (docs/architecture/shared-contracts.md §11.8, D11).
 *
 * The §11.8 types are reproduced verbatim. Additions (docs/integration/interfaces.md, W0 decisions I1):
 * - `AiCallResult.meta` (optional, additive): non-sensitive call metadata an adapter can report for the
 *   `AiAttemptRecord` (request id and token counts). Never content.
 * - `AiFailure` / `AiResult<T>`: a `Result`-compatible failure branch that still carries the attempt
 *   record and provenance (I1 amendment 1).
 *
 * This contract never names a provider or model. No production adapter exists while D11 is open.
 */

import type { AppError, ErrorCode, Result } from "../contracts/api";
import type { PointCategory } from "../contracts/enums";
import type { PointAttributes } from "../contracts/schemas";

// ── §11.8 (verbatim) ─────────────────────────────────────────────────────────

export interface AiProvenance {
  provider: string; // stable adapter id; the consent statement names this provider
  adapterVersion: string; // version of lib/ai/providers/<id>.ts
  requestedModel: string; // the model id Baton asked for (from the run's AiRunConfig)
  model: string | null; // the exact model id the provider reported; null if the call failed before a response
  promptVersion: string; // e.g. "extract@3", "support@2"; bumped on any prompt change
  schemaVersion: string; // version of the Zod output schema
}

// Snapshotted into processing_runs.ai_config when a run is created.
export interface AiRunConfig {
  provider: string;
  adapterVersion: string;
  extract: { model: string; promptVersion: string; schemaVersion: string };
  verify: { model: string; promptVersion: string; schemaVersion: string };
}

// One entry per attempt in processing_jobs.attempt_log. Non-sensitive only:
// never prompts, message text, model output, credentials or raw provider error bodies.
export interface AiAttemptRecord {
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  outcome: "succeeded" | "failed" | "timed_out" | "invalid_output";
  errorCode: ErrorCode | null;
  providerErrorType: string | null; // the provider's error class or code, e.g. "rate_limit"
  httpStatus: number | null;
  providerRequestId: string | null;
  reportedModel: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ExtractRequest {
  handover: { teamName: string; roleTitle: string | null };
  categories: readonly PointCategory[];
  messages: Array<{ id: string; authorLabel: string | null; sentAt: string | null; body: string }>; // masked only
}

export interface VerifySupportRequest {
  claim: { category: PointCategory; title: string; statement: string; attributes: PointAttributes }; // current revision
  quote: { text: string; authorLabel: string | null; sentAt: string | null };
  context: Array<{ authorLabel: string | null; sentAt: string | null; body: string }>; // ≤ 3 neighbouring masked messages
}

export interface AiCallResult {
  raw: unknown;
  provenance: AiProvenance;
  /** Additive (A1): non-sensitive metadata for the attempt record. Never content. */
  meta?: AiCallMeta;
}

export interface AiProvider {
  readonly id: string;
  readonly displayName: string; // shown in the consent statement
  extract(req: ExtractRequest, opts?: { signal?: AbortSignal }): Promise<Result<AiCallResult>>;
  verifySupport(req: VerifySupportRequest, opts?: { signal?: AbortSignal }): Promise<Result<AiCallResult>>;
}

// ── Additions (interfaces.md W0 decisions, I1) ───────────────────────────────

/** Non-sensitive metadata about one provider call. Ids and counts only. */
export interface AiCallMeta {
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Failure branch of `extractCandidates` and `verifySupport` (I1 amendment 1). Structurally a `Result`
 * failure, so callers can keep checking `.ok`; it also carries the records §11.8 rule 3 requires for a
 * failed attempt.
 */
export interface AiFailure {
  ok: false;
  error: AppError;
  attempt?: AiAttemptRecord;
  provenance?: AiProvenance;
}

export type AiResult<T> = { ok: true; data: T } | AiFailure;

/** Options for `extractCandidates` and `verifySupport` (I1 amendment 2). `attempt` is 1-based. */
export interface AiStageOptions {
  signal?: AbortSignal;
  attempt: number;
  runConfig: AiRunConfig;
}
