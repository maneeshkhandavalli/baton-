import "server-only";

/**
 * Deterministic test adapter (§11.8 rule 7). NOT a real AI provider: it performs no model inference,
 * makes no network calls and reads no credentials. Its id "fake" flows into `AiRunConfig.provider` and
 * every `AiProvenance`, so its output can never pass for production extraction.
 *
 * It is selected only through lib/ai/config.ts (AI_PROVIDER=fake, BATON_ALLOW_FAKE_AI=1, not production).
 * Tests may also construct it directly with a script.
 *
 * Scripting model: `script.extract` / `script.verifySupport` is either a queue of steps (one consumed per
 * call, in order) or a function `(request, callIndex) => step`. When a queue is exhausted, or a step is
 * `{ kind: "default" }`, the built-in deterministic behaviour runs:
 * - extract: keyword rules over the given messages, quoting one verbatim sentence per candidate;
 * - verifySupport: word overlap between the quote and the claim statement (plus a negation rule).
 * The defaults never interpret instructions inside the text; they are plumbing, not judgement. Whether a
 * real model resists prompt injection is the opt-in live suite's job (§12.10 rule 7).
 */

import type { AppError, Result } from "../../contracts/api";
import type { PointCategory } from "../../contracts/enums";
import { EXTRACTION_CANDIDATES_MAX, EXTRACTION_QUOTE_MAX, EXTRACTION_STATEMENT_MAX, EXTRACTION_TITLE_MAX } from "../../contracts/schemas";
import { abortedError, aiError, AI_ERROR_REASONS, toolCallRejectedError } from "../errors";
import { buildExtractPrompt } from "../prompts/extract";
import type { AiPrompt } from "../prompts/payload";
import { buildSupportPrompt } from "../prompts/support";
import { EXTRACT_PROMPT_VERSION, EXTRACT_SCHEMA_VERSION, SUPPORT_PROMPT_VERSION, SUPPORT_SCHEMA_VERSION } from "../prompts/versions";
import type { AiCallMeta, AiCallResult, AiProvenance, AiProvider, AiRunConfig, ExtractRequest, VerifySupportRequest } from "../provider";

export const FAKE_PROVIDER_ID = "fake";
export const FAKE_ADAPTER_VERSION = "fake@1";
export const FAKE_DISPLAY_NAME = "Baton test adapter (fake) - not a real AI provider; no AI processing takes place";
export const FAKE_MODELS = { extract: "fake-extract-v1", verify: "fake-verify-v1" } as const;

/** The run configuration for the fake adapter. Ignores AI_MODEL_* so a fake run never shows a real-looking model. */
export function fakeRunConfig(): AiRunConfig {
  return {
    provider: FAKE_PROVIDER_ID,
    adapterVersion: FAKE_ADAPTER_VERSION,
    extract: { model: FAKE_MODELS.extract, promptVersion: EXTRACT_PROMPT_VERSION, schemaVersion: EXTRACT_SCHEMA_VERSION },
    verify: { model: FAKE_MODELS.verify, promptVersion: SUPPORT_PROMPT_VERSION, schemaVersion: SUPPORT_SCHEMA_VERSION },
  };
}

// ── Script ───────────────────────────────────────────────────────────────────

interface FakeStepTiming {
  /** Simulated latency before the step resolves (abortable). */
  delayMs?: number;
}

export type FakeStep =
  /** The model's output, returned as `raw` unchanged. */
  | (FakeStepTiming & {
      kind: "raw";
      raw: unknown;
      /** Model id the "provider" reports; defaults to the requested model. `null` simulates no report. */
      reportedModel?: string | null;
      /** Overrides individual provenance fields, to test provenance checks in lib/ai. */
      provenance?: Partial<AiProvenance>;
      meta?: Partial<AiCallMeta>;
    })
  /** A provider failure, returned as is. */
  | (FakeStepTiming & { kind: "error"; error: AppError })
  /** The provider answered with a tool/function call: rejected through the shared adapter path (§12.10.2). */
  | (FakeStepTiming & { kind: "tool_call"; providerRequestId?: string })
  /** Never resolves until the caller's signal aborts (timeout and cancellation tests). */
  | { kind: "hang" }
  /** The built-in deterministic behaviour. */
  | (FakeStepTiming & { kind: "default" });

export type FakeStepSource<Req> = readonly FakeStep[] | ((req: Req, callIndex: number) => FakeStep);

export interface FakeProviderScript {
  extract?: FakeStepSource<ExtractRequest>;
  verifySupport?: FakeStepSource<VerifySupportRequest>;
}

export interface FakeProvider extends AiProvider {
  /**
   * In-memory record of the requests this instance received and the prompts a real adapter would send for
   * them (built with the same lib/ai/prompts builders). Test assertions only; never persisted or logged.
   */
  readonly calls: {
    readonly extract: ExtractRequest[];
    readonly verifySupport: VerifySupportRequest[];
    readonly extractPrompts: AiPrompt[];
    readonly verifySupportPrompts: AiPrompt[];
  };
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export function createFakeProvider(script: FakeProviderScript = {}): FakeProvider {
  const calls = {
    extract: [] as ExtractRequest[],
    verifySupport: [] as VerifySupportRequest[],
    extractPrompts: [] as AiPrompt[],
    verifySupportPrompts: [] as AiPrompt[],
  };
  const runConfig = fakeRunConfig();

  const extractBase: AiProvenance = {
    provider: FAKE_PROVIDER_ID,
    adapterVersion: FAKE_ADAPTER_VERSION,
    requestedModel: runConfig.extract.model,
    model: null,
    promptVersion: runConfig.extract.promptVersion,
    schemaVersion: runConfig.extract.schemaVersion,
  };
  const verifyBase: AiProvenance = {
    provider: FAKE_PROVIDER_ID,
    adapterVersion: FAKE_ADAPTER_VERSION,
    requestedModel: runConfig.verify.model,
    model: null,
    promptVersion: runConfig.verify.promptVersion,
    schemaVersion: runConfig.verify.schemaVersion,
  };

  return {
    id: FAKE_PROVIDER_ID,
    displayName: FAKE_DISPLAY_NAME,
    calls,
    async extract(req, opts) {
      const index = calls.extract.length;
      calls.extract.push(structuredClone(req));
      calls.extractPrompts.push(buildExtractPrompt(req));
      const step = nextStep(script.extract, req, index);
      return runStep(step, opts?.signal, extractBase, () => defaultExtract(req));
    },
    async verifySupport(req, opts) {
      const index = calls.verifySupport.length;
      calls.verifySupport.push(structuredClone(req));
      calls.verifySupportPrompts.push(buildSupportPrompt(req));
      const step = nextStep(script.verifySupport, req, index);
      return runStep(step, opts?.signal, verifyBase, () => defaultVerify(req));
    },
  };
}

function nextStep<Req>(source: FakeStepSource<Req> | undefined, req: Req, index: number): FakeStep {
  if (source === undefined) return { kind: "default" };
  if (typeof source === "function") return source(req, index);
  return source[index] ?? { kind: "default" };
}

async function runStep(
  step: FakeStep,
  signal: AbortSignal | undefined,
  base: AiProvenance,
  fallback: () => unknown,
): Promise<Result<AiCallResult>> {
  if (signal?.aborted) return { ok: false, error: abortedError(signal) };

  if (step.kind === "hang") {
    if (!signal) {
      return { ok: false, error: aiError({ code: "internal", reason: AI_ERROR_REASONS.aborted, retryable: false, message: "Test adapter: a hang step needs an abort signal." }) };
    }
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return { ok: false, error: abortedError(signal) };
  }

  if (step.delayMs !== undefined && step.delayMs > 0) {
    const aborted = await delay(step.delayMs, signal);
    if (aborted && signal) return { ok: false, error: abortedError(signal) };
  }

  switch (step.kind) {
    case "error":
      return { ok: false, error: step.error };
    case "tool_call":
      return { ok: false, error: toolCallRejectedError(step.providerRequestId) };
    case "raw": {
      const model = step.reportedModel === undefined ? base.requestedModel : step.reportedModel;
      return {
        ok: true,
        data: {
          raw: step.raw,
          provenance: { ...base, model, ...step.provenance },
          meta: { providerRequestId: null, inputTokens: null, outputTokens: null, ...step.meta },
        },
      };
    }
    case "default":
      return {
        ok: true,
        data: {
          raw: fallback(),
          provenance: { ...base, model: base.requestedModel },
          meta: { providerRequestId: null, inputTokens: null, outputTokens: null },
        },
      };
  }
}

/** Resolves true if the signal aborted first. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ── Default extraction (deterministic keyword rules) ─────────────────────────

const RULES: ReadonlyArray<{ category: PointCategory; pattern: RegExp; label: string }> = [
  { category: "decision", pattern: /\b(decided|agreed|we will go with|finali[sz]ed)\b/i, label: "Decision" },
  { category: "owner", pattern: /\b(in charge of|responsible for|handles|owns)\b/i, label: "Owner" },
  { category: "blocker", pattern: /\b(blocked|stuck|waiting on)\b/i, label: "Blocker" },
  { category: "risk", pattern: /\b(risk|might fail|could fail)\b/i, label: "Risk" },
  { category: "recurring_problem", pattern: /\b(again|every time|keeps happening)\b/i, label: "Recurring problem" },
  { category: "next_action", pattern: /\b(next step|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow))\b/i, label: "Next action" },
  { category: "open_task", pattern: /\b(todo|to do|need to|needs to|pending)\b/i, label: "Open task" },
];

let sentenceSegmenter: Intl.Segmenter | null = null;
const sentences = () => (sentenceSegmenter ??= new Intl.Segmenter("en", { granularity: "sentence" }));

/** One verbatim, trimmed sentence slice of `body` (exactly as it appears). */
function* sentenceSlices(body: string): Generator<string> {
  for (const seg of sentences().segment(body)) {
    for (const line of seg.segment.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length >= 12 && trimmed.split(/\s+/).length >= 3) yield trimmed;
    }
  }
}

function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("").trimEnd();
}

function defaultExtract(req: ExtractRequest): { candidates: unknown[] } {
  const allowed = new Set(req.categories);
  const candidates: unknown[] = [];
  for (const message of req.messages) {
    for (const sentence of sentenceSlices(message.body)) {
      const rule = RULES.find((r) => allowed.has(r.category) && r.pattern.test(sentence));
      if (!rule || sentence.length > EXTRACTION_QUOTE_MAX) continue;
      candidates.push({
        category: rule.category,
        title: truncate(`${rule.label}: ${sentence}`, EXTRACTION_TITLE_MAX),
        statement: truncate(sentence, EXTRACTION_STATEMENT_MAX),
        attributes: rule.category === "owner" ? { responsibility: truncate(sentence, 200) } : {},
        citations: [{ messageId: message.id, quote: sentence, stance: "supports" }],
        inferenceRationale: null,
      });
      if (candidates.length >= EXTRACTION_CANDIDATES_MAX) return { candidates };
    }
  }
  return { candidates };
}

// ── Default support verification (deterministic word overlap) ────────────────

let wordSegmenter: Intl.Segmenter | null = null;
const wordSeg = () => (wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" }));

function wordSet(s: string): Set<string> {
  const out = new Set<string>();
  for (const seg of wordSeg().segment(s.toLowerCase())) if (seg.isWordLike) out.add(seg.segment);
  return out;
}

const NEGATION = /\b(not|never|no longer|cancel(?:led|ed)?|won't|isn't|doesn't)\b/i;

function defaultVerify(req: VerifySupportRequest): { verdict: string; rationale: string } {
  const claimWords = wordSet(req.claim.statement);
  if (claimWords.size === 0) return { verdict: "irrelevant", rationale: "Test adapter: the claim has no words to compare." };
  const quoteWords = wordSet(req.quote.text);
  let shared = 0;
  for (const w of claimWords) if (quoteWords.has(w)) shared++;
  const overlap = shared / claimWords.size;
  const pct = Math.round(overlap * 100);
  if (overlap >= 0.3 && NEGATION.test(req.quote.text) !== NEGATION.test(req.claim.statement)) {
    return { verdict: "contradicts", rationale: `Test adapter: ${pct}% word overlap with opposite negation.` };
  }
  if (overlap >= 0.6) return { verdict: "supports", rationale: `Test adapter: ${pct}% word overlap.` };
  if (overlap >= 0.3) return { verdict: "partial", rationale: `Test adapter: ${pct}% word overlap.` };
  return { verdict: "irrelevant", rationale: `Test adapter: ${pct}% word overlap.` };
}
