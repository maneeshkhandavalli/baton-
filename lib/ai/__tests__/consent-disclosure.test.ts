// R3 Task 05D: the consent checklist describes the ACTUAL AI configuration. A local fake adapter is never presented
// as Gemini; a configured provider is named accurately; no secret ever appears in the wording.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getConsentDisclosure } from "../consent-disclosure";
import { CONSENT_DISCLOSURE_KINDS, consentDisclosure } from "../../contracts/consent";

const SECRET = "AIzaSy-test-secret-not-real-0000000000";
const OMEGA_SECRET = "om-test-secret-not-real-1111";

describe("consent disclosure (provider wording)", () => {
  it("local fake adapter: says no content is sent to any AI provider, and never names Gemini", () => {
    const d = getConsentDisclosure({ NODE_ENV: "development", AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1" });
    assert.equal(d.kind, "local_test");
    assert.match(d.providerStatement, /no content is sent to any AI provider/);
    assert.doesNotMatch(`${d.providerStatement} ${d.badge} ${d.providerLabel}`, /gemini|google/i);
    assert.equal(d.statementVersion, "local-test-2026-11-18-v1");
    // masking and raw deletion are still stated (privacy requirements are not weakened)
    assert.match(d.providerStatement, /masked/);
    assert.match(d.providerStatement, /raw file is still deleted/);
  });

  it("fake adapter outside development/test is not configured (fail closed), not Gemini", () => {
    const d = getConsentDisclosure({ NODE_ENV: "production", AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1" });
    assert.equal(d.kind, "not_configured");
    assert.doesNotMatch(d.providerStatement, /gemini/i);
  });

  it("configured Gemini (development, no paid profile): the free-tier wording and its original statement version", () => {
    const d = getConsentDisclosure({ NODE_ENV: "development", AI_PROVIDER: "gemini", AI_API_KEY: SECRET });
    assert.equal(d.kind, "gemini_free");
    assert.match(d.providerStatement, /Google Gemini \(Gemini Developer API, free tier\)/);
    assert.match(d.providerStatement, /improve its products/);
    assert.equal(d.statementVersion, "gemini-free-2026-11-14-v1");
    assert.ok(!JSON.stringify(d).includes(SECRET), "the API key never appears");
  });

  it("configured Gemini under the approved paid profile: named as the paid tier", () => {
    const d = getConsentDisclosure({ NODE_ENV: "production", AI_PROVIDER: "gemini", AI_API_KEY: SECRET, AI_DATA_GOVERNANCE: "gemini-paid-dpa" });
    assert.equal(d.kind, "gemini_paid");
    assert.match(d.providerStatement, /paid tier under Google's Data Processing Addendum/);
    assert.doesNotMatch(d.providerStatement, /free tier/);
    assert.ok(!JSON.stringify(d).includes(SECRET));
  });

  it("Gemini in production without the approved profile: not configured (no silent free-tier fallback)", () => {
    const d = getConsentDisclosure({ NODE_ENV: "production", AI_PROVIDER: "gemini", AI_API_KEY: SECRET });
    assert.equal(d.kind, "not_configured");
  });

  it("Gemini named without a key: not configured, never claimed as the historical default", () => {
    assert.equal(getConsentDisclosure({ NODE_ENV: "development", AI_PROVIDER: "gemini" }).kind, "not_configured");
    assert.equal(getConsentDisclosure({ NODE_ENV: "development" }).kind, "not_configured");
    assert.doesNotMatch(getConsentDisclosure({ NODE_ENV: "development" }).providerStatement, /gemini/i);
  });

  it("evaluation provider: named by its public display name, synthetic data only, no secret or URL", () => {
    const d = getConsentDisclosure({
      NODE_ENV: "development", AI_PROVIDER: "omega", OMEGA_API_KEY: OMEGA_SECRET, BATON_ALLOW_EVAL_PROVIDER: "1",
      AI_MODEL_EXTRACT: "claude-sonnet-x", AI_MODEL_VERIFY: "claude-haiku-x", OMEGA_API_BASE_URL: "https://eval.example.test",
    });
    assert.equal(d.kind, "evaluation");
    assert.match(d.providerStatement, /evaluation only/);
    assert.match(d.providerStatement, /Omega Plus API/);
    assert.ok(!JSON.stringify(d).includes(OMEGA_SECRET) && !JSON.stringify(d).includes("eval.example.test"));
  });

  it("every wording has its own statement version", () => {
    const versions = CONSENT_DISCLOSURE_KINDS.map((k) => consentDisclosure(k).statementVersion);
    assert.equal(new Set(versions).size, versions.length);
  });
});
