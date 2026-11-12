import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createDevDrainTick, DEV_DRAIN_BUDGET, DEV_TICK_TIMEOUT_MS, devDrainAllowed } from "../dev-drain-guard";
import { DEFAULT_MIN_REMAINING_MS } from "../runner";

const CREDS = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" };

describe("devDrainAllowed (BTN-004)", () => {
  it("runs only under next dev with Supabase configured", () => {
    assert.equal(devDrainAllowed({ ...CREDS, NODE_ENV: "development" }), true);
  });
  it("refuses production, test, staging, unset and differently-cased NODE_ENV", () => {
    for (const NODE_ENV of ["production", "test", "staging", undefined, "Development", ""]) {
      assert.equal(devDrainAllowed({ ...CREDS, NODE_ENV }), false, String(NODE_ENV));
    }
  });
  it("refuses without Supabase or when switched off", () => {
    assert.equal(devDrainAllowed({ NODE_ENV: "development" }), false);
    assert.equal(devDrainAllowed({ ...CREDS, NODE_ENV: "development", BATON_DEV_WORKER: "0" }), false);
  });
});

describe("DEV_DRAIN_BUDGET", () => {
  it("leaves the runner enough time to start a job (regression: a 25 s budget never claimed)", () => {
    assert.ok(DEV_DRAIN_BUDGET.deadlineMs > DEFAULT_MIN_REMAINING_MS, "deadline must exceed the runner's minimum remaining time");
    assert.ok(DEV_DRAIN_BUDGET.maxJobs >= 1);
  });
});

describe("dev drain loop robustness (E4)", () => {
  const report = (claimed = 1) => ({ claimed, succeeded: claimed, retried: 0, failed: 0 });
  const logger = () => {
    const lines: string[] = [];
    return { lines, log: { info: (m: string) => void lines.push(`info:${m}`), warn: (m: string) => void lines.push(`warn:${m}`) } };
  };

  it("ticks never overlap", async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const { log } = logger();
    const { tick, state } = createDevDrainTick(
      () => {
        calls += 1;
        if (calls > 1) return Promise.resolve(report());
        return new Promise((resolve) => {
          release = () => resolve(report());
        });
      },
      log,
      { timeoutMs: 5_000 },
    );
    const first = tick();
    await tick(); // returns at once: the first is still running
    assert.equal(calls, 1);
    assert.equal(state.running, true);
    release?.();
    await first;
    assert.equal(state.running, false);
    await tick();
    assert.equal(calls, 2);
    assert.equal(state.hung, 0, "settled drains never count as hung");
  });

  it("a failing drain is logged once per distinct error, retried on the next tick, and recovery is logged", async () => {
    const { lines, log } = logger();
    let n = 0;
    const errors = [new TypeError("x"), new TypeError("y"), new RangeError("z")];
    const { tick, state } = createDevDrainTick(async () => {
      if (n < errors.length) throw errors[n++];
      return report(2);
    }, log);
    for (let i = 0; i < 4; i++) await tick();
    assert.deepEqual(lines.filter((l) => l.startsWith("warn:")), [
      "warn:[baton dev worker] drain error (TypeError); retrying",
      "warn:[baton dev worker] drain error (RangeError); retrying",
    ]);
    assert.ok(lines.includes("info:[baton dev worker] drain recovered"));
    assert.ok(lines.includes("info:[baton dev worker] claimed=2 succeeded=2 retried=0 failed=0"));
    assert.equal(state.lastError, null);
    assert.ok(!lines.some((l) => l.includes("x") && l.includes("Error: x")), "no error messages (content) are logged");
  });

  it("a drain that never settles is abandoned so later ticks keep draining (fencing makes this safe)", async () => {
    const { lines, log } = logger();
    let calls = 0;
    const { tick, state } = createDevDrainTick(
      () => {
        calls += 1;
        return calls === 1 ? new Promise<never>(() => {}) : Promise.resolve(report(0));
      },
      log,
      { timeoutMs: 20 },
    );
    await tick();
    assert.equal(state.hung, 1);
    assert.equal(state.running, false);
    await tick();
    assert.equal(calls, 2, "the next tick drains again");
    assert.ok(lines.some((l) => l.startsWith("warn:") && l.includes("did not finish in time")));
  });

  it("the hang timeout is longer than one drain budget, and the loop keeps its interval NOT unref()-ed with the 60 s budget", () => {
    assert.ok(DEV_TICK_TIMEOUT_MS > DEV_DRAIN_BUDGET.deadlineMs);
    assert.equal(DEV_DRAIN_BUDGET.deadlineMs, 60_000, "the 60 s budget was a bug fix (a 25 s budget claimed nothing)");
    const src = readFileSync(join(process.cwd(), "lib", "pipeline", "dev-drain-loop.ts"), "utf8");
    assert.ok(/setInterval\(/.test(src));
    assert.ok(!/\.unref\(\)/.test(src.replace(/\/\/.*$/gm, "")), "an unref()-ed interval never fires under Next.js instrumentation");
  });

  it("instrumentation starts the loop only in the Node.js runtime under development", () => {
    const src = readFileSync(join(process.cwd(), "instrumentation.ts"), "utf8");
    assert.match(src, /process\.env\.NEXT_RUNTIME !== "nodejs" \|\| process\.env\.NODE_ENV !== "development"/);
  });
});
