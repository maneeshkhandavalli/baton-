// Round 4 (Worker 02): recordOnboarding (lib/actions/core/onboarding.ts) with a fake store. No Supabase.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VerifiedActor } from "../../db/actor-rules";
import { recordOnboarding, type OnboardingDeps } from "../core/onboarding";
import { EMPTY_ONBOARDING, type OnboardingState } from "../../onboarding/state";
import { ACTOR, ACTOR_ID, OTHER_ID } from "./helpers";

const NOW = "2026-11-19T12:00:00.000Z";

function fake(opts: { actor?: VerifiedActor | null; userId?: string | null; state?: OnboardingState; failWrite?: boolean } = {}) {
  const writes: OnboardingState[] = [];
  let reads = 0;
  const deps: OnboardingDeps = {
    getActor: async () => (opts.actor === undefined ? ACTOR : opts.actor),
    now: () => NOW,
    store: {
      async read() {
        reads += 1;
        const userId = opts.userId === undefined ? ACTOR_ID : opts.userId;
        return userId ? { userId, state: opts.state ?? EMPTY_ONBOARDING } : null;
      },
      async write(s) {
        if (opts.failWrite) throw new Error("boom");
        writes.push(s);
      },
    },
  };
  return { deps, writes, reads: () => reads };
}

describe("recordOnboarding", () => {
  it("records the welcome for the verified user", async () => {
    const f = fake();
    const r = await recordOnboarding(f.deps, { type: "welcome_seen" });
    assert.ok(r.ok);
    assert.deepEqual(f.writes, [{ v: 1, welcomeSeenAt: NOW }]);
  });

  it("rejects anything that isn't a known event, before touching the store", async () => {
    const f = fake();
    for (const bad of [{ type: "set", data: { v: 1, welcomeSeenAt: NOW } }, { type: "tour_finished", role: "admin", status: "completed" }, "reset", null]) {
      const r = await recordOnboarding(f.deps, bad);
      assert.equal(!r.ok && r.error.code, "validation_failed", JSON.stringify(bad));
    }
    assert.equal(f.reads(), 0);
    assert.deepEqual(f.writes, []);
  });

  it("signed out: unauthenticated, nothing read or written", async () => {
    const f = fake({ actor: null });
    const r = await recordOnboarding(f.deps, { type: "reset" });
    assert.equal(!r.ok && r.error.code, "unauthenticated");
    assert.equal(f.reads(), 0);
    assert.deepEqual(f.writes, []);
  });

  it("never writes when the stored value belongs to another user", async () => {
    const f = fake({ userId: OTHER_ID });
    const r = await recordOnboarding(f.deps, { type: "welcome_seen" });
    assert.equal(!r.ok && r.error.code, "unauthenticated");
    assert.deepEqual(f.writes, []);
  });

  it("skips a write that changes nothing", async () => {
    const f = fake({ state: { v: 1, welcomeSeenAt: "2026-11-01T00:00:00.000Z" } });
    const r = await recordOnboarding(f.deps, { type: "welcome_seen" });
    assert.ok(r.ok);
    assert.deepEqual(f.writes, []);
  });

  it("a dismissed tour is stored; reset clears it", async () => {
    const f = fake();
    const r = await recordOnboarding(f.deps, { type: "tour_finished", role: "incoming", status: "dismissed" });
    assert.ok(r.ok && r.data.tour?.incoming?.status === "dismissed");
    const g = fake({ state: r.ok ? r.data : EMPTY_ONBOARDING });
    const reset = await recordOnboarding(g.deps, { type: "reset" });
    assert.ok(reset.ok);
    assert.deepEqual(g.writes, [{ v: 1 }]);
  });

  it("a failed write is a safe error, never a thrown exception", async () => {
    const f = fake({ failWrite: true });
    const r = await recordOnboarding(f.deps, { type: "welcome_seen" });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && !/boom/.test(r.error.message));
  });
});
