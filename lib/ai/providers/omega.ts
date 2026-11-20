import "server-only";

/**
 * Omega Plus API adapter, Anthropic-compatible `POST /v1/messages` (R3 Task 03, provider evaluation).
 *
 * STATUS: two modes, both decided by lib/ai/config.ts (docs/round3/ai-extraction-and-verification.md §8, §9, §9a):
 *   - EVALUATION: NODE_ENV exactly "development"/"test" AND `BATON_ALLOW_EVAL_PROVIDER=1` (the operator's
 *     statement that only synthetic data is processed);
 *   - PRODUCTION, OWNER-APPROVED (2026-11-20): only with `AI_DATA_GOVERNANCE=omega-owner-approved`, the owner's
 *     explicit acceptance that the vendor does NOT document prompt retention, training use, upstream
 *     sub-processors or data location, and that model names do not guarantee the upstream model. The uploader
 *     is told exactly that in the consent statement (lib/contracts/consent.ts, kind `omega_owner_approved`).
 * The adapter itself is identical in both modes; only the display name differs.
 *
 * Why raw `fetch` and not the Anthropic SDK: this is a third-party gateway, not Anthropic. Like the Gemini
 * adapter, the host is pinned by Baton's own configuration and nothing is taken from process-wide defaults
 * (the SDK would read ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL and retry on its own). Baton's job-level
 * retry policy is the only retry.
 *
 * - Prompts come only from lib/ai/prompts (fixed system text, escaped untrusted user turn, constant schema).
 * - Constrained output: `output_config.format = {type: "json_schema", schema}` (mode "json_schema", the
 *   default). The gateway does not document it; if it rejects it (400) the call fails as request-invalid,
 *   never silently. Mode "prompt" omits the parameter and relies on the prompt; either way lib/ai parses
 *   every answer with the unchanged Zod schemas. The mode is part of `adapterVersion` (provenance).
 * - No tools are declared; a `tool_use` block or stop reason is rejected (§12.10 rule 2).
 * - No sampling parameters: newer Claude models reject `temperature` and the gateway's upstream is unknown.
 *   Output is therefore NOT reproducible (EXT-5); the offline evaluation is the control.
 * - Model identity: a fixed model id is required, dynamic routes (`omega-plus`, …) are refused by config,
 *   and a response reporting a DIFFERENT model than the one requested is refused (`model_mismatch`), so an
 *   upstream switch is never accepted silently. The vendor states that public names do not guarantee a
 *   particular upstream model; a matching name is therefore recorded, not trusted.
 * - Never throws, never logs. Errors carry codes, reason tokens, HTTP status and short opaque ids only.
 * - The API key is used only in the request header here; it is never in AiRunConfig, provenance or errors.
 */

import type { AppError, Result } from "../../contracts/api";
import { abortedError, aiError, AI_ERROR_REASONS, toolCallRejectedError } from "../errors";
import { buildExtractPrompt } from "../prompts/extract";
import type { AiPrompt } from "../prompts/payload";
import { buildSupportPrompt } from "../prompts/support";
import { EXTRACT_PROMPT_VERSION, EXTRACT_SCHEMA_VERSION, SUPPORT_PROMPT_VERSION, SUPPORT_SCHEMA_VERSION } from "../prompts/versions";
import type { AiCallResult, AiProvenance, AiProvider, AiRunConfig, ExtractRequest, VerifySupportRequest } from "../provider";

export const OMEGA_PROVIDER_ID = "omega";
/** Evaluation mode (development/test, synthetic data only). */
export const OMEGA_DISPLAY_NAME = "Omega Plus API (Anthropic-compatible gateway) - evaluation only, synthetic data only";
export const OMEGA_EVALUATION_DISPLAY_NAME = OMEGA_DISPLAY_NAME;
/** Production mode under the owner-approved data-governance profile (2026-11-20). */
export const OMEGA_PRODUCTION_DISPLAY_NAME = "Omega Plus API (Anthropic-compatible gateway)";
export const OMEGA_DEFAULT_BASE_URL = "https://api.omegaplusapi.com";
export const OMEGA_ANTHROPIC_VERSION = "2023-06-01";
export const OMEGA_OUTPUT_MODES = ["json_schema", "prompt"] as const;
export type OmegaOutputMode = (typeof OMEGA_OUTPUT_MODES)[number];

/** Output budgets per call (non-streaming). */
export const OMEGA_MAX_TOKENS = { extract: 16_000, verify: 1_024 } as const;

export function omegaAdapterVersion(mode: OmegaOutputMode): string {
  return `omega-anthropic@1+${mode}`;
}

export interface OmegaModels {
  extract: string;
  verify: string;
}

export function omegaRunConfig(models: OmegaModels, mode: OmegaOutputMode): AiRunConfig {
  return {
    provider: OMEGA_PROVIDER_ID,
    adapterVersion: omegaAdapterVersion(mode),
    extract: { model: models.extract, promptVersion: EXTRACT_PROMPT_VERSION, schemaVersion: EXTRACT_SCHEMA_VERSION },
    verify: { model: models.verify, promptVersion: SUPPORT_PROMPT_VERSION, schemaVersion: SUPPORT_SCHEMA_VERSION },
  };
}

/** Minimal fetch shape, so tests inject a fake (no network in tests). */
export type OmegaFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface OmegaProviderOptions {
  apiKey: string;
  baseUrl: string;
  models: OmegaModels;
  outputMode: OmegaOutputMode;
  /** Public name for this mode (config.ts); defaults to the evaluation name. Never affects provenance. */
  displayName?: string;
  /** Tests only. Production uses the global fetch. */
  fetch?: OmegaFetch;
}

// ── Schema translation (request shaping only; Zod stays the authority) ───────

const KEPT = new Set(["type", "properties", "required", "additionalProperties", "enum", "const", "anyOf", "items", "description", "$defs", "$ref", "format"]);
const KEPT_FORMATS = new Set(["date", "date-time", "time", "email", "uri", "uuid"]);

/**
 * Translates the constant response schema into the conservative subset of JSON Schema that Anthropic
 * structured outputs accept: length, pattern and numeric bounds are dropped, `oneOf` becomes `anyOf`, and
 * every object gets `additionalProperties: false`. Pure.
 */
export function toStructuredOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStructuredOutputSchema);
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === "oneOf") out.anyOf = toStructuredOutputSchema(value);
    else if (key === "properties" || key === "$defs") {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toStructuredOutputSchema(v)]));
    } else if (key === "format") {
      if (typeof value === "string" && KEPT_FORMATS.has(value)) out.format = value;
    } else if (key === "additionalProperties") {
      out.additionalProperties = value === false ? false : typeof value === "object" ? toStructuredOutputSchema(value) : false;
    } else if (KEPT.has(key)) {
      out[key] = typeof value === "object" && value !== null ? toStructuredOutputSchema(value) : value;
    }
  }
  if (out.type === "object" && !("additionalProperties" in out)) out.additionalProperties = false;
  return out;
}

// ── Request / response mapping ───────────────────────────────────────────────

export function buildOmegaRequest(prompt: AiPrompt, model: string, maxTokens: number, mode: OmegaOutputMode): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
  };
  if (mode === "json_schema") body.output_config = { format: { type: "json_schema", schema: toStructuredOutputSchema(prompt.responseSchema) } };
  return body;
}

const TOKEN = /^[A-Za-z0-9_]{1,40}$/;
const token = (v: unknown) => (typeof v === "string" && TOKEN.test(v) ? v : "unknown");
const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

function providerError(retryable: boolean, providerErrorType: string, httpStatus?: number, providerRequestId?: unknown): AppError {
  return aiError({ code: "processing_failed", reason: AI_ERROR_REASONS.providerError, retryable, providerErrorType, httpStatus, providerRequestId });
}

/** Maps an HTTP failure. Only the body's `error.type` token is read; the message is never read or kept. */
export function mapOmegaHttpError(status: number, bodyText: string, requestId: string | null): AppError {
  let type = "http_error";
  try {
    const parsed = JSON.parse(bodyText) as { error?: { type?: unknown } };
    if (parsed?.error?.type !== undefined) type = token(parsed.error.type);
  } catch {
    // not JSON: keep the generic type
  }
  if (status === 400) {
    return aiError({ code: "validation_failed", reason: AI_ERROR_REASONS.requestInvalid, retryable: false, providerErrorType: type, httpStatus: status, providerRequestId: requestId });
  }
  if (status === 413) {
    return aiError({ code: "validation_failed", reason: AI_ERROR_REASONS.requestTooLarge, retryable: false, providerErrorType: type, httpStatus: status, providerRequestId: requestId });
  }
  if (status === 401 || status === 403) return providerError(false, type === "http_error" ? "permission_denied" : type, status, requestId);
  if (status === 404) return providerError(false, "model_not_found", status, requestId);
  if (status === 402) return providerError(false, "billing", status, requestId);
  // 408 timeout, 409, 429 rate limit / token window, 5xx and 529 overloaded: retryable with Baton's backoff.
  if (status === 408 || status === 409 || status === 429 || status >= 500) return providerError(true, type === "http_error" ? `http_${status}` : type, status, requestId);
  return providerError(false, type, status, requestId);
}

interface OmegaMessage {
  id?: unknown;
  type?: unknown;
  model?: unknown;
  content?: Array<{ type?: unknown; text?: unknown }>;
  stop_reason?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown; cache_creation_input_tokens?: unknown; cache_read_input_tokens?: unknown };
}

/** Maps a 200 response body to Baton's `raw` (parsed JSON, or undefined so lib/ai reports invalid output). */
export function mapOmegaResponse(bodyText: string, provenance: AiProvenance, requestIdHeader: string | null): Result<AiCallResult> {
  let msg: OmegaMessage;
  try {
    msg = JSON.parse(bodyText) as OmegaMessage;
  } catch {
    return { ok: false, error: providerError(true, "unreadable_response", 200, requestIdHeader) };
  }
  const requestId = requestIdHeader ?? (typeof msg.id === "string" ? msg.id : null);
  const reported = typeof msg.model === "string" ? msg.model : null;
  // Never accept a different upstream model silently.
  if (reported !== null && reported !== provenance.requestedModel) {
    return { ok: false, error: providerError(false, "model_mismatch", 200, requestId) };
  }
  const stop = msg.stop_reason;
  const blocks = Array.isArray(msg.content) ? msg.content : [];
  if (stop === "tool_use" || blocks.some((b) => b?.type === "tool_use" || b?.type === "server_tool_use")) {
    return { ok: false, error: toolCallRejectedError(requestId) };
  }
  if (stop === "refusal") return { ok: false, error: providerError(false, "refusal", 200, requestId) };

  // Thinking blocks are the model's scratchpad, never the answer.
  const text = blocks.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text as string).join("");
  let raw: unknown = undefined;
  if (stop === "end_turn" || stop === "stop_sequence" || stop === undefined || stop === null) {
    try {
      raw = text.length > 0 ? JSON.parse(stripFence(text)) : undefined;
    } catch {
      raw = undefined; // malformed JSON → lib/ai's retry-once invalid-output policy
    }
  } // max_tokens, pause_turn, anything else: truncated or unusable → invalid output

  const u = msg.usage ?? {};
  const input = count(u.input_tokens);
  const cacheIn = (count(u.cache_creation_input_tokens) ?? 0) + (count(u.cache_read_input_tokens) ?? 0);
  return {
    ok: true,
    data: {
      raw,
      provenance: { ...provenance, model: reported },
      meta: { providerRequestId: requestId, inputTokens: input === null ? null : input + cacheIn, outputTokens: count(u.output_tokens) },
    },
  };
}

/** In prompt mode some upstreams wrap JSON in a Markdown fence; only a single whole-answer fence is removed. */
function stripFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? m[1] : text;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export function createOmegaProvider(opts: OmegaProviderOptions): AiProvider {
  const doFetch: OmegaFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const runConfig = omegaRunConfig(opts.models, opts.outputMode);
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/v1/messages`;

  async function call(prompt: AiPrompt, stage: "extract" | "verify", signal: AbortSignal | undefined): Promise<Result<AiCallResult>> {
    const provenance: AiProvenance = {
      provider: OMEGA_PROVIDER_ID,
      adapterVersion: runConfig.adapterVersion,
      requestedModel: runConfig[stage].model,
      model: null,
      promptVersion: prompt.promptVersion,
      schemaVersion: prompt.schemaVersion,
    };
    if (signal?.aborted) return { ok: false, error: abortedError(signal) };
    const body = JSON.stringify(buildOmegaRequest(prompt, runConfig[stage].model, OMEGA_MAX_TOKENS[stage], opts.outputMode));
    let res: Awaited<ReturnType<OmegaFetch>>;
    let text: string;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": OMEGA_ANTHROPIC_VERSION },
        body,
        ...(signal ? { signal } : {}),
      });
      text = await res.text();
    } catch (e) {
      if (signal?.aborted) return { ok: false, error: abortedError(signal) };
      const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
      if (name === "TimeoutError") return { ok: false, error: aiError({ code: "processing_failed", reason: AI_ERROR_REASONS.timedOut, retryable: true }) };
      return { ok: false, error: providerError(true, "network") };
    }
    const requestId = res.headers.get("request-id") ?? res.headers.get("x-request-id");
    if (res.status < 200 || res.status >= 300) return { ok: false, error: mapOmegaHttpError(res.status, text, requestId) };
    try {
      return mapOmegaResponse(text, provenance, requestId);
    } catch {
      return { ok: false, error: providerError(true, "unreadable_response") };
    }
  }

  return {
    id: OMEGA_PROVIDER_ID,
    displayName: opts.displayName ?? OMEGA_EVALUATION_DISPLAY_NAME,
    extract: (req: ExtractRequest, o) => call(buildExtractPrompt(req), "extract", o?.signal),
    verifySupport: (req: VerifySupportRequest, o) => call(buildSupportPrompt(req), "verify", o?.signal),
  };
}
