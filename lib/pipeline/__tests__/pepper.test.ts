import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDENTITY_GOLDEN_TEST_CANARY, IDENTITY_GOLDEN_TEST_PEPPER } from "../../contracts/identity";
import { computeIdentityPepperCanary } from "../../privacy/identity";
import { verifyIdentityPepper } from "../pepper-core";

const OTHER_PEPPER = "synthetic-pepper-for-tests-only-0123456789";
const OTHER_CANARY = computeIdentityPepperCanary(OTHER_PEPPER);

function check(env: Record<string, string | undefined>) {
  const r = verifyIdentityPepper(env);
  if (r.ok) return "ok";
  assert.equal(r.error.code, "processing_failed");
  assert.equal(r.error.retryable, true);
  assert.equal(r.error.details?.reason, "identity_pepper_unverified");
  for (const secret of [OTHER_PEPPER, IDENTITY_GOLDEN_TEST_PEPPER]) assert.ok(!JSON.stringify(r).includes(secret), "never echoes the pepper");
  return String(r.error.details?.check);
}

describe("verifyIdentityPepper (D27, D30, §12.8 point 9)", () => {
  it("accepts a pepper whose canary matches, version p1", () => {
    const r = verifyIdentityPepper({ IDENTITY_PEPPER: OTHER_PEPPER, IDENTITY_PEPPER_VERSION: "p1", IDENTITY_PEPPER_CANARY: OTHER_CANARY });
    assert.deepEqual(r, { ok: true, data: { pepper: OTHER_PEPPER, version: "p1" } });
  });

  it("accepts an upper-case canary", () => {
    assert.equal(check({ IDENTITY_PEPPER: OTHER_PEPPER, IDENTITY_PEPPER_VERSION: "p1", IDENTITY_PEPPER_CANARY: OTHER_CANARY.toUpperCase() }), "ok");
  });

  it("fails closed on a missing or other version", () => {
    for (const v of [undefined, "", "p2", "P1", " p1"]) {
      assert.equal(check({ IDENTITY_PEPPER: OTHER_PEPPER, IDENTITY_PEPPER_VERSION: v, IDENTITY_PEPPER_CANARY: OTHER_CANARY }), "version");
    }
  });

  it("fails closed on a missing, short or padded pepper", () => {
    for (const p of [undefined, "", "short", ` ${OTHER_PEPPER}`, `${OTHER_PEPPER}\n`]) {
      assert.equal(check({ IDENTITY_PEPPER: p, IDENTITY_PEPPER_VERSION: "p1", IDENTITY_PEPPER_CANARY: OTHER_CANARY }), "pepper");
    }
  });

  it("fails closed on a missing, malformed or wrong canary", () => {
    for (const c of [undefined, "", "zz".repeat(32), OTHER_CANARY.slice(2)]) {
      assert.equal(check({ IDENTITY_PEPPER: OTHER_PEPPER, IDENTITY_PEPPER_VERSION: "p1", IDENTITY_PEPPER_CANARY: c }), "canary_format");
    }
    assert.equal(
      check({ IDENTITY_PEPPER: OTHER_PEPPER, IDENTITY_PEPPER_VERSION: "p1", IDENTITY_PEPPER_CANARY: IDENTITY_GOLDEN_TEST_CANARY }),
      "canary_mismatch",
    );
  });

  it("accepts the golden test pepper outside production and refuses it in production", () => {
    const env = { IDENTITY_PEPPER: IDENTITY_GOLDEN_TEST_PEPPER, IDENTITY_PEPPER_VERSION: "p1", IDENTITY_PEPPER_CANARY: IDENTITY_GOLDEN_TEST_CANARY };
    assert.equal(check({ ...env, NODE_ENV: "test" }), "ok");
    assert.equal(check({ ...env, NODE_ENV: "production" }), "test_canary_in_production");
  });
});
