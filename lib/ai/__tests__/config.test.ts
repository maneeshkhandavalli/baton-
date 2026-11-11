// Run: node --import ./lib/ai/__tests__/resolve-ai.mjs --test "lib/ai/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAiConfiguration, getAiProvider, getAiProviderForRun } from "../config";
import type { AiRunConfig } from "../provider";

const FAKE_OK = { AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "development" };

function assertNotConfigured(result: { ok: boolean; error?: unknown }) {
  assert.equal(result.ok, false);
  assert.deepEqual(result.error, {
    code: "precondition_failed",
    message: "AI processing is not configured on this server.",
    retryable: false,
    details: { reason: "provider_not_configured" },
  });
}

describe("getAiConfiguration (D11)", () => {
  const notConfigured: Array<[string, Record<string, string | undefined>]> = [
    ["empty env", {}],
    ["AI_PROVIDER unset with fake allowed", { BATON_ALLOW_FAKE_AI: "1" }],
    ["AI_PROVIDER empty", { ...FAKE_OK, AI_PROVIDER: "" }],
    ["a real-sounding provider id", { ...FAKE_OK, AI_PROVIDER: "openai", AI_API_KEY: "synthetic-not-a-key", AI_MODEL_EXTRACT: "m1" }],
    ["another provider id", { ...FAKE_OK, AI_PROVIDER: "anthropic" }],
    ["fake without the allow flag", { AI_PROVIDER: "fake" }],
    ["fake with allow flag 'true'", { ...FAKE_OK, BATON_ALLOW_FAKE_AI: "true" }],
    ["fake with allow flag '0'", { ...FAKE_OK, BATON_ALLOW_FAKE_AI: "0" }],
    ["fake in production", { ...FAKE_OK, NODE_ENV: "production" }],
    ["fake with surrounding whitespace", { ...FAKE_OK, AI_PROVIDER: " fake" }],
    ["fake in upper case", { ...FAKE_OK, AI_PROVIDER: "FAKE" }],
    ["NEXT_PUBLIC_ variables are ignored", { NEXT_PUBLIC_AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1" }],
  ];
  for (const [name, env] of notConfigured) {
    it(`provider_not_configured: ${name}`, () => {
      assert.deepEqual(getAiConfiguration(env), { ok: false, reason: "provider_not_configured" });
      assertNotConfigured(getAiProvider(env));
    });
  }

  it("fake is accepted with NODE_ENV unset or test", () => {
    for (const NODE_ENV of [undefined, "test", "development"]) {
      const config = getAiConfiguration({ ...FAKE_OK, NODE_ENV });
      assert.equal(config.ok, true);
    }
  });

  it("fake configuration is labelled as a test adapter everywhere", () => {
    const config = getAiConfiguration(FAKE_OK);
    assert.ok(config.ok);
    assert.equal(config.mode, "fake");
    assert.equal(config.provider.id, "fake");
    assert.match(config.provider.displayName, /test adapter/i);
    assert.match(config.provider.displayName, /not a real AI provider/i);
    assert.equal(config.runConfig.provider, "fake");
    assert.equal(config.runConfig.adapterVersion, "fake@1");
    assert.match(config.runConfig.extract.model, /^fake-/);
    assert.match(config.runConfig.verify.model, /^fake-/);
    assert.equal(config.runConfig.extract.promptVersion, "extract@1");
    assert.equal(config.runConfig.verify.promptVersion, "support@1");
  });

  it("fake ignores AI_MODEL_* so a fake run never shows a real-looking model", () => {
    const config = getAiConfiguration({ ...FAKE_OK, AI_MODEL_EXTRACT: "real-model-x", AI_MODEL_VERIFY: "real-model-y" });
    assert.ok(config.ok);
    assert.equal(config.runConfig.extract.model, "fake-extract-v1");
    assert.equal(config.runConfig.verify.model, "fake-verify-v1");
  });

  it("defaults to process.env without throwing", () => {
    assert.doesNotThrow(() => getAiConfiguration());
  });

  it("getAiProvider returns the fake adapter", () => {
    const r = getAiProvider(FAKE_OK);
    assert.ok(r.ok);
    assert.equal(r.data.id, "fake");
  });
});

describe("getAiProviderForRun", () => {
  const snapshot = (): AiRunConfig => {
    const c = getAiConfiguration(FAKE_OK);
    assert.ok(c.ok);
    return structuredClone(c.runConfig);
  };

  it("returns a provider whose id equals runConfig.provider", () => {
    const run = snapshot();
    const r = getAiProviderForRun(run, FAKE_OK);
    assert.ok(r.ok);
    assert.equal(r.data.id, run.provider);
  });

  it("provider_not_configured takes precedence", () => {
    assertNotConfigured(getAiProviderForRun(snapshot(), {}));
  });

  const mutations: Array<[string, (c: AiRunConfig) => void]> = [
    ["provider", (c) => (c.provider = "other")],
    ["adapterVersion", (c) => (c.adapterVersion = "fake@0")],
    ["extract.model", (c) => (c.extract.model = "x")],
    ["extract.promptVersion", (c) => (c.extract.promptVersion = "extract@0")],
    ["extract.schemaVersion", (c) => (c.extract.schemaVersion = "extraction@0")],
    ["verify.model", (c) => (c.verify.model = "y")],
    ["verify.promptVersion", (c) => (c.verify.promptVersion = "support@0")],
    ["verify.schemaVersion", (c) => (c.verify.schemaVersion = "support-verdict@0")],
  ];
  for (const [field, mutate] of mutations) {
    it(`ai_config_changed when ${field} differs`, () => {
      const run = snapshot();
      mutate(run);
      const r = getAiProviderForRun(run, FAKE_OK);
      assert.equal(r.ok, false);
      assert.ok(!r.ok);
      assert.equal(r.error.code, "precondition_failed");
      assert.equal(r.error.retryable, false);
      assert.deepEqual(r.error.details, { reason: "ai_config_changed" });
    });
  }

  it("ai_config_changed for a malformed snapshot", () => {
    for (const bad of [null, {}, { provider: "fake" }, { ...snapshot(), extract: null }]) {
      const r = getAiProviderForRun(bad as unknown as AiRunConfig, FAKE_OK);
      assert.equal(r.ok, false);
    }
  });
});
