/**
 * Shared start of an AI stage (§11.8 rules 3 and 5, §6.17): the provider for the run's `ai_config`
 * SNAPSHOT (never live configuration alone), and the job's provenance written before the first call.
 */

import type { AiProvider, AiRunConfig } from "../../ai/provider";
import { setJobProvenance } from "../../db/pipeline";
import { mapAiFailure, parseRunConfig, provenanceBeforeCall } from "../ai";
import { claimOf, type StageContext } from "../stage-context";
import { failure, type PipelineFailure } from "../types";

export type AiPrelude = { ok: true; provider: AiProvider; runConfig: AiRunConfig } | { ok: false; failure: PipelineFailure };

export async function startAiStage(ctx: StageContext, stage: "extract" | "verify"): Promise<AiPrelude> {
  const runConfig = parseRunConfig(ctx.job.run.aiConfig);
  if (!runConfig || runConfig.provider !== ctx.job.run.aiProvider) {
    return { ok: false, failure: failure("precondition_failed", "ai_config_changed") };
  }
  const provider = ctx.ai.providerForRun(runConfig);
  if (!provider.ok) return { ok: false, failure: mapAiFailure(provider.error) };
  if (provider.data.id !== runConfig.provider) return { ok: false, failure: failure("precondition_failed", "ai_config_changed") };
  await setJobProvenance(ctx.db, claimOf(ctx), { ...provenanceBeforeCall(runConfig, stage) });
  return { ok: true, provider: provider.data, runConfig };
}

const MIN_CALL_MS = 5_000;
const MAX_CALL_MS = 300_000; // never longer than a lease

/** Abort an AI call no later than the drain deadline (at least 5 s, at most one lease). */
export function callSignal(ctx: StageContext): AbortSignal {
  const remaining = ctx.deadlineAt - ctx.now();
  const ms = Number.isFinite(remaining) ? Math.floor(remaining) : MAX_CALL_MS;
  return AbortSignal.timeout(Math.min(MAX_CALL_MS, Math.max(MIN_CALL_MS, ms)));
}
