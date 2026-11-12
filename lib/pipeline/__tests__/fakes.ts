// Test doubles for the pipeline: a scripted fake DbClient, a fake storage client and synthetic job
// contexts. Synthetic data only.

import { emptyDropCounts } from "../../ai/extract";
import type { AiAttemptRecord, AiProvenance, AiProvider, AiResult, AiRunConfig, ExtractRequest, VerifySupportRequest } from "../../ai/provider";
import { createFakeProvider, fakeRunConfig } from "../../ai/providers/fake";
import type { Result } from "../../contracts/api";
import type { DbClient } from "../../db/client";
import type { JobContext, RunJobState } from "../../db/pipeline";
import type { StorageClient } from "../../db/storage";
import type { ExtractOutcome, PipelineAi, SupportOutcome } from "../ai";

export const RUN_CONFIG: AiRunConfig = fakeRunConfig();

export function attemptRecord(attempt = 1): AiAttemptRecord {
  return {
    attempt,
    startedAt: "2026-11-12T00:00:00.000Z",
    finishedAt: "2026-11-12T00:00:01.000Z",
    outcome: "succeeded",
    errorCode: null,
    providerErrorType: null,
    httpStatus: null,
    providerRequestId: null,
    reportedModel: "fake-model",
    latencyMs: 1,
    inputTokens: null,
    outputTokens: null,
  };
}

export function provenance(stage: "extract" | "verify"): AiProvenance {
  return {
    provider: RUN_CONFIG.provider,
    adapterVersion: RUN_CONFIG.adapterVersion,
    requestedModel: RUN_CONFIG[stage].model,
    model: RUN_CONFIG[stage].model,
    promptVersion: RUN_CONFIG[stage].promptVersion,
    schemaVersion: RUN_CONFIG[stage].schemaVersion,
  };
}

/**
 * A scripted stand-in for lib/ai's extractCandidates / verifySupport, for stage edge cases. The provider is
 * the real fake adapter; only the two A2 functions are scripted, per the amended I1 signatures.
 */
export function fakeAi(script: {
  provider?: Result<AiProvider>;
  extract?: (req: ExtractRequest, call: number) => AiResult<ExtractOutcome>;
  verify?: (req: VerifySupportRequest, call: number) => AiResult<SupportOutcome>;
} = {}) {
  const calls = { providerForRun: [] as AiRunConfig[], extract: [] as ExtractRequest[], verify: [] as VerifySupportRequest[] };
  const ai: PipelineAi = {
    providerForRun: (rc) => {
      calls.providerForRun.push(rc);
      return script.provider ?? { ok: true, data: createFakeProvider() };
    },
    extractCandidates: async (_p, req) => {
      calls.extract.push(req);
      return (
        script.extract?.(req, calls.extract.length - 1) ?? {
          ok: true,
          data: { candidates: [], dropped: emptyDropCounts(), provenance: provenance("extract"), attempt: attemptRecord() },
        }
      );
    },
    verifySupport: async (_p, req) => {
      calls.verify.push(req);
      return (
        script.verify?.(req, calls.verify.length - 1) ?? {
          ok: true,
          data: { verdict: "supports", rationale: null, provenance: provenance("verify"), attempt: attemptRecord() },
        }
      );
    },
  };
  return { ai, calls };
}

export const IDS = {
  handover: "5a2b3c4d-6e7f-4a81-9b2c-3d4e5f6a7b8c",
  run: "7c4d5e6f-8091-4ba3-8c4d-5e6f7a8b9c0d",
  source: "4f1c2a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  source2: "8d5e6f70-91a2-4cb4-9d5e-6f708192a3b4",
  job: "9e6f7081-a2b3-4dc5-8e6f-708192a3b4c5",
  rule: "a07f8192-b3c4-4ed6-9f70-8192a3b4c5d6",
  point1: "b1808293-c4d5-4fe7-8081-92a3b4c5d6e7",
  point2: "c29193a4-d5e6-4f08-9192-a3b4c5d6e7f8",
  point3: "d3a2a4b5-e6f7-4019-a2a3-b4c5d6e7f809",
} as const;

export interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

/** Marks a handler result as a PostgREST error with the given SQLSTATE. */
export function rpcError(code: string) {
  return { __rpcError: { code, message: "synthetic error" } };
}

type Handler = (args: Record<string, unknown>, calls: RpcCall[]) => unknown;

/** Unknown functions return null. `log` records every call in order (shared with fakeStorage). */
export function fakeDb(handlers: Record<string, Handler | unknown>, log: string[] = []) {
  const calls: RpcCall[] = [];
  const client: DbClient = {
    rpc: async (fn, args = {}) => {
      calls.push({ fn, args });
      log.push(`rpc:${fn}`);
      const h = handlers[fn];
      const value = typeof h === "function" ? (h as Handler)(args, calls) : (h ?? null);
      if (value && typeof value === "object" && "__rpcError" in value) {
        return { data: null, error: (value as { __rpcError: { code: string; message: string } }).__rpcError };
      }
      return { data: value ?? null, error: null };
    },
  };
  return { client, calls, log, called: (fn: string) => calls.filter((c) => c.fn === fn) };
}

export function fakeStorage(bytes: Uint8Array | null, log: string[] = [], removeError = false) {
  const removed: string[][] = [];
  const storage: StorageClient = {
    from: () => ({
      createSignedUploadUrl: async () => ({ data: null, error: { message: "unused" } }),
      download: async () => {
        log.push("storage:download");
        return bytes ? { data: new Blob([bytes as unknown as ArrayBuffer]), error: null } : { data: null, error: { message: "missing" } };
      },
      remove: async (paths: string[]) => {
        log.push("storage:remove");
        removed.push(paths);
        return { data: null, error: removeError ? { message: "synthetic" } : null };
      },
    }),
  };
  return { storage, removed };
}

export function claimed(stage: string, attempt = 1, sourceId: string | null = IDS.source) {
  return { id: IDS.job, handover_id: IDS.handover, run_id: IDS.run, source_id: sourceId, stage, attempt, max_attempts: 3 };
}

export function jobContext(
  stage: JobContext["job"]["stage"],
  overrides: {
    attempt?: number;
    status?: string;
    runStatus?: string;
    source?: Partial<NonNullable<JobContext["source"]>> | null;
    priorSucceeded?: boolean;
    handoverDeleted?: boolean;
  } = {},
): JobContext {
  const perSource = stage === "parse" || stage === "extract" || stage === "verify_quotes";
  return {
    job: {
      id: IDS.job,
      runId: IDS.run,
      handoverId: IDS.handover,
      sourceId: perSource ? IDS.source : null,
      stage,
      status: overrides.status ?? "running",
      attempt: overrides.attempt ?? 1,
      maxAttempts: 3,
      inputHash: "ab".repeat(32),
      progressDone: null,
      progressTotal: null,
    },
    run: {
      status: overrides.runStatus ?? "running",
      pipelineVersion: "pipeline@1",
      aiProvider: RUN_CONFIG.provider,
      aiConfig: { ...RUN_CONFIG },
      sourceIds: [IDS.source],
    },
    handover: { state: "processing", teamName: "Synthetic Robotics Club", roleTitle: null, deleted: overrides.handoverDeleted ?? false },
    source:
      overrides.source === null || !perSource
        ? null
        : {
            kind: "whatsapp_export",
            state: "uploaded",
            accessLevel: "everyone",
            timezone: "Asia/Kolkata",
            dateOrder: null,
            originalFilename: "chat.txt",
            rawAvailable: true,
            consentAiProvider: "fake",
            documentDate: null,
            deleted: false,
            ...overrides.source,
          },
    priorSucceeded: overrides.priorSucceeded ?? false,
  };
}

export function runJob(stage: RunJobState["stage"], status: RunJobState["status"], errorMessage: string | null = null, sourceId: string | null = null): RunJobState {
  return { id: `${stage}-${status}`, stage, sourceId, status, attempt: 1, maxAttempts: 3, errorCode: errorMessage ? "processing_failed" : null, errorMessage };
}

export interface StoredPoint {
  id: string;
  chunkIndex: number;
  accessLevel: unknown;
  provenance: unknown;
  point: Record<string, unknown>;
}
export interface StoredEvidence {
  pointId: string;
  messageId: string;
  quote: string;
  quoteStart: number | null;
  quoteEnd: number | null;
}

/**
 * In-memory stand-in for `pipeline_store_extract_chunk` (DB-13), with the SQL semantics: chunks in
 * order with an idempotent repeat below the checkpoint; a citation `reject` refuses is dropped and
 * counted; a NEW point whose citations were all dropped is not stored unless it carries an inference
 * rationale. `fail(chunkIndex)` makes the whole call fail (nothing stored).
 */
export function fakeChunkStore(
  opts: { reject?: (citation: Record<string, unknown>) => boolean; fail?: (chunkIndex: number) => unknown; startAt?: number; idBase?: number } = {},
) {
  const points: StoredPoint[] = [];
  const evidence: StoredEvidence[] = [];
  const calls: Array<Record<string, unknown>> = [];
  let done = opts.startAt ?? 0;
  let seq = 0;
  const idBase = opts.idBase ?? 500;
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const handler = (args: Record<string, unknown>) => {
    calls.push(args);
    const index = args.p_chunk_index as number;
    const failure = opts.fail?.(index);
    if (failure) return failure;
    if (index < done) return { alreadyCommitted: true, entries: [] };
    if (index > done) return rpcError("BTVF0");
    const pending = { points: [] as StoredPoint[], evidence: [] as StoredEvidence[] };
    const results = (args.p_entries as Array<Record<string, unknown>>).map((e) => {
      const cites = (e.citations as Array<Record<string, unknown>>) ?? [];
      const isNew = e.pointId === null;
      const pointId = isNew ? id(idBase + seq + pending.points.length + 1) : (e.pointId as string);
      const kept = cites.filter((c) => !opts.reject?.(c));
      const point = e.point as Record<string, unknown> | null;
      if (isNew && kept.length === 0 && !(typeof point?.inferenceRationale === "string" && point.inferenceRationale.trim())) {
        return { pointId: null, inserted: false, citations: 0, rejected: cites.length, skipped: false };
      }
      if (isNew) pending.points.push({ id: pointId, chunkIndex: index, accessLevel: args.p_access_level, provenance: args.p_ai_provenance, point: point ?? {} });
      for (const c of kept) {
        pending.evidence.push({ pointId, messageId: c.messageId as string, quote: c.quote as string, quoteStart: c.quoteStart as number | null, quoteEnd: c.quoteEnd as number | null });
      }
      return { pointId, inserted: isNew, citations: kept.length, rejected: cites.length - kept.length, skipped: false };
    });
    seq += pending.points.length;
    points.push(...pending.points);
    evidence.push(...pending.evidence);
    done = index + 1;
    return { alreadyCommitted: false, entries: results };
  };
  return { handler, points, evidence, calls, progress: () => done };
}
