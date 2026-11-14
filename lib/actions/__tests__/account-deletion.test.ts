// Account deletion (§12.9; migration 20261114100100): lib/actions/core/account.ts deleteAccount with fakes.
// Authorization, the order of every step, cleanup of Storage, and each failure point.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as account from "../core/account";
import { ACTOR_ID, H, OTHER_ID, fakeDeps } from "./helpers";

const H2 = "77777777-7777-4777-8777-777777777777";
const folder = (h: string) => `raw/${h}`;
const ok = { data: { purgedHandovers: 2, memberships: 1 } };

function world(over: Parameters<typeof fakeDeps>[0] = {}) {
  return fakeDeps({
    ...over,
    rpc: {
      check_account_deletion: { data: { purgeHandoverIds: [H, H2] } },
      delete_own_account: ok,
      ...(over.rpc ?? {}),
    },
    storage: { folders: { [folder(H)]: ["s-1", "s-2"], [folder(H2)]: ["s-3"] }, ...(over.storage ?? {}) },
  });
}

describe("deleteAccount: authorization", () => {
  it("a signed-out request does nothing", async () => {
    const f = fakeDeps({ actor: null });
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [] });
    assert.equal(!r.ok && r.error.code, "unauthenticated");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.storageCalls, []);
    assert.deepEqual(f.authCalls, []);
  });

  it("the identity is the verified actor's, never something from the input", async () => {
    const f = world();
    await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H, H2], profileId: OTHER_ID } as never);
    for (const c of f.calls) assert.equal(c.args?.p_actor_profile_id, ACTOR_ID, c.fn);
    assert.deepEqual(f.authCalls.filter((c) => c.op === "softDeleteUser"), [{ op: "softDeleteUser", profileId: ACTOR_ID }]);
  });

  it("wrong word or duplicate ids: validation_failed before any lookup", async () => {
    for (const input of [
      { confirm: "delete", purgeHandoverIds: [] },
      { confirm: "DELETE ", purgeHandoverIds: [] },
      { confirm: "DELETE", purgeHandoverIds: [H, H.toUpperCase()] },
    ]) {
      const f = world();
      const r = await account.deleteAccount(f.deps, input as never);
      assert.equal(!r.ok && r.error.code, "validation_failed", JSON.stringify(input));
      assert.equal(f.actorLookups, 0);
      assert.deepEqual(f.calls, []);
    }
  });

  it("someone else's handover or an incomplete list: the database refuses and nothing is removed", async () => {
    for (const [code, expected] of [["BTNF0", "not_found"], ["BTPF0", "precondition_failed"], ["BTFB0", "forbidden"]] as const) {
      const f = world({ rpc: { check_account_deletion: { error: { code, message: "refused" } } } });
      const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H] });
      assert.equal(!r.ok && r.error.code, expected, code);
      assert.deepEqual(f.fns(), ["check_account_deletion"]);
      assert.deepEqual(f.storageCalls, [], "no file is touched");
      assert.deepEqual(f.authCalls, [], "the auth user is not touched");
    }
  });
});

describe("deleteAccount: the happy path", () => {
  it("check → files → one database transaction → files again → auth user → session, in that order", async () => {
    const f = world();
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H2, H] });
    assert.deepEqual(r, { ok: true, data: null });
    assert.deepEqual(f.events, ["check_account_deletion", "delete_own_account", "softDeleteUser", "endSession"]);
    const check = f.calls.find((c) => c.fn === "check_account_deletion")!;
    assert.equal(check.client, "admin");
    assert.equal(check.args?.p_confirmation, "DELETE");
    const del = f.calls.find((c) => c.fn === "delete_own_account")!;
    assert.deepEqual(del.args, { p_actor_profile_id: ACTOR_ID, p_confirmation: "DELETE", p_purge_handover_ids: [H2, H] });

    // Storage: both folders emptied before the transaction, then swept again.
    const ops = f.storageCalls.map((c) => `${c.op}:${Array.isArray(c.path) ? c.path.join(",") : c.path}`);
    assert.deepEqual(ops, [
      `list:${folder(H)}`, `remove:${folder(H)}/s-1,${folder(H)}/s-2`, `list:${folder(H)}`,
      `list:${folder(H2)}`, `remove:${folder(H2)}/s-3`, `list:${folder(H2)}`,
      `list:${folder(H)}`, `list:${folder(H2)}`,
    ]);
    assert.deepEqual(f.folders.get(folder(H)), []);
    assert.deepEqual(f.folders.get(folder(H2)), []);
    assert.deepEqual(f.issues, []);
    assert.equal(f.refreshes, 0, "no router refresh: the client navigates away");
  });

  it("nothing created: no Storage call at all", async () => {
    const f = world({ rpc: { check_account_deletion: { data: { purgeHandoverIds: [] } } } });
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [] });
    assert.ok(r.ok);
    assert.deepEqual(f.storageCalls, []);
    assert.deepEqual(f.events, ["check_account_deletion", "delete_own_account", "softDeleteUser", "endSession"]);
  });

  it("only listed handovers' folders are touched; other handovers' files stay", async () => {
    const OTHER = "88888888-8888-4888-8888-888888888888";
    const f = world({
      rpc: { check_account_deletion: { data: { purgeHandoverIds: [H] } } },
      storage: { folders: { [folder(H)]: ["s-1"], [folder(OTHER)]: ["keep-me"] } },
    });
    await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H] });
    assert.deepEqual(f.folders.get(folder(OTHER)), ["keep-me"]);
    assert.ok(f.storageCalls.every((c) => !String(c.path).includes(OTHER)));
  });
});

describe("deleteAccount: failures", () => {
  it("Storage unavailable before the transaction: stop, database and auth user untouched, retryable", async () => {
    const f = world({ storage: { listError: true } });
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H, H2] });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "internal");
    assert.equal(r.error.message, account.DELETION_STORAGE_FAILED_MESSAGE);
    assert.equal(r.error.retryable, true);
    assert.deepEqual(f.fns(), ["check_account_deletion"], "delete_own_account never runs");
    assert.deepEqual(f.authCalls, []);
  });

  it("the transaction fails: nothing after it runs, the files already removed are reported as a normal error", async () => {
    const f = world({ rpc: { delete_own_account: { error: { code: "55P03", message: "lock timeout" } } } });
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H, H2] });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "conflict");
    assert.equal(r.error.retryable, true);
    assert.deepEqual(f.authCalls, [], "the auth user is kept when the data was not deleted");
  });

  it("the sweep after the transaction fails: deletion still completes and the leftover is logged (ids only)", async () => {
    const f = world({ storage: { listError: (n) => n > 4 } }); // lists 1-4 are the pre-delete pass (list, remove, list per folder)
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H, H2] });
    assert.ok(r.ok);
    assert.deepEqual(f.issues, [
      { event: "raw uploads may remain after a purge", details: { handoverId: H } },
      { event: "raw uploads may remain after a purge", details: { handoverId: H2 } },
    ]);
  });

  it("the auth user cannot be deleted: a clear, retryable error, logged, and the session is kept for the retry", async () => {
    const f = world({ softDeleteUser: async () => { throw new Error("admin api down"); } });
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [H, H2] });
    assert.ok(!r.ok);
    assert.equal(r.error.message, account.DELETION_AUTH_FAILED_MESSAGE);
    assert.equal(r.error.retryable, true);
    assert.deepEqual(f.issues, [{ event: "auth user not deleted after the data was", details: { profileId: ACTOR_ID } }]);
    assert.ok(!f.authCalls.some((c) => c.op === "endSession"));
  });

  it("the retry after that: the database no longer knows the profile, so only the auth step runs", async () => {
    const f = world({ rpc: { check_account_deletion: { error: { code: "BTUA0", message: "sign in required" } } } });
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [] });
    assert.deepEqual(r, { ok: true, data: null });
    assert.deepEqual(f.fns(), ["check_account_deletion"], "no purge or anonymisation runs again");
    assert.deepEqual(f.storageCalls, []);
    assert.deepEqual(f.authCalls, [{ op: "softDeleteUser", profileId: ACTOR_ID }, { op: "endSession" }]);
  });

  it("an unexpected database error: generic message, nothing deleted", async () => {
    const f = world({ rpc: { check_account_deletion: { error: { code: "XX000", message: "internal detail" } } } });
    const r = await account.deleteAccount(f.deps, { confirm: "DELETE", purgeHandoverIds: [] });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "internal");
    assert.ok(!r.error.message.includes("internal detail"));
    assert.deepEqual(f.authCalls, []);
  });
});
