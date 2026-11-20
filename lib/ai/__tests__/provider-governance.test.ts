// R3 Task 02 (PRIV-1, JOB-2): production cannot silently fall back to an unapproved (free-tier) provider.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APPROVED_AI_DATA_GOVERNANCE, dataGovernanceApproved, getAiConfiguration, getAiProvider } from "../config";

const KEY = "synthetic-test-key-not-real-0000000000";
const PROD = { AI_PROVIDER: "gemini", AI_API_KEY: KEY, NODE_ENV: "production" };

describe("AI data governance gate", () => {
  it("a production build without AI_DATA_GOVERNANCE refuses Gemini (provider_not_configured, detail for operators)", () => {
    assert.deepEqual(getAiConfiguration(PROD), { ok: false, reason: "provider_not_configured", detail: "data_governance_unapproved" });
    const p = getAiProvider(PROD);
    assert.equal(p.ok, false);
    if (!p.ok) assert.equal(p.error.details?.reason, "provider_not_configured");
  });

  it("unknown, empty, mistyped or wrong-provider profiles are refused", () => {
    for (const v of ["", " ", "gemini-free", "GEMINI-PAID-DPA", "paid", "gemini-paid-dpa-x"]) {
      assert.equal(getAiConfiguration({ ...PROD, AI_DATA_GOVERNANCE: v }).ok, false, v);
    }
    assert.equal(dataGovernanceApproved({ NODE_ENV: "production", AI_DATA_GOVERNANCE: "gemini-paid-dpa" }, "other"), false);
  });

  it("the approved paid profile enables production mode; the declared profile never contains the key", () => {
    const c = getAiConfiguration({ ...PROD, AI_DATA_GOVERNANCE: "gemini-paid-dpa" });
    assert.ok(c.ok);
    assert.equal(c.mode, "production");
    assert.equal(JSON.stringify(c).includes(KEY), false);
    assert.deepEqual(Object.keys(APPROVED_AI_DATA_GOVERNANCE), ["gemini-paid-dpa", "omega-owner-approved"]);
  });

  it("the Omega owner-approved profile is bound to provider omega and never enables Gemini", () => {
    assert.equal(APPROVED_AI_DATA_GOVERNANCE["omega-owner-approved"].provider, "omega");
    assert.match(APPROVED_AI_DATA_GOVERNANCE["omega-owner-approved"].description, /owner accepted/);
    assert.match(APPROVED_AI_DATA_GOVERNANCE["omega-owner-approved"].description, /retention, training use/);
    assert.deepEqual(getAiConfiguration({ ...PROD, AI_DATA_GOVERNANCE: "omega-owner-approved" }), {
      ok: false,
      reason: "provider_not_configured",
      detail: "data_governance_unapproved",
    });
    assert.equal(dataGovernanceApproved({ NODE_ENV: "production", AI_DATA_GOVERNANCE: "omega-owner-approved" }, "gemini"), false);
  });

  it("Gemini under the paid profile still builds the Gemini adapter", () => {
    const p = getAiProvider({ ...PROD, AI_DATA_GOVERNANCE: "gemini-paid-dpa" });
    assert.ok(p.ok && p.data.id === "gemini");
  });

  it("development and test builds are unchanged (synthetic data only)", () => {
    assert.equal(getAiConfiguration({ ...PROD, NODE_ENV: "development" }).ok, true);
    assert.equal(getAiConfiguration({ ...PROD, NODE_ENV: "test" }).ok, true);
  });

  it("an unset or unexpected NODE_ENV is treated as production (fail closed)", () => {
    for (const NODE_ENV of [undefined, "", "staging", "Production", " development"]) {
      assert.equal(getAiConfiguration({ ...PROD, NODE_ENV }).ok, false, String(NODE_ENV));
    }
  });
});
