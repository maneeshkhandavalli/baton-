import "server-only";

/**
 * Google Gemini Developer API adapter (§11.8, D11: provider = Gemini Developer API, FREE tier only; billing is never enabled).
 *
 * - Prompts come only from lib/ai/prompts (fixed system text, escaped untrusted user turn, constant schema).
 * - Constrained output: `responseMimeType: application/json` + `responseJsonSchema`. Gemini supports a
 *   subset of JSON Schema, so `toGeminiJsonSchema` translates the constant schema (const → one-value enum,
 *   oneOf → anyOf) and drops keywords Gemini does not support (length limits, pattern, default, $schema).
 *   This only shapes the request: lib/ai still parses every response with the unchanged Zod schemas, so no
 *   validation is weakened.
 * - No tools are declared. A function call in the response is rejected (§12.10 rule 2).
 * - The SDK's own HTTP retries are disabled (attempts: 1): Baton's job-level retry policy is the only one.
 * - The backend and host are pinned (`vertexai: false`, explicit `baseUrl`): @google/genai otherwise switches
 *   to Vertex AI when GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_GENAI_USE_ENTERPRISE is set, and sends the request
 *   (key included) to GOOGLE_GEMINI_BASE_URL or a `setDefaultBaseUrls` host when one is set.
 * - Never throws, never logs. Errors carry codes, reason tokens, HTTP status and short opaque ids only:
 *   never the provider's message or body, the prompt, the output, or the API key.
 * - The API key lives only inside the SDK client created here. It is never part of AiRunConfig,
 *   provenance, metadata or errors.
 */

import { ApiError, GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";

import type { AppError, Result } from "../../contracts/api";
import { abortedError, aiError, AI_ERROR_REASONS, toolCallRejectedError } from "../errors";
import { buildExtractPrompt } from "../prompts/extract";
import type { AiPrompt } from "../prompts/payload";
import { buildSupportPrompt } from "../prompts/support";
import { EXTRACT_PROMPT_VERSION, EXTRACT_SCHEMA_VERSION, SUPPORT_PROMPT_VERSION, SUPPORT_SCHEMA_VERSION } from "../prompts/versions";
import type { AiCallResult, AiProvenance, AiProvider, AiRunConfig, ExtractRequest, VerifySupportRequest } from "../provider";

export const GEMINI_PROVIDER_ID = "gemini";
export const GEMINI_ADAPTER_VERSION = "gemini@1";
export const GEMINI_DISPLAY_NAME = "Google Gemini (Gemini Developer API, free tier)";
/** The agreed model for both stages (Stable, free tier per ai.google.dev pricing, checked 2026-11-14) (overridable with AI_MODEL_EXTRACT / AI_MODEL_VERIFY). */
export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";

export interface GeminiModels {
  extract: string;
  verify: string;
}

export function geminiRunConfig(models: GeminiModels): AiRunConfig {
  return {
    provider: GEMINI_PROVIDER_ID,
    adapterVersion: GEMINI_ADAPTER_VERSION,
    extract: { model: models.extract, promptVersion: EXTRACT_PROMPT_VERSION, schemaVersion: EXTRACT_SCHEMA_VERSION },
    verify: { model: models.verify, promptVersion: SUPPORT_PROMPT_VERSION, schemaVersion: SUPPORT_SCHEMA_VERSION },
  };
}

// ── Minimal structural view of the SDK (so tests inject a fake client; no network in tests) ─────────────

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: unknown;
  executableCode?: unknown;
}

export interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
  responseId?: string;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export interface GeminiGenerateParams {
  model: string;
  contents: Array<{ role: "user"; parts: Array<{ text: string }> }>;
  config: {
    systemInstruction: string;
    responseMimeType: "application/json";
    responseJsonSchema: unknown;
    candidateCount: 1;
    abortSignal?: AbortSignal;
  };
}

export interface GeminiClient {
  models: { generateContent(params: GeminiGenerateParams): Promise<GeminiResponse> };
}

export interface GeminiProviderOptions {
  apiKey: string;
  models: GeminiModels;
  /** Tests only: a fake client. Production builds the SDK client from `apiKey`. */
  client?: GeminiClient;
}

/** The Gemini Developer API host (the SDK's own default), pinned so the environment cannot redirect it. */
export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/";

/**
 * SDK client options. Every field the SDK would otherwise take from the environment or a process-wide
 * default is explicit: the key (never GOOGLE_API_KEY / GEMINI_API_KEY), the backend (`vertexai: false`,
 * never GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_GENAI_USE_ENTERPRISE) and the host (never GOOGLE_GEMINI_BASE_URL
 * or `setDefaultBaseUrls`). SDK retries are off.
 */
export function geminiClientOptions(apiKey: string): GoogleGenAIOptions {
  return { apiKey, vertexai: false, httpOptions: { baseUrl: GEMINI_API_BASE_URL, retryOptions: { attempts: 1 } } };
}

function sdkClient(apiKey: string): GeminiClient {
  return new GoogleGenAI(geminiClientOptions(apiKey)) as unknown as GeminiClient;
}

// ── Schema translation (request shaping only; Zod stays the authority) ───────────────────────────────

const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items", "prefixItems",
  "minItems", "maxItems", "minimum", "maximum", "anyOf", "properties", "additionalProperties", "required", "propertyOrdering",
]);
const KEPT_FORMATS: ReadonlySet<string> = new Set(["date", "date-time", "time"]);

/** Translates a JSON Schema into the subset Gemini's `responseJsonSchema` supports. Pure. */
export function toGeminiJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === "const") {
      out.enum = [value];
    } else if (key === "oneOf") {
      out.anyOf = toGeminiJsonSchema(value);
    } else if (key === "properties" || key === "$defs") {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toGeminiJsonSchema(v)]));
    } else if (key === "format") {
      if (typeof value === "string" && KEPT_FORMATS.has(value)) out.format = value;
    } else if (SUPPORTED_KEYWORDS.has(key)) {
      out[key] = typeof value === "object" && value !== null ? toGeminiJsonSchema(value) : value;
    }
  }
  return out;
}

// ── Response mapping ─────────────────────────────────────────────────────────

const BLOCKING_FINISH = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"]);
const TOOL_FINISH = new Set(["MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL"]);
const TOKEN = /^[A-Za-z0-9_]{1,40}$/;
const token = (v: unknown) => (typeof v === "string" && TOKEN.test(v) ? v : "unknown");
const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

function providerError(retryable: boolean, providerErrorType: string, httpStatus?: number, providerRequestId?: unknown): AppError {
  return aiError({ code: "processing_failed", reason: AI_ERROR_REASONS.providerError, retryable, providerErrorType, httpStatus, providerRequestId });
}

/** Maps a thrown SDK/network error to an AppError. Never reads the error's message or body. */
export function mapGeminiThrow(e: unknown, signal: AbortSignal | undefined): AppError {
  if (signal?.aborted) return abortedError(signal);
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  if (name === "AbortError" || name === "TimeoutError") {
    return aiError({ code: "processing_failed", reason: name === "TimeoutError" ? AI_ERROR_REASONS.timedOut : AI_ERROR_REASONS.aborted, retryable: true });
  }
  const status = e instanceof ApiError || (typeof e === "object" && e !== null && typeof (e as { status?: unknown }).status === "number")
    ? (e as { status: number }).status
    : null;
  if (status === null) return providerError(true, "network");
  if (status === 400) return aiError({ code: "validation_failed", reason: AI_ERROR_REASONS.requestInvalid, retryable: false, providerErrorType: "invalid_argument", httpStatus: status });
  if (status === 401 || status === 403) return providerError(false, "permission_denied", status);
  if (status === 404) return providerError(false, "model_not_found", status);
  if (status === 408) return providerError(true, "deadline_exceeded", status);
  if (status === 429) return providerError(true, "resource_exhausted", status);
  if (status >= 500) return providerError(true, "unavailable", status);
  return providerError(false, "http_error", status);
}

/** Maps a Gemini response to Baton's `raw` (parsed JSON, or undefined so lib/ai reports invalid output). */
export function mapGeminiResponse(res: GeminiResponse, provenance: AiProvenance): Result<AiCallResult> {
  const requestId = typeof res?.responseId === "string" ? res.responseId : null;
  const blocked = res?.promptFeedback?.blockReason;
  if (blocked) return { ok: false, error: providerError(false, `prompt_blocked_${token(blocked)}`.slice(0, 64), undefined, requestId) };

  const candidate = res?.candidates?.[0];
  const finish = candidate?.finishReason;
  const parts = candidate?.content?.parts ?? [];
  if (parts.some((p) => p.functionCall !== undefined || p.executableCode !== undefined) || (finish && TOOL_FINISH.has(finish))) {
    return { ok: false, error: toolCallRejectedError(requestId) };
  }
  if (finish && BLOCKING_FINISH.has(finish)) {
    return { ok: false, error: providerError(false, `finish_${token(finish)}`.slice(0, 64), undefined, requestId) };
  }

  // Thinking parts are the model's scratchpad, never the answer.
  const text = parts.filter((p) => p.thought !== true && typeof p.text === "string").map((p) => p.text).join("");
  let raw: unknown = undefined;
  if (finish === undefined || finish === "STOP") {
    try {
      raw = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      raw = undefined; // malformed JSON → lib/ai's retry-once invalid-output policy
    }
  } // MAX_TOKENS and anything else: truncated or unusable → invalid output

  const usage = res?.usageMetadata;
  const output = count(usage?.candidatesTokenCount);
  const thoughts = count(usage?.thoughtsTokenCount);
  return {
    ok: true,
    data: {
      raw,
      provenance: { ...provenance, model: typeof res?.modelVersion === "string" ? res.modelVersion : null },
      meta: {
        providerRequestId: requestId,
        inputTokens: count(usage?.promptTokenCount),
        // Billed output includes thinking tokens.
        outputTokens: output === null && thoughts === null ? null : (output ?? 0) + (thoughts ?? 0),
      },
    },
  };
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export function createGeminiProvider(opts: GeminiProviderOptions): AiProvider {
  const client = opts.client ?? sdkClient(opts.apiKey);
  const runConfig = geminiRunConfig(opts.models);

  async function call(prompt: AiPrompt, stage: "extract" | "verify", signal: AbortSignal | undefined): Promise<Result<AiCallResult>> {
    const provenance: AiProvenance = {
      provider: GEMINI_PROVIDER_ID,
      adapterVersion: GEMINI_ADAPTER_VERSION,
      requestedModel: runConfig[stage].model,
      model: null,
      promptVersion: prompt.promptVersion,
      schemaVersion: prompt.schemaVersion,
    };
    if (signal?.aborted) return { ok: false, error: abortedError(signal) };
    let res: GeminiResponse;
    try {
      res = await client.models.generateContent({
        model: runConfig[stage].model,
        contents: [{ role: "user", parts: [{ text: prompt.user }] }],
        config: {
          systemInstruction: prompt.system,
          responseMimeType: "application/json",
          responseJsonSchema: toGeminiJsonSchema(prompt.responseSchema),
          candidateCount: 1,
          ...(signal ? { abortSignal: signal } : {}),
        },
      });
    } catch (e) {
      return { ok: false, error: mapGeminiThrow(e, signal) };
    }
    try {
      return mapGeminiResponse(res, provenance);
    } catch {
      return { ok: false, error: providerError(true, "unreadable_response") };
    }
  }

  return {
    id: GEMINI_PROVIDER_ID,
    displayName: GEMINI_DISPLAY_NAME,
    extract: (req: ExtractRequest, o) => call(buildExtractPrompt(req), "extract", o?.signal),
    verifySupport: (req: VerifySupportRequest, o) => call(buildSupportPrompt(req), "verify", o?.signal),
  };
}
