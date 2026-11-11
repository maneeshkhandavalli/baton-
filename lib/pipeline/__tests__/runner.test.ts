// The drain loop over the fenced lib/db worker API (DB-1 to DB-4, DB-14), with fake handlers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DbError } from "../../db/errors";
import type { JobContext, RunJobState } from "../../db/pipeline";
import { createMemoryLogger } from "../log";
import { classifyError, createDrainer } from "../runner";
import type { StageHandler } from "../stage-context";
import { LeaseLostError, type StageOutcome } from "../types";
import { claimed, fakeDb, fakeStorage, IDS, jobContext, rpcError, runJob } from "./fakes";

const NOW = Date.UTC(2026, 10, 12, 1, 0, 0);
const OUTCOME_STATUS: Record<string, string> = { succeeded: "succeeded", failed: "failed", retry: "queued", skipped: "cancelled", yield: "queued" };

function drain(opts: {
  stage: JobContext["job"]["stage"];
  ctx?: JobContext;
  handler?: StageHandler;
  runJobs?: RunJobState[];
  runStatus?: string;
  complete?: unknown;
  finish?: unknown;
  heartbeat?: string;
  claims?: number;
  attempt?: number;
}) {
  let claimsLeft = opts.claims ?? 1;
  const db = fakeDb({
    claim_ready_processing_jobs: () => (claimsLeft-- > 0 ? [claimed(opts.stage, opts.attempt ?? 1)] : []),
    get_processing_job_context: opts.ctx ?? jobContext(opts.stage, { attempt: opts.attempt ?? 1, source: { state: "parsed" } }),
    complete_processing_job: (args: Record<string, unknown>) => opts.complete ?? OUTCOME_STATUS[args.p_outcome as string],
    heartbeat_processing_job: opts.heartbeat ?? "running",
    list_run_jobs: { runStatus: opts.runStatus ?? "running", jobs: opts.runJobs ?? [] },
    finish_processing_run: opts.finish ?? null,
  });
  const { storage } = fakeStorage(null);
  const logger = createMemoryLogger();
  const handler: StageHandler = opts.handler ?? (async () => ({ kind: "succeeded" }));
  const drainer = createDrainer({
    db: db.client,
    storage,
    logger,
    getPepper: () => ({ ok: false, error: { code: "processing_failed", message: "x", retryable: true } }),
    now: () => NOW,
    handlers: { [opts.stage]: handler },
  });
  return { db, logger, run: (o?: Parameters<typeof drainer>[0]) => drainer(o) };
}

const completion = (db: ReturnType<typeof fakeDb>) => db.called("complete_processing_job").map((c) => c.args);

describe("drain loop", () => {
  it("does nothing when no job is ready", async () => {
    const { db, run } = drain({ stage: "analyze", claims: 0 });
    assert.deepEqual(await run(), { claimed: 0, succeeded: 0, retried: 0, failed: 0, deferred: 0, skipped: 0, lost: 0 });
    assert.equal(db.called("claim_ready_processing_jobs")[0].args.p_lease_seconds, 300);
  });

  it("records exactly one fenced completion per job with the claim's attempt", async () => {
    const { db, run } = drain({ stage: "analyze", attempt: 2, handler: async () => ({ kind: "succeeded", progress: { done: 1, total: 1 } }) });
    const r = await run();
    assert.equal(r.succeeded, 1);
    assert.deepEqual(completion(db), [
      { p_job_id: IDS.job, p_attempt: 2, p_outcome: "succeeded", p_attempt_record: null, p_error_code: null, p_error_message: null, p_next_attempt_at: null, p_progress_done: 1, p_progress_total: 1 },
    ]);
  });

  it("respects maxJobs and the deadline", async () => {
    const a = drain({ stage: "analyze", claims: 10 });
    assert.equal((await a.run({ maxJobs: 3 })).claimed, 3);
    const b = drain({ stage: "analyze", claims: 10 });
    assert.equal((await b.run({ deadlineMs: 10_000 })).claimed, 0, "no claim with less than the minimum time left");
    assert.equal(b.db.called("claim_ready_processing_jobs").length, 0);
  });

  it("drops a claim that is no longer ours, or whose run ended, without recording anything", async () => {
    for (const ctx of [
      jobContext("analyze", { attempt: 2 }),
      jobContext("analyze", { status: "queued" }),
      jobContext("analyze", { runStatus: "cancelled" }),
    ]) {
      let called = false;
      const { db, run } = drain({ stage: "analyze", ctx, handler: async () => ((called = true), { kind: "succeeded" }) });
      const r = await run();
      assert.equal(r.lost, 1);
      assert.equal(called, false);
      assert.equal(completion(db).length, 0);
    }
  });

  it("treats a refused completion (lease lost) as lost and does not finish the run", async () => {
    const { db, run } = drain({ stage: "analyze", complete: rpcError("BTCF0") });
    const r = await run();
    assert.equal(r.lost, 1);
    assert.equal(db.called("list_run_jobs").length, 0);
  });

  it("a lost heartbeat stops the handler and records nothing", async () => {
    const handler: StageHandler = async (ctx) => {
      await ctx.heartbeat({ done: 1, total: 2 });
      throw new Error("unreachable");
    };
    const { db, run } = drain({ stage: "analyze", heartbeat: "lost", handler });
    assert.equal((await run()).lost, 1);
    assert.equal(completion(db).length, 0);
  });

  it("retries a retryable failure with backoff; a final retry becomes failed in the database", async () => {
    const { db, run } = drain({ stage: "analyze", handler: async () => ({ kind: "failed", failure: { code: "processing_failed", reason: "ai_transient", retryable: true } }) });
    const r = await run();
    assert.equal(r.retried, 1);
    const [c] = completion(db);
    assert.equal(c.p_outcome, "retry");
    assert.equal(c.p_error_message, "ai_transient");
    assert.equal(c.p_next_attempt_at, new Date(NOW + 30_000).toISOString());
  });

  it("maps thrown errors to typed failures", () => {
    assert.deepEqual(classifyError(new LeaseLostError()), { kind: "lost" });
    const cases: Array<[unknown, string, string, boolean]> = [
      [new DbError("conflict", "40001", true), "conflict", "db_transient", true],
      [new DbError("internal"), "processing_failed", "db_transient", true],
      [new DbError("invalid_transition", "BTIT0"), "invalid_transition", "run_inactive", false],
      [new DbError("validation_failed", "BTVF0"), "validation_failed", "db_rejected", false],
      [new Error("defect"), "internal", "internal", false],
    ];
    for (const [e, code, reason, retryable] of cases) {
      assert.deepEqual(classifyError(e), { kind: "failed", failure: { code, reason, retryable } });
    }
  });

  it("skips extract and verify_quotes when the source did not parse", async () => {
    for (const stage of ["extract", "verify_quotes"] as const) {
      for (const source of [{ state: "failed" }, { state: "uploaded" }, { state: "parsed", deleted: true }]) {
        let called = false;
        const { db, run } = drain({ stage, ctx: jobContext(stage, { source }), handler: async () => ((called = true), { kind: "succeeded" }) });
        assert.equal((await run()).skipped, 1);
        assert.equal(called, false);
        assert.equal(completion(db)[0].p_outcome, "skipped");
      }
    }
  });

  it("an extract that already succeeded with the same input hash is a no-op", async () => {
    let called = false;
    const { db, run } = drain({
      stage: "extract",
      ctx: jobContext("extract", { source: { state: "parsed" }, priorSucceeded: true }),
      handler: async () => ((called = true), { kind: "succeeded" }),
    });
    assert.equal((await run()).succeeded, 1);
    assert.equal(called, false);
    assert.equal(completion(db)[0].p_outcome, "succeeded");
  });

  it("AI stages are not faked before I1 is wired: they fail the run", async () => {
    const db = fakeDb({
      claim_ready_processing_jobs: (() => {
        let n = 1;
        return () => (n-- > 0 ? [claimed("verify_support", 1, null)] : []);
      })(),
      get_processing_job_context: jobContext("verify_support"),
      complete_processing_job: "failed",
      list_run_jobs: { runStatus: "running", jobs: [runJob("extract", "succeeded"), runJob("verify_support", "failed", "stage_not_wired"), runJob("analyze", "queued")] },
    });
    const logger = createMemoryLogger();
    await createDrainer({ db: db.client, storage: fakeStorage(null).storage, logger, getPepper: () => ({ ok: true, data: { pepper: "x".repeat(32), version: "p1" } }) })({});
    assert.equal(completion(db)[0].p_error_message, "stage_not_wired");
    const finish = db.called("finish_processing_run")[0].args;
    assert.equal(finish.p_status, "failed");
    assert.equal(finish.p_error_message, "stage_not_wired");
  });

  it("yield requeues with progress and counts as deferred", async () => {
    const { db, run } = drain({ stage: "analyze", handler: async (): Promise<StageOutcome> => ({ kind: "yield", progress: { done: 3, total: 9 } }) });
    assert.equal((await run()).deferred, 1);
    assert.equal(completion(db)[0].p_outcome, "yield");
    assert.equal(completion(db)[0].p_progress_done, 3);
    assert.equal(db.called("list_run_jobs").length, 0, "a requeued job never finishes the run");
  });
});

describe("run finishing over listRunJobs (DB-14)", () => {
  const done = [
    runJob("parse", "succeeded", null, IDS.source),
    runJob("extract", "succeeded", null, IDS.source),
    runJob("verify_quotes", "succeeded", null, IDS.source),
    runJob("verify_support", "succeeded"),
    runJob("analyze", "succeeded"),
    runJob("prepare_review", "succeeded"),
  ];

  it("finishes succeeded once every job is terminal", async () => {
    const { db, run } = drain({ stage: "prepare_review", runJobs: done });
    await run();
    assert.deepEqual(db.called("finish_processing_run")[0].args, { p_run_id: IDS.run, p_status: "succeeded", p_error_code: null, p_error_message: null });
  });

  it("waits while jobs are open", async () => {
    const { db, run } = drain({ stage: "analyze", runJobs: [...done.slice(0, 5), runJob("prepare_review", "queued")] });
    await run();
    assert.equal(db.called("finish_processing_run").length, 0);
  });

  it("does not finish a run that is no longer active", async () => {
    const { db, run } = drain({ stage: "prepare_review", runJobs: done, runStatus: "cancelled" });
    await run();
    assert.equal(db.called("finish_processing_run").length, 0);
  });

  it("ignores a concurrent finisher (invalid_transition)", async () => {
    const { db, run, logger } = drain({ stage: "prepare_review", runJobs: done, finish: rpcError("BTIT0") });
    const r = await run();
    assert.equal(r.succeeded, 1);
    assert.equal(db.called("finish_processing_run").length, 1);
    assert.ok(!logger.records.some((x) => x.event === "run_finish_error"));
  });

  it("fails the run with a reason token when no source succeeded", async () => {
    const jobs = [
      runJob("parse", "failed", "parser:corrupt_file", IDS.source),
      runJob("extract", "cancelled", "upstream_failed", IDS.source),
      runJob("verify_quotes", "cancelled", "upstream_failed", IDS.source),
      runJob("verify_support", "succeeded"),
      runJob("analyze", "succeeded"),
      runJob("prepare_review", "succeeded"),
    ];
    const { db, run } = drain({ stage: "prepare_review", runJobs: jobs });
    await run();
    const f = db.called("finish_processing_run")[0].args;
    assert.equal(f.p_status, "failed");
    assert.equal(f.p_error_code, "processing_failed");
    assert.equal(f.p_error_message, "no_source_succeeded");
  });
});
