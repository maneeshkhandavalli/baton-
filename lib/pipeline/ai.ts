/**
 * The pipeline's view of lib/ai (I1 as amended by the W0 decisions). The stages depend on this interface,
 * so they run in tests with the fake adapter and a stubbed extract/verify, and `worker.ts` binds the real
 * functions.
 *
 * `ExtractOutcome`, `CheckedCandidate` and `SupportOutcome` mirror the amended I1 signatures of
 * `lib/ai/extract.ts` and `lib/ai/verify-support.ts` (A2). When A2 merges, `worker.ts` passes those
 * functions here; their types must stay assignable to these.
 */

import type {
  AiAttemptRecord,
  AiProvenance,
  AiProvider,
  AiResult,
  AiRunConfig,
  AiStageOptions,
  ExtractRequest,
  VerifySupportRequest,
} from "../ai/provider";
import type { AppError, Result } from "../contracts/api";
import type { SupportVerdict } from "../contracts/enums";
import type { ExtractionCandidate, ExtractionCitation } from "../contracts/schemas";
import { failure, type FailureReason, type PipelineFailure } from "./types";

export interface CheckedCitation extends ExtractionCitation {
  quoteCheck: "exact" | "normalized" | "not_found";
  quoteStart: number | null;
  quoteEnd: number | null;
  /** `body.slice(quoteStart, quoteEnd)` for exact/normalized, null for not_found (I1 amendment 6). */
  matchedText: string | null;
}

type WithCheckedCitations<C> = C extends unknown ? Omit<C, "citations"> & { citations: CheckedCitation[] } : never;
export type CheckedCandidate = WithCheckedCitations<ExtractionCandidate>;

export interface ExtractOutcome {
  candidates: CheckedCandidate[];
  /** Counts by drop reason only, never content. */
  dropped: Record<string, number>;
  provenance: AiProvenance;
  attempt: AiAttemptRecord;
}

export interface SupportOutcome {
  verdict: Exclude<SupportVerdict, "unchecked">;
  rationale: string | null;
  provenance: AiProvenance;
  attempt: AiAttemptRecord;
}

export interface PipelineAi {
  /** `getAiProviderForRun`: provider_not_configured, or ai_config_changed against the run snapshot. */
  providerForRun(runConfig: AiRunConfig): Result<AiProvider>;
  extractCandidates(provider: AiProvider, req: ExtractRequest, opts: AiStageOptions): Promise<AiResult<ExtractOutcome>>;
  verifySupport(provider: AiProvider, req: VerifySupportRequest, opts: AiStageOptions): Promise<AiResult<SupportOutcome>>;
}

const AI_REASONS: ReadonlySet<string> = new Set<FailureReason>([
  "provider_not_configured",
  "ai_config_changed",
  "ai_invalid_output",
  "ai_tool_call",
  "ai_provider_error",
  "ai_timed_out",
  "ai_aborted",
  "ai_request_too_large",
  "stage_not_wired",
]);

/** A lib/ai failure as a pipeline failure: the reason token is kept when known, the code always. */
export function mapAiFailure(error: AppError): PipelineFailure {
  const reason = error.details?.reason;
  if (typeof reason === "string" && AI_REASONS.has(reason)) return failure(error.code, reason as FailureReason, error.retryable);
  return failure(error.code, error.retryable ? "ai_transient" : "ai_provider_error", error.retryable);
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
function stageConfig(v: unknown): AiRunConfig["extract"] | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  return str(s.model) && str(s.promptVersion) && str(s.schemaVersion)
    ? { model: s.model, promptVersion: s.promptVersion, schemaVersion: s.schemaVersion }
    : null;
}

/** The run's `ai_config` snapshot (§6.17), or null when it is not a valid AiRunConfig. */
export function parseRunConfig(raw: unknown): AiRunConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const extract = stageConfig(r.extract);
  const verify = stageConfig(r.verify);
  if (!str(r.provider) || !str(r.adapterVersion) || !extract || !verify) return null;
  return { provider: r.provider, adapterVersion: r.adapterVersion, extract, verify };
}

/** §11.8 rule 3: written to the job before the provider is called; `model` is unknown until a response. */
export function provenanceBeforeCall(rc: AiRunConfig, stage: "extract" | "verify"): AiProvenance {
  return {
    provider: rc.provider,
    adapterVersion: rc.adapterVersion,
    requestedModel: rc[stage].model,
    model: null,
    promptVersion: rc[stage].promptVersion,
    schemaVersion: rc[stage].schemaVersion,
  };
}

/** Until A2 merges: an AI stage fails the run loudly instead of pretending to have run. */
export const notWiredAi = async (): Promise<AiResult<never>> => ({
  ok: false,
  error: { code: "internal", message: "This processing stage is not available yet.", retryable: false, details: { reason: "stage_not_wired" } },
});
