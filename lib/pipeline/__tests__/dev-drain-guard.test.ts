import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEV_DRAIN_BUDGET, devDrainAllowed } from "../dev-drain-guard";
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
