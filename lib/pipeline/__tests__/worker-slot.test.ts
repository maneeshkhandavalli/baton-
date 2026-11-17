// Task 01B: global worker slot (lib/pipeline/worker-slot.ts) and its wiring into every drain entry point.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import type { DbClient, DbRpcResponse } from "../../db/client";
import { PipelineSchemaError } from "../../db/pipeline";
import { createMemoryLogger } from "../log";
import type { DrainOptions, DrainReport } from "../runner";
import { createDrainer } from "../runner";
import { RUN_FATAL_REASONS } from "../types";
import { DEFAULT_MAX_SWEEPS, maxConcurrentSweeps, runWithWorkerSlot, slotLeaseSeconds } from "../worker-slot";

const ROOT = new URL("../../../", import.meta.url);
const TOKEN = "6f1e2d3c-4b5a-4968-8776-655443322110";
const REPORT: DrainReport = { claimed: 2, succeeded: 2, retried: 0, failed: 0, deferred: 0, skipped: 0, lost: 0 };

type Handler = (args: Record<string, unknown>) => unknown;
function fakeDb(handlers: Record<string, Handler>): DbClient & { calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    async rpc(fn: string, args: Record<string, unknown> = {}): Promise<DbRpcResponse> {
      calls.push({ fn, args });
      const h = handlers[fn];
      if (!h) return { data: null, error: { code: "42883", message: `function ${fn} does not exist` } };
      try {
        return { data: await h(args), error: null };
      } catch (e) {
        return { data: null, error: { code: (e as { code?: string }).code ?? "XX000", message: "failed" } };
      }
    },
  };
}

const held = () => ({ slot: 1, token: TOKEN, generation: 7 });
const input = { trigger: "pg_cron" as const, maxSlots: 1, maxJobs: 25, deadlineMs: 240_000 };

describe("maxConcurrentSweeps / slotLeaseSeconds", () => {
  it("defaults to one sweep and accepts only 1..4", () => {
    assert.equal(DEFAULT_MAX_SWEEPS, 1);
    assert.equal(maxConcurrentSweeps({}), 1);
    for (const [raw, want] of [["2", 2], ["4", 4], [" 3 ", 3], ["0", 1], ["5", 1], ["-1", 1], ["1.5", 1], ["two", 1], ["", 1]] as const) {
      assert.equal(maxConcurrentSweeps({ BATON_WORKER_MAX_SWEEPS: raw }), want, raw);
    }
  });

  it("leases cover the remaining budget plus a minute, within 30..900 s", () => {
    assert.equal(slotLeaseSeconds(240_000), 300);
    assert.equal(slotLeaseSeconds(50_000), 110);
    assert.equal(slotLeaseSeconds(0), 60);
    assert.equal(slotLeaseSeconds(-5_000), 60);
    assert.equal(slotLeaseSeconds(10_000_000), 900);
  });
});

describe("runWithWorkerSlot", () => {
  it("no free slot: a no-work result (busy), the drain never runs, nothing is released", async () => {
    const db = fakeDb({ acquire_pipeline_worker_slot: () => null });
    const logger = createMemoryLogger();
    let ran = 0;
    const report = await runWithWorkerSlot({ db, logger }, input, async () => (ran++, REPORT));
    assert.equal(ran, 0);
    assert.deepEqual(report, { claimed: 0, succeeded: 0, retried: 0, failed: 0, deferred: 0, skipped: 0, lost: 0, busy: 1 });
    assert.deepEqual(db.calls.map((c) => c.fn), ["acquire_pipeline_worker_slot"]);
    assert.equal(logger.records[0]?.event, "worker_busy");
  });

  it("acquires with the configured limit and a lease covering the budget, then releases with its token", async () => {
    const db = fakeDb({ acquire_pipeline_worker_slot: held, renew_pipeline_worker_slot: () => true, release_pipeline_worker_slot: () => true });
    const report = await runWithWorkerSlot({ db, logger: createMemoryLogger() }, { ...input, maxSlots: 2, trigger: "after_drain" }, async (o) => {
      assert.equal(await o.shouldContinue!(), true);
      return REPORT;
    });
    assert.deepEqual(report, { ...REPORT, busy: 0 });
    assert.deepEqual(db.calls.map((c) => c.fn), ["acquire_pipeline_worker_slot", "renew_pipeline_worker_slot", "release_pipeline_worker_slot"]);
    assert.deepEqual(db.calls[0].args, { p_max_slots: 2, p_lease_seconds: 300, p_trigger: "after_drain" });
    assert.deepEqual(db.calls[1].args.p_token, TOKEN);
    assert.deepEqual(db.calls[2].args, { p_slot: 1, p_token: TOKEN });
  });

  it("a lost slot stops the drain before its next claim (real drainer)", async () => {
    const db = fakeDb({
      acquire_pipeline_worker_slot: held,
      renew_pipeline_worker_slot: () => false,
      release_pipeline_worker_slot: () => false,
      list_finishable_runs: () => [],
      claim_ready_processing_jobs: () => assert.fail("must not claim after losing the slot"),
    });
    const logger = createMemoryLogger();
    const drain = createDrainer({ db, storage: {} as never, logger, getPepper: () => ({ ok: false }) as never, ai: {} as never });
    const report = await runWithWorkerSlot({ db, logger }, input, drain);
    assert.equal(report.claimed, 0);
    assert.ok(logger.records.some((r) => r.event === "drain_stopped" && r.reason === "worker_slot_lost"));
    assert.ok(logger.records.some((r) => r.event === "worker_slot_not_released"), "a stale release is reported, not forced");
  });

  it("a renew error is treated as a lost slot (fail safe)", async () => {
    const db = fakeDb({ acquire_pipeline_worker_slot: held, release_pipeline_worker_slot: () => true,
      renew_pipeline_worker_slot: () => { throw Object.assign(new Error("x"), { code: "08006" }); } });
    let answer: boolean | undefined;
    await runWithWorkerSlot({ db, logger: createMemoryLogger() }, input, async (o: DrainOptions) => ((answer = await o.shouldContinue!()), REPORT));
    assert.equal(answer, false);
  });

  it("the slot is released even when the drain throws; a release error never masks the result", async () => {
    const db = fakeDb({ acquire_pipeline_worker_slot: held, release_pipeline_worker_slot: () => true });
    await assert.rejects(runWithWorkerSlot({ db, logger: createMemoryLogger() }, input, async () => { throw new Error("boom"); }), /boom/);
    assert.equal(db.calls.at(-1)?.fn, "release_pipeline_worker_slot");

    const db2 = fakeDb({ acquire_pipeline_worker_slot: held, release_pipeline_worker_slot: () => { throw new Error("down"); } });
    const logger = createMemoryLogger();
    assert.deepEqual(await runWithWorkerSlot({ db: db2, logger }, input, async () => REPORT), { ...REPORT, busy: 0 });
    assert.ok(logger.records.some((r) => r.event === "worker_slot_release_error"));
  });

  it("without the slot functions (migration not applied) it refuses to drain: fails closed", async () => {
    const db = fakeDb({});
    let ran = 0;
    await assert.rejects(runWithWorkerSlot({ db, logger: createMemoryLogger() }, input, async () => (ran++, REPORT)), PipelineSchemaError);
    assert.equal(ran, 0);
  });
});

describe("every drain entry point goes through the slot", () => {
  const src = (p: string) => readFileSync(new URL(p, ROOT), "utf8");

  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
      if (statSync(full).isDirectory()) out.push(...sources(full));
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("createDrainer is bound only in lib/pipeline/worker.ts (outside tests)", () => {
    const root = new URL(".", ROOT).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const users = [...sources(join(root, "app")), ...sources(join(root, "lib")), ...sources(join(root, "components")), join(root, "instrumentation.ts")]
      .filter((f) => /createDrainer\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f).replace(/\\/g, "/"))
      .filter((f) => f !== "lib/pipeline/runner.ts");
    assert.deepEqual(users, ["lib/pipeline/worker.ts"]);
  });

  it("drainJobs: target guard first, then the drain only inside runWithWorkerSlot", () => {
    const body = src("lib/pipeline/worker.ts").slice(src("lib/pipeline/worker.ts").indexOf("export function drainJobs"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    assert.ok(fn.indexOf("workerTargetAllowed(") < fn.indexOf("createDrainer("));
    assert.match(fn, /return runWithWorkerSlot\(/);
    assert.match(fn, /maxSlots: maxConcurrentSweeps\(\)/);
  });

  it("the route, scheduleDrain (start + page nudge) and the dev loop all call drainJobs", () => {
    assert.match(src("app/api/pipeline/drain/route.ts"), /drainJobs\(\{ \.\.\.SWEEP_BUDGET, trigger \}\)/);
    assert.match(src("lib/pipeline/worker.ts"), /after\(async \(\) => \{\s*try \{\s*await drainJobs\(\{ \.\.\.SCHEDULED_DRAIN, trigger: "after_drain" \}\)/);
    assert.match(src("lib/pipeline/dev-drain-loop.ts"), /drainJobs\(\{ \.\.\.DEV_DRAIN_BUDGET, trigger: "dev_loop" \}\)/);
    const core = src("lib/actions/core/handovers.ts");
    assert.equal((core.match(/deps\.scheduleDrain\(\)/g) ?? []).length, 2, "startProcessing and continueProcessing");
    assert.match(src("lib/actions/deps.ts"), /import \{ scheduleDrain \} from "\.\.\/pipeline\/worker"/);
  });
});

describe("pipeline_work_due() mirrors the run-outcome rules", () => {
  const sql = readFileSync(new URL("supabase/migrations/20261117100100_pipeline_worker_slots.sql", ROOT), "utf8");
  const finish = readFileSync(new URL("lib/pipeline/finish.ts", ROOT), "utf8");

  it("RUN_FATAL_REASONS", () => {
    const listed = /error_message in \(([^)]*)\)/.exec(sql)?.[1].match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)).sort();
    assert.deepEqual(listed, [...RUN_FATAL_REASONS].sort());
  });

  it("handover-level stages", () => {
    const ts = /HANDOVER_STAGES[^=]*= new Set\(\[([^\]]*)\]/.exec(finish)?.[1].match(/"([a-z_]+)"/g)?.map((s) => s.slice(1, -1)).sort();
    const listed = /j\.stage in \(([^)]*)\)/.exec(sql)?.[1].match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)).sort();
    assert.ok(ts && ts.length > 0);
    assert.deepEqual(listed, ts);
  });
});
