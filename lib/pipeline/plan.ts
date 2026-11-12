/**
 * Run planning (I2, §9.3, §10). Pure: no I/O, no clock, no environment.
 *
 * Plan (W0 decision I2.2): per included source `parse` (unparsed sources only) → `extract` →
 * `verify_quotes`; then per handover `verify_support` → `analyze` → `prepare_review`.
 *
 * Included sources mirror `start_processing`: `parsed`, or `uploaded`/`failed` with the raw upload still
 * present. `inputHash` is SHA-256 over canonical JSON of the stage, the pipeline version, the source id
 * (or the sorted source ids for handover-level stages) and, for AI stages, the provider, adapter version and
 * the stage's model, prompt version and schema version (§9.3, §11.8 rule 3). The source id is the content
 * key: `(handover_id, sha256)` is unique and a changed file is uploaded as a new source.
 */

import { createHash } from "node:crypto";

import type { AiRunConfig } from "../ai/provider";
import type { AppError, Result } from "../contracts/api";
import type { PipelineStage, SourceState } from "../contracts/enums";

export const PIPELINE_VERSION = "pipeline@1";

export type { AiRunConfig };
type StageModelConfig = AiRunConfig["extract"];

export interface PlannedJob {
  stage: PipelineStage;
  sourceId: string | null;
  inputHashHex: string;
}

export interface PlanSource {
  id: string;
  state: SourceState;
  rawAvailable: boolean;
}

export interface PlanInput {
  handoverId: string;
  sources: ReadonlyArray<PlanSource>;
  aiConfig: AiRunConfig;
}

export interface ProcessingPlan {
  pipelineVersion: string;
  aiConfig: AiRunConfig;
  jobs: PlannedJob[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(field: string): Result<never> {
  const error: AppError = {
    code: "validation_failed",
    message: "Some of the information is not valid.",
    fieldErrors: { [field]: ["invalid"] },
    retryable: false,
  };
  return { ok: false, error };
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 200;

function validStageConfig(c: unknown): c is StageModelConfig {
  if (!c || typeof c !== "object") return false;
  const s = c as Record<string, unknown>;
  return nonEmpty(s.model) && nonEmpty(s.promptVersion) && nonEmpty(s.schemaVersion);
}

/** Canonical JSON: object keys sorted, so the same values always give the same hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function stageHash(stage: PipelineStage, scope: { sourceId: string } | { sourceIds: string[] }, ai: AiRunConfig): string {
  const material: Record<string, unknown> = { v: 1, stage, pipelineVersion: PIPELINE_VERSION, ...scope };
  if (stage === "extract") material.ai = { provider: ai.provider, adapterVersion: ai.adapterVersion, ...ai.extract };
  if (stage === "verify_support") material.ai = { provider: ai.provider, adapterVersion: ai.adapterVersion, ...ai.verify };
  return sha256Hex(canonicalJson(material));
}

/** True when `start_processing` would include the source in the run's scope. */
export function isIncludedSource(s: PlanSource): boolean {
  return s.state === "parsed" || ((s.state === "uploaded" || s.state === "failed") && s.rawAvailable);
}

export function planProcessingRun(input: PlanInput): Result<ProcessingPlan> {
  if (!input || typeof input !== "object") return invalid("input");
  if (typeof input.handoverId !== "string" || !UUID.test(input.handoverId)) return invalid("handoverId");
  const ai = input.aiConfig;
  if (!ai || !nonEmpty(ai.provider) || !nonEmpty(ai.adapterVersion)) return invalid("aiConfig");
  if (!validStageConfig(ai.extract)) return invalid("aiConfig.extract");
  if (!validStageConfig(ai.verify)) return invalid("aiConfig.verify");
  if (!Array.isArray(input.sources)) return invalid("sources");

  const seen = new Set<string>();
  for (const [i, s] of input.sources.entries()) {
    if (!s || typeof s.id !== "string" || !UUID.test(s.id) || seen.has(s.id.toLowerCase())) return invalid(`sources[${i}]`);
    seen.add(s.id.toLowerCase());
  }

  const included = input.sources.filter(isIncludedSource);
  if (included.length === 0) {
    return {
      ok: false,
      error: {
        code: "precondition_failed",
        message: "This can't be done yet.",
        retryable: false,
        details: { reason: "no_source_ready" },
      },
    };
  }

  const jobs: PlannedJob[] = [];
  for (const s of included) {
    const scope = { sourceId: s.id.toLowerCase() };
    if (s.state !== "parsed") jobs.push({ stage: "parse", sourceId: s.id, inputHashHex: stageHash("parse", scope, ai) });
    jobs.push({ stage: "extract", sourceId: s.id, inputHashHex: stageHash("extract", scope, ai) });
    jobs.push({ stage: "verify_quotes", sourceId: s.id, inputHashHex: stageHash("verify_quotes", scope, ai) });
  }
  const sourceIds = included.map((s) => s.id.toLowerCase()).sort();
  for (const stage of ["verify_support", "analyze", "prepare_review"] as const) {
    jobs.push({ stage, sourceId: null, inputHashHex: stageHash(stage, { sourceIds }, ai) });
  }

  const aiConfig: AiRunConfig = {
    provider: ai.provider,
    adapterVersion: ai.adapterVersion,
    extract: { model: ai.extract.model, promptVersion: ai.extract.promptVersion, schemaVersion: ai.extract.schemaVersion },
    verify: { model: ai.verify.model, promptVersion: ai.verify.promptVersion, schemaVersion: ai.verify.schemaVersion },
  };
  return { ok: true, data: { pipelineVersion: PIPELINE_VERSION, aiConfig, jobs } };
}
