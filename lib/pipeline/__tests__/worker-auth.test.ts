// Task 01B: worker endpoint authentication (lib/pipeline/worker-auth.ts). Synthetic secrets only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authenticateWorkerRequest, DISPATCH_MAX_AGE_S, DISPATCH_MAX_SKEW_S, signDispatch } from "../worker-auth";

const SECRET = "worker-auth-test-secret-0123456789abcdef";
const NOW = 1_800_000_000_000; // ms
const T = NOW / 1000;
const h = (o: Record<string, string>) => new Headers(o);
const dispatch = (at: number, id: number | string, secret = SECRET) => `v1.${at}.${id}.${signDispatch(secret, at, id)}`;

describe("signDispatch", () => {
  it("matches the golden vector pgcrypto produces (supabase/ops/tests/run.sh checks the SQL side)", () => {
    assert.equal(signDispatch("golden-signing-key-0123456789abcdefghijkl", 1_700_000_000, 42),
      "cad025ed6baec0a3cad64bdb7cda827e45f8b690811d29e6a4e51ea0afd92b0f");
  });
});

describe("authenticateWorkerRequest", () => {
  it("no credentials at all is its own reason (not logged by the route)", () => {
    assert.deepEqual(authenticateWorkerRequest(h({}), SECRET, NOW), { ok: false, reason: "no_credentials" });
  });

  it("fails closed when the secret is unset or shorter than 32 characters", () => {
    for (const secret of [undefined, "", "s".repeat(31)]) {
      const r = authenticateWorkerRequest(h({ authorization: `Bearer ${secret ?? "x"}`, "x-baton-dispatch": dispatch(T, 1, secret || "x") }), secret, NOW);
      assert.deepEqual(r, { ok: false, reason: "secret_unset" });
    }
  });

  it("Bearer: exact secret only", () => {
    assert.deepEqual(authenticateWorkerRequest(h({ authorization: `Bearer ${SECRET}` }), SECRET, NOW), { ok: true, via: "bearer", dispatchId: null });
    for (const v of [`Bearer ${SECRET}x`, `bearer ${SECRET}`, SECRET, "Bearer ", `Bearer ${SECRET.slice(0, -1)}`]) {
      assert.deepEqual(authenticateWorkerRequest(h({ authorization: v }), SECRET, NOW), { ok: false, reason: "bad_bearer" }, v);
    }
  });

  it("signed dispatch: accepted within the window, with its id", () => {
    assert.deepEqual(authenticateWorkerRequest(h({ "x-baton-dispatch": dispatch(T, 42) }), SECRET, NOW), { ok: true, via: "dispatch", dispatchId: 42 });
    assert.equal(authenticateWorkerRequest(h({ "x-baton-dispatch": dispatch(T - DISPATCH_MAX_AGE_S, 1) }), SECRET, NOW).ok, true);
    assert.equal(authenticateWorkerRequest(h({ "x-baton-dispatch": dispatch(T + DISPATCH_MAX_SKEW_S, 1) }), SECRET, NOW).ok, true);
  });

  it("signed dispatch: stale, too far in the future, tampered, other key, malformed", () => {
    const stale = authenticateWorkerRequest(h({ "x-baton-dispatch": dispatch(T - DISPATCH_MAX_AGE_S - 1, 1) }), SECRET, NOW);
    assert.deepEqual(stale, { ok: false, reason: "stale_dispatch" });
    const future = authenticateWorkerRequest(h({ "x-baton-dispatch": dispatch(T + DISPATCH_MAX_SKEW_S + 1, 1) }), SECRET, NOW);
    assert.deepEqual(future, { ok: false, reason: "stale_dispatch" });
    const good = dispatch(T, 7);
    const forged = [
      good.replace(".7.", ".8."), // id changed, signature reused
      good.replace(`v1.${T}.`, `v1.${T + 1}.`), // time changed
      `${good.slice(0, -1)}${good.endsWith("0") ? "1" : "0"}`, // signature changed
      dispatch(T, 7, "another-secret-0123456789abcdefghijklmn"),
      `v2.${T}.7.${signDispatch(SECRET, T, 7)}`,
      `v1.${T}.7`,
      "",
      `v1.${T}.-7.${signDispatch(SECRET, T, -7)}`,
    ];
    for (const v of forged) {
      assert.deepEqual(authenticateWorkerRequest(h({ "x-baton-dispatch": v }), SECRET, NOW), { ok: false, reason: "bad_dispatch" }, v);
    }
  });

  it("a signed header never contains the secret", () => {
    assert.ok(!dispatch(T, 1).includes(SECRET));
  });
});
