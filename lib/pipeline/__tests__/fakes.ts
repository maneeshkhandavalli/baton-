// Test doubles for the pipeline: a scripted fake DbClient, a fake storage client and synthetic job
// contexts. Synthetic data only.

import type { DbClient } from "../../db/client";
import type { JobContext, RunJobState } from "../../db/pipeline";
import type { StorageClient } from "../../db/storage";

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
      aiProvider: "fake",
      aiConfig: {},
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
