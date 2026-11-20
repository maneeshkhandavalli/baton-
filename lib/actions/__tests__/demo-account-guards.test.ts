// Shared demo accounts (lib/demo-accounts.ts) cannot run destructive account actions: deleteAccount and
// eraseParticipant refuse with `forbidden` (reason demo_account) before any database, Storage or auth call, and
// behave as before for everyone else. The password change guard is covered in tests/integration/r4-demo-account.test.ts.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { VerifiedActor } from "../../db/actor-rules";
import { DEMO_ACCOUNT_REFUSAL } from "../../demo-accounts";
import * as account from "../core/account";
import * as privacy from "../core/privacy";
import { ACTOR, ACTOR_ID, H, fakeDeps } from "./helpers";

const H2 = "77777777-7777-4777-8777-777777777777";
const P = "88888888-8888-4888-8888-888888888888";
const DEMO = Object.freeze({ profileId: ACTOR_ID, email: "Judge@Demo.test", emailConfirmed: true }) as VerifiedActor;
const PUBLIC_DEMO = Object.freeze({ profileId: ACTOR_ID, email: "creator@demo.test", emailConfirmed: true }) as VerifiedActor;

const KEYS = ["BATON_DEMO_EMAILS", "NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL", "NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.BATON_DEMO_EMAILS = "judge@demo.test, other-demo@demo.test";
  process.env.NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL = "creator@demo.test";
  delete process.env.NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function world(actor: VerifiedActor) {
  return fakeDeps({
    actor,
    rpc: {
      check_account_deletion: { data: { purgeHandoverIds: [H, H2] } },
      delete_own_account: { data: { purgedHandovers: 2, memberships: 1 } },
    },
    storage: { folders: { [`raw/${H}`]: ["s-1"], [`raw/${H2}`]: ["s-2"] } },
  });
}

type Refusal = { ok: boolean; error?: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> } };

function assertDemoRefusal(r: Refusal) {
  assert.equal(r.ok, false);
  assert.equal(r.error?.code, "forbidden");
  assert.equal(r.error?.message, DEMO_ACCOUNT_REFUSAL);
  assert.equal(r.error?.retryable, false);
  assert.equal(r.error?.details?.reason, "demo_account");
}

describe("deleteAccount: shared demo accounts", () => {
  it("a demo account (BATON_DEMO_EMAILS in any case, or a public demo email) is refused before anything is touched", async () => {
    for (const actor of [DEMO, PUBLIC_DEMO]) {
      const f = world(actor);
      const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H, H2] });
      assertDemoRefusal(r as Refusal);
      assert.deepEqual(f.calls, [], actor.email ?? "");
      assert.deepEqual(f.storageCalls, []);
      assert.deepEqual(f.authCalls, []);
    }
  });

  it("any other account is deleted as before", async () => {
    const f = world(ACTOR);
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H, H2] });
    assert.deepEqual(r, { ok: true, data: null });
    assert.deepEqual(f.events, ["check_account_deletion", "delete_own_account", "softDeleteUser", "endSession"]);
  });

  it("with no demo configuration nobody is refused", async () => {
    for (const k of KEYS) delete process.env[k];
    const f = world(DEMO);
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H, H2] });
    assert.deepEqual(r, { ok: true, data: null });
  });
});

describe("eraseParticipant: shared demo accounts", () => {
  it("a demo account is refused with the demo reason, before any database call", async () => {
    const f = fakeDeps({ actor: DEMO });
    const r = await privacy.eraseParticipant(f.deps, { handoverId: H, participantId: P, confirm: true });
    assertDemoRefusal(r as Refusal);
    assert.deepEqual(f.calls, []);
  });

  it("any other creator reaches the action as before (still fail-closed while D27 is open)", async () => {
    const f = fakeDeps({ actor: ACTOR });
    const r = await privacy.eraseParticipant(f.deps, { handoverId: H, participantId: P, confirm: true });
    assert.equal(!r.ok && r.error.code, "precondition_failed");
    assert.equal(!r.ok && r.error.details?.reason, "recovery_manifest_unavailable");
  });
});
