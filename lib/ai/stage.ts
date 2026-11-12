import "server-only";

/**
 * Shared plumbing for the two AI stages (extract, verify support): option checks, the provider call,
 * provenance checks, error sanitisation and the AiAttemptRecord (§11.8 rules 2–3, interfaces.md I1).
 *
 * Nothing here logs. Errors and records carry codes, reason tokens, ids, counts and timings only, never
 * prompts, message text, model output, credentials or raw provider error bodies.
 */

import type { AppError, ErrorCode, Result } from "../contracts/api";
import { ERROR_CODES } from "../contracts/api";
import { maskText } from "../privacy/mask";
import { aiConfigChangedError, aiError, AI_ERROR_REASONS, type AiErrorReason, sanitizeHttpStatus, sanitizeProviderErrorType, sanitizeProviderRequestId } from "./errors";
import { EXTRACT_PROMPT_VERSION, EXTRACT_SCHEMA_VERSION, SUPPORT_PROMPT_VERSION, SUPPORT_SCHEMA_VERSION } from "./prompts/versions";
import type { AiAttemptRecord, AiCallResult, AiFailure, AiProvenance, AiProvider, AiRunConfig, AiStageOptions } from "./provider";

export type AiStage = "extract" | "verify";

/** "Malformed output is retried once" (§11.8 rule 2): attempt 1 may retry, attempt 2 and later may not. */
export const MAX_INVALID_OUTPUT_ATTEMPTS = 2;

export const isFinalInvalidOutputAttempt = (attempt: number) => attempt >= MAX_INVALID_OUTPUT_ATTEMPTS;

const CURRENT_VERSIONS = {
  extract: { promptVersion: EXTRACT_PROMPT_VERSION, schemaVersion: EXTRACT_SCHEMA_VERSION },
  verify: { promptVersion: SUPPORT_PROMPT_VERSION, schemaVersion: SUPPORT_SCHEMA_VERSION },
} as const;

const KNOWN_REASONS = new Set<string>(Object.values(AI_ERROR_REASONS));
const MODEL_ID = /^[A-Za-z0-9_.:/@+-]{1,128}$/;

export function sanitizeModelId(value: unknown): string | null {
  return typeof value === "string" && MODEL_ID.test(value) ? value : null;
}

function sanitizeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The provenance this stage must report, from the run snapshot. `model` is filled from the response. */
export function expectedProvenance(runConfig: AiRunConfig, stage: AiStage): AiProvenance {
  const block = runConfig[stage];
  return {
    provider: runConfig.provider,
    adapterVersion: runConfig.adapterVersion,
    requestedModel: block.model,
    model: null,
    promptVersion: block.promptVersion,
    schemaVersion: block.schemaVersion,
  };
}

function isRunConfig(value: unknown): value is AiRunConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const block = (b: unknown) =>
    typeof b === "object" &&
    b !== null &&
    ["model", "promptVersion", "schemaVersion"].every((k) => typeof (b as Record<string, unknown>)[k] === "string");
  return typeof v.provider === "string" && typeof v.adapterVersion === "string" && block(v.extract) && block(v.verify);
}

export interface AttemptClock {
  attempt: number;
  startedAt: string;
  t0: number;
}

export function startAttempt(attempt: number): AttemptClock {
  return { attempt, startedAt: new Date().toISOString(), t0: Date.now() };
}

export function attemptRecord(
  clock: AttemptClock,
  fields: Partial<Omit<AiAttemptRecord, "attempt" | "startedAt">> & Pick<AiAttemptRecord, "outcome">,
): AiAttemptRecord {
  return {
    attempt: clock.attempt,
    startedAt: clock.startedAt,
    finishedAt: new Date().toISOString(),
    errorCode: null,
    providerErrorType: null,
    httpStatus: null,
    providerRequestId: null,
    reportedModel: null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    ...fields,
  };
}

/**
 * Checks `opts` before anything else. Returns a failure (without records when `opts` itself is unusable),
 * or the validated attempt number and expected provenance.
 */
export function checkStageOptions(
  provider: AiProvider,
  opts: AiStageOptions,
  stage: AiStage,
): { ok: true; clock: AttemptClock; expected: AiProvenance } | AiFailure {
  const attempt = (opts as Partial<AiStageOptions> | undefined)?.attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    return { ok: false, error: aiError({ code: "validation_failed", reason: AI_ERROR_REASONS.requestInvalid, retryable: false }) };
  }
  const clock = startAttempt(attempt);
  if (!isRunConfig(opts.runConfig)) {
    return { ok: false, error: aiConfigChangedError(), attempt: attemptRecord(clock, { outcome: "failed", errorCode: "precondition_failed", latencyMs: 0 }) };
  }
  const expected = expectedProvenance(opts.runConfig, stage);
  const current = CURRENT_VERSIONS[stage];
  if (
    opts.runConfig.provider !== provider.id ||
    expected.promptVersion !== current.promptVersion ||
    expected.schemaVersion !== current.schemaVersion
  ) {
    return failure(clock, expected, aiConfigChangedError(), "failed");
  }
  return { ok: true, clock, expected };
}

export function failure(
  clock: AttemptClock,
  provenance: AiProvenance,
  error: AppError,
  outcome: AiAttemptRecord["outcome"],
  extra: Partial<AiAttemptRecord> = {},
): AiFailure {
  return {
    ok: false,
    error,
    provenance,
    attempt: attemptRecord(clock, { latencyMs: Date.now() - clock.t0, ...extra, outcome, errorCode: error.code }),
  };
}

/** `validation_failed` for a request that is malformed or over budget. Never retryable. */
export function requestFailure(clock: AttemptClock, expected: AiProvenance, reason: AiErrorReason): AiFailure {
  return failure(clock, expected, aiError({ code: "validation_failed", reason, retryable: false }), "failed", { latencyMs: 0 });
}

/**
 * Malformed model output (I1 amendment 7): retryable on attempt 1; on the final attempt a non-retryable
 * `processing_failed` with `details.reason = "ai_invalid_output"`.
 */
export function invalidOutputFailure(
  clock: AttemptClock,
  provenance: AiProvenance,
  extra: Partial<AiAttemptRecord> = {},
): AiFailure {
  const error = aiError({
    code: "processing_failed",
    reason: AI_ERROR_REASONS.invalidOutput,
    retryable: !isFinalInvalidOutputAttempt(clock.attempt),
  });
  return failure(clock, provenance, error, "invalid_output", extra);
}

/** Rebuilds an adapter's AppError from codes and tokens only, so no provider text can pass through. */
function sanitizeProviderError(error: AppError | undefined, attempt: number): { error: AppError; outcome: AiAttemptRecord["outcome"]; extra: Partial<AiAttemptRecord> } {
  const details = (error?.details ?? {}) as Record<string, unknown>;
  const rawReason = typeof details.reason === "string" && KNOWN_REASONS.has(details.reason) ? (details.reason as AiErrorReason) : AI_ERROR_REASONS.providerError;
  const code: ErrorCode = error && (ERROR_CODES as readonly string[]).includes(error.code) ? error.code : "internal";
  const extra: Partial<AiAttemptRecord> = {
    providerErrorType: sanitizeProviderErrorType(details.providerErrorType),
    httpStatus: sanitizeHttpStatus(details.httpStatus),
    providerRequestId: sanitizeProviderRequestId(details.providerRequestId),
  };
  if (rawReason === AI_ERROR_REASONS.toolCall) {
    // A tool call is invalid output (§12.10 rule 2): same retry-once policy.
    const sanitized = aiError({
      code: "processing_failed",
      reason: AI_ERROR_REASONS.toolCall,
      retryable: !isFinalInvalidOutputAttempt(attempt),
      providerRequestId: extra.providerRequestId,
    });
    return { error: sanitized, outcome: "invalid_output", extra };
  }
  const sanitized = aiError({
    code,
    reason: rawReason,
    retryable: Boolean(error?.retryable),
    providerErrorType: extra.providerErrorType,
    httpStatus: extra.httpStatus,
    providerRequestId: extra.providerRequestId,
  });
  return { error: sanitized, outcome: rawReason === AI_ERROR_REASONS.timedOut ? "timed_out" : "failed", extra };
}

export interface ProviderSuccess {
  ok: true;
  raw: unknown;
  /** Expected provenance with the model the provider reported. */
  provenance: AiProvenance;
  /** Record fields gathered from the call (latency, model, request id, token counts). */
  extra: Partial<AiAttemptRecord>;
}

/** Calls the provider and checks the provenance it reports against the run snapshot. */
export async function callProvider(
  clock: AttemptClock,
  expected: AiProvenance,
  invoke: () => Promise<Result<AiCallResult>>,
): Promise<ProviderSuccess | AiFailure> {
  let result: Result<AiCallResult>;
  try {
    result = await invoke();
  } catch {
    // An adapter must not throw; if it does, nothing from the exception is kept.
    return failure(clock, expected, aiError({ code: "internal", reason: AI_ERROR_REASONS.providerError, retryable: true }), "failed");
  }
  const latencyMs = Date.now() - clock.t0;
  if (!result || typeof result !== "object") {
    return failure(clock, expected, aiError({ code: "internal", reason: AI_ERROR_REASONS.providerError, retryable: true }), "failed", { latencyMs });
  }
  if (!result.ok) {
    const { error, outcome, extra } = sanitizeProviderError(result.error, clock.attempt);
    return failure(clock, expected, error, outcome, { ...extra, latencyMs });
  }

  const reported = result.data?.provenance;
  const meta = result.data?.meta;
  const model = sanitizeModelId(reported?.model);
  const extra: Partial<AiAttemptRecord> = {
    latencyMs,
    reportedModel: model,
    providerRequestId: sanitizeProviderRequestId(meta?.providerRequestId),
    inputTokens: sanitizeCount(meta?.inputTokens),
    outputTokens: sanitizeCount(meta?.outputTokens),
  };
  const provenance: AiProvenance = { ...expected, model };
  if (
    !reported ||
    reported.provider !== expected.provider ||
    reported.adapterVersion !== expected.adapterVersion ||
    reported.requestedModel !== expected.requestedModel ||
    reported.promptVersion !== expected.promptVersion ||
    reported.schemaVersion !== expected.schemaVersion
  ) {
    return failure(clock, provenance, aiConfigChangedError(), "failed", extra);
  }
  return { ok: true, raw: result.data.raw, provenance, extra };
}

/** True if masking would change `text`: the model wrote something that looks private (QA-M6). Never re-masks. */
export function wouldMask(text: string): boolean {
  return maskText({ text, context: "user_input" }).text !== text;
}
