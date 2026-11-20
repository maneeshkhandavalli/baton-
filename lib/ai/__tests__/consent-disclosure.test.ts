// R3 Task 05D: the consent checklist describes the ACTUAL AI configuration. A local fake adapter is never presented
// as Gemini; a configured provider is named accurately; no secret ever appears in the wording.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { getConsentDisclosure } from "../consent-disclosure";
import { CONSENT_DISCLOSURE_KINDS, consentDisclosure, disclosureProviderId } from "../../contracts/consent";

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

  it("production Omega (owner-approved profile): its own honest wording and statement version", () => {
    const d = getConsentDisclosure({
      NODE_ENV: "production", AI_PROVIDER: "omega", OMEGA_API_KEY: OMEGA_SECRET, AI_DATA_GOVERNANCE: "omega-owner-approved",
      AI_MODEL_EXTRACT: "claude-sonnet-5-5", AI_MODEL_VERIFY: "claude-sonnet-5", OMEGA_API_BASE_URL: "https://prod.example.test",
    });
    assert.equal(d.kind, "omega_owner_approved");
    assert.equal(d.statementVersion, "omega-owner-approved-2026-11-20-v1");
    assert.match(d.providerStatement, /masked content will be sent to the Omega Plus API/);
    assert.match(d.providerStatement, /third-party gateway that forwards it to upstream AI model providers/);
    assert.match(d.providerStatement, /has not documented how long it keeps prompts or whether they are used for training/);
    assert.match(d.providerStatement, /do not upload anything you would not share with a third party/);
    assert.match(d.providerStatement, /masked before anything is sent/);
    assert.match(d.providerStatement, /raw file is deleted after processing/);
    assert.doesNotMatch(`${d.providerStatement} ${d.badge} ${d.providerLabel}`, /evaluation|synthetic|gemini|google/i);
    assert.ok(!JSON.stringify(d).includes(OMEGA_SECRET) && !JSON.stringify(d).includes("prod.example.test"));
    assert.equal(disclosureProviderId(d.kind), "omega");
  });

  it("Omega in production without the profile: not configured", () => {
    const d = getConsentDisclosure({
      NODE_ENV: "production", AI_PROVIDER: "omega", OMEGA_API_KEY: OMEGA_SECRET,
      AI_MODEL_EXTRACT: "claude-sonnet-5-5", AI_MODEL_VERIFY: "claude-sonnet-5",
    });
    assert.equal(d.kind, "not_configured");
  });

  it("existing wordings keep their statement versions", () => {
    assert.deepEqual(
      Object.fromEntries(CONSENT_DISCLOSURE_KINDS.map((k) => [k, consentDisclosure(k).statementVersion])),
      {
        local_test: "local-test-2026-11-18-v1",
        gemini_free: "gemini-free-2026-11-14-v1",
        gemini_paid: "gemini-paid-dpa-2026-11-18-v1",
        evaluation: "evaluation-2026-11-18-v1",
        omega_owner_approved: "omega-owner-approved-2026-11-20-v1",
        not_configured: "not-configured-2026-11-18-v1",
      },
    );
  });

  it("every wording has its own statement version", () => {
    const versions = CONSENT_DISCLOSURE_KINDS.map((k) => consentDisclosure(k).statementVersion);
    assert.equal(new Set(versions).size, versions.length);
  });
});

// R3 Task 06 regression: /handover/new threw "{imported module ./lib/ai/config.ts}.getConsentDisclosure is not a
// function" in a long-running Turbopack dev server, because consent-disclosure.ts was a bare re-export barrel and
// the page was bound straight to a config.ts compiled before the function existed. The function must be DEFINED
// in consent-disclosure.ts, and every caller must import it from there (never from config.ts).
describe("consent disclosure module (New Handover runtime error regression)", () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  it("consent-disclosure.ts defines getConsentDisclosure itself (no re-export barrel)", () => {
    const src = code(read("lib/ai/consent-disclosure.ts"));
    assert.match(src, /export function getConsentDisclosure\(/);
    assert.doesNotMatch(src, /export\s*\{[^}]*getConsentDisclosure[^}]*\}\s*from/);
    assert.doesNotMatch(src, /export\s*\*\s*from/);
  });

  it("config.ts no longer exports it, and every caller imports it from consent-disclosure", () => {
    assert.doesNotMatch(code(read("lib/ai/config.ts")), /getConsentDisclosure/);
    for (const rel of [
      "app/(workspace)/handover/new/page.tsx",
      "app/(workspace)/handover/[id]/processing/page.tsx",
      "app/(workspace)/handover/[id]/settings/page.tsx",
      "lib/actions/deps.ts",
    ]) {
      const src = code(read(rel));
      assert.match(src, /import \{ getConsentDisclosure \} from "(@\/lib|\.\.)\/ai\/consent-disclosure";/, rel);
      assert.doesNotMatch(src, /getConsentDisclosure[^;]*from "[^"]*ai\/config"/, rel);
    }
  });

  it("with no env argument it reads the server environment (via config.ts) and returns a wording", () => {
    const d = getConsentDisclosure();
    assert.ok(CONSENT_DISCLOSURE_KINDS.includes(d.kind));
    assert.equal(typeof d.statementVersion, "string");
  });
});
