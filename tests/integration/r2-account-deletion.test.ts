// Round 2: account deletion through the REAL Server Function (lib/actions/account.ts → actionDeps() → lib/db →
// lib/supabase) over the Recording* backends and the platform stubs. Proves the production wiring: the
// service-role calls carry only the verified actor, Storage folders of the purged handovers are emptied (and
// nothing else), the auth user is SOFT-deleted through the Admin API, and this browser's Supabase cookies are
// cleared. The SQL half (purge cascade, refusals, rollback) is tests/integration/db/sql/it19_account_deletion.sql.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import * as account from "../../lib/actions/account";
import { ACTOR, actionWorld } from "./support/actions";
import { authCalls } from "./support/platform";

const BUCKET = "source-uploads";

function world() {
  const w = actionWorld();
  const mine = randomUUID();
  const theirs = randomUUID();
  w.adminStorage.put(BUCKET, `raw/${mine}/${randomUUID()}`, new Uint8Array([1]));
  w.adminStorage.put(BUCKET, `raw/${mine}/${randomUUID()}`, new Uint8Array([2]));
  w.adminStorage.put(BUCKET, `raw/${theirs}/${randomUUID()}`, new Uint8Array([3]));
  const jar = (globalThis as unknown as { __batonIt: { cookies: Map<string, string> } }).__batonIt.cookies;
  jar.set("sb-xnwppnzvrpthukxjfojj-auth-token", "synthetic-session");
  jar.set("baton-theme", "dark");
  return { w, mine, theirs, jar };
}

const adminDeletes = () => authCalls().filter((c) => c.name === "admin.deleteUser").map((c) => c.args);

describe("deleteAccount (real wiring)", () => {
  it("deletes the actor's own data, files and auth user, then clears the session cookies", async () => {
    const { w, mine, theirs, jar } = world();
    w.adminDb.returns("check_account_deletion", { purgeHandoverIds: [mine] });
    w.adminDb.returns("delete_own_account", { purgedHandovers: 1, memberships: 2 });

    const r = await account.deleteAccount({ confirm: "DELETE", purgeHandoverIds: [mine] });
    assert.deepEqual(r, { ok: true, data: null });

    assert.deepEqual(w.adminDb.fns(), ["check_account_deletion", "delete_own_account"]);
    for (const c of w.adminDb.calls) assert.equal((c.args as Record<string, unknown>).p_actor_profile_id, ACTOR);
    assert.deepEqual(w.userDb.calls, [], "no user-scoped write");

    const remaining = [...w.adminStorage.objects.keys()];
    assert.ok(remaining.every((k) => !k.includes(mine)), "the purged handover's files are gone");
    assert.equal(remaining.filter((k) => k.includes(theirs)).length, 1, "another handover's file stays");

    assert.deepEqual(adminDeletes(), [{ id: ACTOR, shouldSoftDelete: true }], "soft delete of the actor only");
    assert.equal(jar.has("sb-xnwppnzvrpthukxjfojj-auth-token"), false, "Supabase session cookie cleared");
    assert.equal(jar.get("baton-theme"), "dark", "unrelated cookies are kept");
  });

  it("an Admin API failure leaves a clear, retryable error and keeps the session for the retry", async () => {
    const { w, mine, jar } = world();
    w.adminDb.returns("check_account_deletion", { purgeHandoverIds: [mine] });
    w.adminDb.returns("delete_own_account", { purgedHandovers: 1, memberships: 0 });
    (globalThis as unknown as { __batonIt: { authAdmin?: unknown } }).__batonIt.authAdmin = {
      deleteUserError: { status: 500, code: "unexpected_failure", message: "synthetic" },
    };
    const original = console.error;
    const logged: unknown[][] = [];
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const r = await account.deleteAccount({ confirm: "DELETE", purgeHandoverIds: [mine] });
      assert.ok(!r.ok);
      assert.equal(r.error.retryable, true);
      assert.match(r.error.message, /data was deleted/);
    } finally {
      console.error = original;
    }
    assert.equal(adminDeletes().length, 3, "retried three times");
    assert.ok(jar.has("sb-xnwppnzvrpthukxjfojj-auth-token"), "still signed in, so the user can retry");
    assert.ok(!JSON.stringify(logged).includes("synthetic-session"), "no session value is logged");
  });

  it("a database refusal (someone else's handover) changes nothing anywhere", async () => {
    const { w, theirs, jar } = world();
    w.adminDb.fails("check_account_deletion", "BTNF0", "handover not found");
    const r = await account.deleteAccount({ confirm: "DELETE", purgeHandoverIds: [theirs] });
    assert.ok(!r.ok);
    assert.equal(r.error.code, "not_found");
    assert.deepEqual(w.adminStorage.ops, []);
    assert.equal(w.adminStorage.objects.size, 3);
    assert.deepEqual(adminDeletes(), []);
    assert.ok(jar.has("sb-xnwppnzvrpthukxjfojj-auth-token"));
  });
});
