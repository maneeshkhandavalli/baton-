// Round 4 final fix (Agent C): S5 (completion and heartbeat carry the claim generation) and audit 4.8 (a reused
// extract carries the earlier run's coverage, progress and provenance instead of completing as 0/0).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMemoryLogger } from "../log";
import { createDrainer } from "../runner";
import type { StageHandler } from "../stage-context";
import { claimed, fakeAi, fakeDb, fakeStorage, jobContext, rpcError } from "./fakes";

const NOW = Date.UTC(2026, 10, 21, 1, 0, 0);
const STATUS: Record<string, string> = { succeeded: "succeeded", failed: "failed", retry: "queued", skipped: "cancelled", yield: "queued" };

function harness(opts: {
  stage: "extract" | "analyze";
  generation?: number;
  attempt?: number;
  priorSucceeded?: boolean;
  reuse?: unknown;
  handler?: StageHandler;
}) {
  let left = 1;
  const attempt = opts.attempt ?? 1;
  const db = fakeDb({
    claim_ready_processing_jobs: () => (left-- > 0 ? [claimed(opts.stage, attempt, undefined, opts.generation ?? attempt)] : []),
    get_processing_job_context: jobContext(opts.stage, { attempt, source: { state: "parsed" }, priorSucceeded: opts.priorSucceeded ?? false }),
    complete_processing_job: (args: Record<string, unknown>) => STATUS[args.p_outcome as string],
    heartbeat_processing_job: "running",
    pipeline_reuse_prior_extract: opts.reuse ?? null,
    list_run_jobs: { runStatus: "running", jobs: [] },
    finish_processing_run: null,
  });
  const logger = createMemoryLogger();
  let handlerCalled = false;
  const handler: StageHandler = opts.handler ?? (async () => ((handlerCalled = true), { kind: "succeeded" }));
  const drainer = createDrainer({
    db: db.client,
    storage: fakeStorage(null).storage,
    logger,
    getPepper: () => ({ ok: false, error: { code: "processing_failed", message: "x", retryable: true } }),
    now: () => NOW,
    handlers: { [opts.stage]: handler },
    ai: fakeAi().ai,
  });
  return { db, logger, run: () => drainer(), handlerCalled: () => handlerCalled };
}

describe("S5: completion and heartbeat are generation-fenced from TS", () => {
  it("passes the claim generation (not just the attempt) to complete_processing_job", async () => {
    const h = harness({ stage: "analyze", attempt: 1, generation: 4 });
    await h.run();
    const c = h.db.called("complete_processing_job");
    assert.equal(c.length, 1);
    assert.equal(c[0].args.p_attempt, 1);
    assert.equal(c[0].args.p_claim_generation, 4, "a reclaim after a yield reuses attempt 1 but has generation 4");
    assert.equal(c[0].rpcName, "complete_processing_claim", "the generation-checked function (one function per name)");
  });

  it("passes the claim generation to every heartbeat", async () => {
    const h = harness({
      stage: "analyze",
      generation: 3,
      handler: async (ctx) => {
        await ctx.heartbeat({ done: 1, total: 2 });
        return { kind: "succeeded" };
      },
    });
    await h.run();
    const hb = h.db.called("heartbeat_processing_job");
    assert.equal(hb.length, 1);
    assert.equal(hb[0].args.p_claim_generation, 3);
    assert.equal(hb[0].rpcName, "heartbeat_processing_claim");
    assert.equal(hb[0].args.p_attempt, 1);
  });

  it("an older claim without a generation falls back to the attempt-only call (no p_claim_generation key)", async () => {
    const h = harness({ stage: "analyze", generation: 0 });
    await h.run();
    const c = h.db.called("complete_processing_job")[0];
    assert.equal("p_claim_generation" in c.args, false);
    assert.equal(c.rpcName, undefined, "the attempt-only original complete_processing_job is called");
  });

  it("a stale completion refused by the database (BTCF0) is counted lost, never retried as success", async () => {
    let left = 1;
    const db = fakeDb({
      claim_ready_processing_jobs: () => (left-- > 0 ? [claimed("analyze", 1, undefined, 2)] : []),
      get_processing_job_context: jobContext("analyze", { attempt: 1 }),
      complete_processing_job: rpcError("BTCF0"),
      list_run_jobs: { runStatus: "running", jobs: [] },
    });
    const drainer = createDrainer({
      db: db.client,
      storage: fakeStorage(null).storage,
      logger: createMemoryLogger(),
      getPepper: () => ({ ok: false, error: { code: "processing_failed", message: "x", retryable: true } }),
      now: () => NOW,
      handlers: { analyze: async () => ({ kind: "succeeded" }) },
      ai: fakeAi().ai,
    });
    const r = await drainer();
    assert.equal(r.lost, 1);
    assert.equal(r.succeeded, 0);
    assert.equal(db.called("list_run_jobs").length, 0, "a lost completion never finishes the run");
  });
});

describe("audit 4.8: a reused extract carries coverage, progress and provenance", () => {
  it("does not call the AI, asks the database to carry the prior run's coverage, and completes with its real progress", async () => {
    const h = harness({
      stage: "extract",
      generation: 1,
      priorSucceeded: true,
      reuse: { reused: true, priorRunId: "r-cancelled", priorRunStatus: "cancelled", progressDone: 22, progressTotal: 22, coverageCopied: true, chunkStats: 22 },
    });
    const r = await h.run();
    assert.equal(r.succeeded, 1);
    assert.equal(h.handlerCalled(), false, "the extract handler (AI) is not run");
    const reuse = h.db.called("pipeline_reuse_prior_extract");
    assert.equal(reuse.length, 1);
    assert.equal(reuse[0].args.p_claim_generation, 1, "the reuse write is fenced by the claim");
    const c = h.db.called("complete_processing_job")[0].args;
    assert.equal(c.p_outcome, "succeeded");
    assert.equal(c.p_progress_done, 22);
    assert.equal(c.p_progress_total, 22, "never a fabricated 0 of 0");
    const log = h.logger.records.find((e) => e.event === "extract_reused");
    assert.ok(log, "the reuse is logged");
    assert.equal(log.priorRunStatus, "cancelled");
    assert.equal(log.coverageCopied, true);
  });

  it("when the earlier run recorded no progress, completes without progress (not 0/0)", async () => {
    const h = harness({ stage: "extract", priorSucceeded: true, reuse: { reused: true, progressDone: 0, progressTotal: 0, coverageCopied: false } });
    await h.run();
    const c = h.db.called("complete_processing_job")[0].args;
    assert.equal(c.p_outcome, "succeeded");
    assert.equal(c.p_progress_done, null);
    assert.equal(c.p_progress_total, null);
  });

  it("an older database without the function still completes the job, without progress", async () => {
    const h = harness({ stage: "extract", priorSucceeded: true, reuse: rpcError("PGRST202") });
    const r = await h.run();
    assert.equal(r.succeeded, 1);
    assert.equal(h.db.called("complete_processing_job")[0].args.p_progress_done, null);
  });

  it("a stale claim refused by the reuse writer (BTLL0) is lost and records nothing", async () => {
    const h = harness({ stage: "extract", priorSucceeded: true, reuse: rpcError("BTLL0") });
    const r = await h.run();
    assert.equal(r.lost, 1);
    assert.equal(h.db.called("complete_processing_job").length, 0);
  });
});
