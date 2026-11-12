// E4: retry/failure recovery, multi-source runs and stale-claim recovery, driven through the real drain loop
// and the real extract stage over a stateful fake database (job states, checkpoints and the DB-13 chunk
// writer behave like the SQL). Synthetic data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyDropCounts } from "../../ai/extract";
import type { ExtractRequest } from "../../ai/provider";
import type { DbClient } from "../../db/client";
import type { ExtractionMessage, JobContext, RunJobState } from "../../db/pipeline";
import type { CheckedCandidate, ExtractOutcome } from "../ai";
import { createMemoryLogger } from "../log";
import { createDrainer } from "../runner";
import { attemptRecord, fakeAi, fakeChunkStore, fakeStorage, IDS, jobContext, provenance, rpcError } from "./fakes";

const NOW = Date.UTC(2026, 10, 13, 1, 0, 0);
const SRC_A = IDS.source;
const SRC_B = IDS.source2;
const id = (prefix: number, n: number) => `00000000-0000-4000-${String(8000 + prefix)}-${String(n).padStart(12, "0")}`;

function messages(prefix: number, count: number): ExtractionMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: id(prefix, i),
    seq: i,
    conversationLocalId: "c_1",
    authorLabel: "Participant 1",
    sentAt: null,
    kind: "text" as const,
    body: `synthetic message ${prefix}-${i} about the stall fees`,
  }));
}

interface JobState {
  id: string;
  sourceId: string;
  status: RunJobState["status"];
  attempt: number;
  progressDone: number | null;
  errorMessage: string | null;
  nextAttemptAt: string | null;
}

/** A stateful stand-in for the worker API over one run with one extract job per source. */
function world(sources: Array<{ sourceId: string; jobId: string; messages: ExtractionMessage[] }>, opts: { lostOnce?: string } = {}) {
  const jobs = new Map<string, JobState>(
    sources.map((s) => [s.jobId, { id: s.jobId, sourceId: s.sourceId, status: "queued", attempt: 0, progressDone: null, errorMessage: null, nextAttemptAt: null }]),
  );
  const stores = new Map(sources.map((s) => [s.jobId, fakeChunkStore({ idBase: 500 + 100 * sources.indexOf(s) })]));
  const finished: Array<Record<string, unknown>> = [];
  const completions: Array<Record<string, unknown>> = [];
  let lostOnce = opts.lostOnce;
  const runStatus = () => (finished.length > 0 ? "succeeded" : "running");

  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    list_finishable_runs: () => [],
    claim_ready_processing_jobs: () => {
      const j = [...jobs.values()].find((x) => x.status === "queued" && x.attempt < 3 && (!x.nextAttemptAt || Date.parse(x.nextAttemptAt) <= NOW + 3_600_000));
      if (!j || finished.length > 0) return [];
      j.status = "running";
      j.attempt += 1;
      return [{ id: j.id, handover_id: IDS.handover, run_id: IDS.run, source_id: j.sourceId, stage: "extract", attempt: j.attempt, max_attempts: 3 }];
    },
    get_processing_job_context: (a) => {
      const j = jobs.get(a.p_job_id as string)!;
      const base = jobContext("extract", { attempt: j.attempt, source: { state: "parsed" } });
      const ctx: JobContext = {
        ...base,
        job: { ...base.job, id: j.id, sourceId: j.sourceId, attempt: j.attempt, status: j.status, progressDone: j.progressDone },
        run: { ...base.run, sourceIds: sources.map((s) => s.sourceId) },
      };
      return ctx;
    },
    list_extraction_messages: (a) => {
      const s = sources.find((x) => x.sourceId === a.p_source_id)!;
      return { accessLevel: "everyone", messages: s.messages.filter((m) => m.seq > (a.p_after_seq as number)).slice(0, a.p_limit as number) };
    },
    list_points_for_pipeline: () => [],
    pipeline_set_job_provenance: () => null,
    heartbeat_processing_job: (a) => {
      const j = jobs.get(a.p_job_id as string)!;
      if (a.p_progress_done !== null && a.p_progress_done !== undefined) j.progressDone = a.p_progress_done as number;
      return j.status === "running" && j.attempt === a.p_attempt ? "running" : "lost";
    },
    pipeline_store_extract_chunk: (a) => {
      const j = jobs.get(a.p_job_id as string)!;
      if (j.status !== "running" || j.attempt !== a.p_attempt) return rpcError("BTLL0");
      if (lostOnce === j.id && a.p_chunk_index === 1) {
        // The lease expired and another worker reclaimed the job: this writer's claim is stale.
        lostOnce = undefined;
        j.status = "queued";
        return rpcError("BTLL0");
      }
      const r = stores.get(j.id)!.handler(a);
      j.progressDone = stores.get(j.id)!.progress();
      return r;
    },
    complete_processing_job: (a) => {
      completions.push(a);
      const j = jobs.get(a.p_job_id as string)!;
      if (j.status !== "running" || j.attempt !== a.p_attempt) return rpcError("BTCF0");
      if (a.p_progress_done !== null) j.progressDone = a.p_progress_done as number;
      j.errorMessage = (a.p_error_message as string | null) ?? null;
      j.nextAttemptAt = (a.p_next_attempt_at as string | null) ?? null;
      const outcome = a.p_outcome as string;
      j.status = outcome === "succeeded" ? "succeeded" : outcome === "failed" ? "failed" : j.attempt < 3 ? "queued" : "failed";
      return j.status;
    },
    list_run_jobs: () => ({
      runStatus: runStatus(),
      jobs: [...jobs.values()].map((j) => ({ id: j.id, stage: "extract", sourceId: j.sourceId, status: j.status, attempt: j.attempt, maxAttempts: 3, errorCode: null, errorMessage: j.errorMessage })),
    }),
    finish_processing_run: (a) => {
      finished.push(a);
      return null;
    },
  };
  const client: DbClient = {
    rpc: async (fn, args = {}) => {
      const h = handlers[fn];
      const value = h ? h(args) : null;
      if (value && typeof value === "object" && "__rpcError" in value) return { data: null, error: (value as { __rpcError: { code: string; message: string } }).__rpcError };
      return { data: value ?? null, error: null };
    },
  };
  return { client, jobs, stores, finished, completions };
}

const ok = (candidates: CheckedCandidate[]): { ok: true; data: ExtractOutcome } => ({
  ok: true,
  data: { candidates, dropped: emptyDropCounts(), provenance: provenance("extract"), attempt: attemptRecord() },
});

/** One owner candidate per chunk, citing the chunk's first message (so every chunk stores one point). */
function candidateFor(req: ExtractRequest): CheckedCandidate {
  const m = req.messages[0];
  return {
    category: "decision",
    title: `Decision from ${m.id}`,
    statement: `Decision recorded in ${m.id}.`,
    attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] },
    citations: [{ messageId: m.id, quote: m.body.slice(0, 20), stance: "supports", quoteCheck: "exact", quoteStart: 0, quoteEnd: 20, matchedText: m.body.slice(0, 20) }],
    inferenceRationale: null,
  } as CheckedCandidate;
}

const transient = { ok: false as const, error: { code: "processing_failed" as const, message: "x", retryable: true, details: { reason: "ai_timed_out" } }, attempt: attemptRecord(1) };
const fatalOutput = { ok: false as const, error: { code: "processing_failed" as const, message: "x", retryable: false, details: { reason: "ai_invalid_output" } }, attempt: attemptRecord(1) };

function drainer(client: DbClient, ai: ReturnType<typeof fakeAi>["ai"]) {
  return createDrainer({
    db: client,
    storage: fakeStorage(null).storage,
    logger: createMemoryLogger(),
    getPepper: () => ({ ok: false, error: { code: "processing_failed", message: "x", retryable: true } }),
    now: () => NOW,
    ai,
  });
}

describe("E4: retry and failure recovery", () => {
  it("a transient failure is retried with backoff, resumes at the committed chunk and reaches succeeded without duplicates", async () => {
    const w = world([{ sourceId: SRC_A, jobId: IDS.job, messages: messages(1, 450) }]);
    let failNext = true;
    const { ai, calls } = fakeAi({
      extract: (req) => {
        if (req.messages[0].id === id(1, 200) && failNext) {
          failNext = false;
          return transient;
        }
        return ok([candidateFor(req)]);
      },
    });
    const first = await drainer(w.client, ai)({ maxJobs: 1 });
    assert.equal(first.retried, 1);
    const retry = w.completions[0];
    assert.equal(retry.p_outcome, "retry");
    assert.equal(retry.p_error_message, "ai_timed_out", "a reason token, never content");
    assert.equal(retry.p_next_attempt_at, new Date(NOW + 30_000).toISOString(), "backoff: 30 s after the first attempt");
    assert.equal(retry.p_progress_done, 1, "the checkpoint is the committed chunk");
    assert.equal(w.jobs.get(IDS.job)!.status, "queued");
    assert.equal(w.finished.length, 0, "the run stays running (accurately) while a retry is pending");

    const second = await drainer(w.client, ai)({ maxJobs: 1 });
    assert.equal(second.succeeded, 1);
    assert.equal(w.jobs.get(IDS.job)!.attempt, 2);
    assert.deepEqual(calls.extract.map((r) => r.messages[0].id), [id(1, 0), id(1, 200), id(1, 200), id(1, 400)], "chunk 0 is never re-sent");
    const store = w.stores.get(IDS.job)!;
    assert.equal(store.points.length, 3, "one point per chunk, none duplicated");
    assert.deepEqual(store.calls.map((c) => c.p_chunk_index), [0, 1, 2]);
    assert.deepEqual(w.finished, [{ p_run_id: IDS.run, p_status: "succeeded", p_error_code: null, p_error_message: null }]);
  });

  it("retries stop at max_attempts: the job and then the run fail with a reason token", async () => {
    const w = world([{ sourceId: SRC_A, jobId: IDS.job, messages: messages(1, 3) }]);
    const { ai } = fakeAi({ extract: () => transient });
    for (let i = 0; i < 3; i++) await drainer(w.client, ai)({ maxJobs: 1 });
    assert.deepEqual(w.completions.map((c) => c.p_outcome), ["retry", "retry", "retry"]);
    assert.equal(w.jobs.get(IDS.job)!.status, "failed", "the database turns the last retry into failed");
    assert.equal(w.finished[0].p_status, "failed");
    assert.equal(w.finished[0].p_error_message, "no_source_succeeded");
    assert.equal(w.stores.get(IDS.job)!.points.length, 0);
  });

  it("a stale claim mid-job stores nothing more, records nothing, and the reclaimed attempt finishes without duplicates", async () => {
    const w = world([{ sourceId: SRC_A, jobId: IDS.job, messages: messages(1, 450) }], { lostOnce: IDS.job });
    const { ai } = fakeAi({ extract: (req) => ok([candidateFor(req)]) });
    const first = await drainer(w.client, ai)({ maxJobs: 1 });
    assert.equal(first.lost, 1);
    assert.equal(w.completions.length, 0, "a superseded worker records no completion");
    assert.equal(w.stores.get(IDS.job)!.points.length, 1, "only the chunk committed under the valid claim");

    const second = await drainer(w.client, ai)({ maxJobs: 1 });
    assert.equal(second.succeeded, 1);
    assert.equal(w.stores.get(IDS.job)!.points.length, 3, "the new attempt resumes at the checkpoint");
    assert.equal(w.finished[0].p_status, "succeeded");
  });
});

describe("E4: multi-source runs", () => {
  it("every source is processed and one failing source does not affect the other's points; the run succeeds", async () => {
    const jobB = "9e6f7081-a2b3-4dc5-8e6f-708192a3b4c6";
    const w = world([
      { sourceId: SRC_A, jobId: IDS.job, messages: messages(1, 3) },
      { sourceId: SRC_B, jobId: jobB, messages: messages(2, 3) },
    ]);
    const { ai, calls } = fakeAi({ extract: (req) => (req.messages[0].id.startsWith("00000000-0000-4000-8001") ? fatalOutput : ok([candidateFor(req)])) });
    const report = await drainer(w.client, ai)({ maxJobs: 5 });
    assert.equal(report.claimed, 2, "both sources were processed");
    assert.equal(report.failed, 1);
    assert.equal(report.succeeded, 1);
    assert.equal(calls.extract.length, 2);
    assert.equal(w.jobs.get(IDS.job)!.status, "failed");
    assert.equal(w.jobs.get(IDS.job)!.errorMessage, "ai_invalid_output");
    assert.equal(w.stores.get(IDS.job)!.points.length, 0, "the failing source stored nothing");
    assert.equal(w.stores.get(jobB)!.points.length, 1, "the other source's point is intact");
    for (const e of w.stores.get(jobB)!.evidence) assert.ok(e.messageId.startsWith("00000000-0000-4000-8002"), "evidence only from its own source");
    assert.deepEqual(w.finished.map((f) => f.p_status), ["succeeded"], "partial success: the run succeeds; the failed source stays visible on its job");
  });

  it("when every source fails, the run fails with no_source_succeeded", async () => {
    const jobB = "9e6f7081-a2b3-4dc5-8e6f-708192a3b4c6";
    const w = world([
      { sourceId: SRC_A, jobId: IDS.job, messages: messages(1, 3) },
      { sourceId: SRC_B, jobId: jobB, messages: messages(2, 3) },
    ]);
    const { ai } = fakeAi({ extract: () => fatalOutput });
    await drainer(w.client, ai)({ maxJobs: 5 });
    assert.equal(w.finished.length, 1);
    assert.equal(w.finished[0].p_status, "failed");
    assert.equal(w.finished[0].p_error_message, "no_source_succeeded");
  });
});
