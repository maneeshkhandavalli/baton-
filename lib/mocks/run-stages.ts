/**
 * Per-stage progress of a mock processing run (pure; R3 Task 06 moved it out of ./store.ts so the store-parameterised
 * queries and the demo engine never import the process-wide dev store).
 */

import { PIPELINE_STAGES, type PipelineStage, type RunStatus } from "@/lib/contracts/enums";

import type { MockRun, MockStore } from "./types";


const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  parse: 0.18,
  extract: 0.32,
  verify_quotes: 0.1,
  verify_support: 0.2,
  analyze: 0.1,
  prepare_review: 0.1,
};

export interface StageProgress {
  stage: PipelineStage;
  /** `partial`: the run succeeded but some sources failed or were skipped at this stage (E4). */
  status: RunStatus | "partial";
  done: number;
  total: number;
}

export function runStages(store: MockStore, run: MockRun, now = Date.now()): StageProgress[] {
  const sources = store.sources.filter((s) => s.handoverId === run.handoverId && !s.removedAt);
  const messages = sources.reduce((n, s) => n + (s.basePreview?.stats.messagesKept ?? s.messageCount ?? 400), 0);
  const totals: Record<PipelineStage, number> = {
    parse: Math.max(1, sources.length),
    extract: Math.max(1, Math.ceil(messages / 400)),
    verify_quotes: 28,
    verify_support: 28,
    analyze: 1,
    prepare_review: 1,
  };
  const fraction = run.status === "succeeded" ? 1 : Math.min(1, (now - Date.parse(run.startedAt)) / run.durationMs);
  let cursor = 0;
  return PIPELINE_STAGES.map((stage) => {
    const start = cursor;
    cursor += STAGE_WEIGHTS[stage];
    if (run.status === "succeeded") {
      // Per-source stages of a source that failed to parse: the run still succeeded, so the stage is partial.
      const perSource = stage === "parse" || stage === "extract" || stage === "verify_quotes";
      const failedSources = sources.filter((s) => s.state === "failed").length;
      if (perSource && failedSources > 0) {
        const done = stage === "parse" ? Math.max(0, totals.parse - failedSources) : totals[stage];
        return { stage, status: "partial" as const, done, total: totals[stage] };
      }
      return { stage, status: "succeeded" as const, done: totals[stage], total: totals[stage] };
    }
    const raw = (fraction - start) / STAGE_WEIGHTS[stage];
    const local = Math.max(0, Math.min(1, raw > 0.9999 ? 1 : raw)); // weights don't sum exactly in floating point
    const status: RunStatus =
      run.status === "failed" || run.status === "cancelled"
        ? local >= 1
          ? "succeeded"
          : run.status
        : local >= 1
          ? "succeeded"
          : local > 0
            ? "running"
            : "queued";
    return { stage, status, done: Math.floor(local * totals[stage]), total: totals[stage] };
  });
}

