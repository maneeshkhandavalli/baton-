import "server-only";

/**
 * AppError builders shared by lib/ai and every adapter (§3.2, §11.8, §12.7).
 *
 * Codes come from ERROR_CODES only. `details.reason` is a token matching `^[a-z0-9_:]{1,64}$` so it can be
 * stored as a job/run `error_message`. Provider-supplied identifiers are sanitised to short opaque tokens;
 * raw provider error bodies, prompts, message text and model output never enter an AppError.
 */

import type { AppError, ErrorCode } from "../contracts/api";

export const AI_ERROR_REASONS = {
  providerNotConfigured: "provider_not_configured",
  aiConfigChanged: "ai_config_changed",
  invalidOutput: "ai_invalid_output",
  toolCall: "ai_tool_call",
  providerError: "ai_provider_error",
  timedOut: "ai_timed_out",
  aborted: "ai_aborted",
  requestTooLarge: "ai_request_too_large",
} as const;
export type AiErrorReason = (typeof AI_ERROR_REASONS)[keyof typeof AI_ERROR_REASONS];

const REASON_TOKEN = /^[a-z0-9_:]{1,64}$/;
const PROVIDER_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const REQUEST_ID_TOKEN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** A provider error class/code, or null when it is absent or not a short opaque token. */
export function sanitizeProviderErrorType(value: unknown): string | null {
  return typeof value === "string" && PROVIDER_TOKEN.test(value) ? value : null;
}

/** A provider request id, or null when it is absent or not a short opaque token. */
export function sanitizeProviderRequestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID_TOKEN.test(value) ? value : null;
}

/** An HTTP status, or null unless it is an integer in 100–599. */
export function sanitizeHttpStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

export function aiError(input: {
  code: ErrorCode;
  reason: AiErrorReason;
  retryable: boolean;
  message?: string;
  providerErrorType?: unknown;
  httpStatus?: unknown;
  providerRequestId?: unknown;
}): AppError {
  if (!REASON_TOKEN.test(input.reason)) throw new Error("invalid AI error reason token");
  const details: Record<string, string | number | boolean> = { reason: input.reason };
  const providerErrorType = sanitizeProviderErrorType(input.providerErrorType);
  const httpStatus = sanitizeHttpStatus(input.httpStatus);
  const providerRequestId = sanitizeProviderRequestId(input.providerRequestId);
  if (providerErrorType !== null) details.providerErrorType = providerErrorType;
  if (httpStatus !== null) details.httpStatus = httpStatus;
  if (providerRequestId !== null) details.providerRequestId = providerRequestId;
  return {
    code: input.code,
    message: input.message ?? DEFAULT_MESSAGES[input.reason],
    retryable: input.retryable,
    details,
  };
}

const DEFAULT_MESSAGES: Record<AiErrorReason, string> = {
  provider_not_configured: "AI processing is not configured on this server.",
  ai_config_changed: "The AI configuration changed since this run started. Start processing again.",
  ai_invalid_output: "The AI returned output Baton could not use.",
  ai_tool_call: "The AI returned output Baton could not use.",
  ai_provider_error: "The AI provider could not complete the request.",
  ai_timed_out: "The AI request timed out.",
  ai_aborted: "The AI request was cancelled.",
  ai_request_too_large: "The AI request was larger than allowed.",
};

/** `precondition_failed`, `details.reason = "provider_not_configured"`, never retryable (D11). */
export function providerNotConfiguredError(): AppError {
  return aiError({ code: "precondition_failed", reason: AI_ERROR_REASONS.providerNotConfigured, retryable: false });
}

/** The live configuration no longer matches the run's `AiRunConfig` snapshot. Never retryable. */
export function aiConfigChangedError(): AppError {
  return aiError({ code: "precondition_failed", reason: AI_ERROR_REASONS.aiConfigChanged, retryable: false });
}

/**
 * Adapters reject any response that contains a tool or function call (§12.10 rule 2). Retryable at the
 * adapter level; lib/ai's retry policy decides whether the attempt may be retried.
 */
export function toolCallRejectedError(providerRequestId?: unknown): AppError {
  return aiError({ code: "processing_failed", reason: AI_ERROR_REASONS.toolCall, retryable: true, providerRequestId });
}

/** Abort handling shared by adapters: a `TimeoutError` reason is a timeout, anything else a cancellation. */
export function abortedError(signal: AbortSignal): AppError {
  const reason: unknown = signal.reason;
  const timedOut = typeof reason === "object" && reason !== null && (reason as { name?: unknown }).name === "TimeoutError";
  return aiError({
    code: "processing_failed",
    reason: timedOut ? AI_ERROR_REASONS.timedOut : AI_ERROR_REASONS.aborted,
    retryable: true,
  });
}
