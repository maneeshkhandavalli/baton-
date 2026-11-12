// IT-08: without a configured AI provider nothing is written (D11, §11.8 rules 4–5, I3 amendment 1).
// `fake` is accepted only outside production AND with BATON_ALLOW_FAKE_AI=1; its provenance says "fake".
// Real lib/ai/config + real Server Functions over Recording* backends.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { getAiConfiguration, getAiProvider } from "../../lib/ai/config";
import { recordSourceConsent } from "../../lib/actions/sources";
import { startProcessing } from "../../lib/actions/handovers";
import { actionWorld, allCalls } from "./support/actions";
import { captureConsole } from "./support/console-capture";
import { allowFakeAi, pendingAfter, setAiEnv } from "./support/platform";
import { sourceRow } from "./support/rows";

const NOT_CONFIGURED: Array<[string, Record<string, string | undefined>]> = [
  ["unset", {}],
  ["empty", { AI_PROVIDER: "" }],
  ["a real-sounding provider (no adapter exists, D11)", { AI_PROVIDER: "openai", AI_API_KEY: "sk-it-synthetic-provider-key-000000" }],
  ["fake in production, even when allowed", { AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "production" }],
  ["fake without the allow flag", { AI_PROVIDER: "fake", NODE_ENV: "development" }],
  ["fake with a non-exact allow flag", { AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "true", NODE_ENV: "development" }],
  ["fake with NODE_ENV unset, even when allowed (QA-L3)", { AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: undefined }],
  ["fake with NODE_ENV other than development/test (QA-L3)", { AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "staging" }],
  ["a differently-cased fake", { AI_PROVIDER: "FAKE", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "development" }],
];

const consentInput = (sourceId: string) => ({
  sourceId, consentStatementVersion: "consent@1", consentConfirmed: true as const, accessLevel: "everyone" as const, timezone: "Asia/Kolkata",
});

describe("IT-08: AI configuration matrix", () => {
  for (const [label, env] of NOT_CONFIGURED) {
    it(`provider_not_configured: ${label}`, () => {
      assert.deepEqual(getAiConfiguration(env), { ok: false, reason: "provider_not_configured" });
      const provider = getAiProvider(env);
      assert.ok(!provider.ok);
      assert.equal(provider.error.code, "precondition_failed");
      assert.equal(provider.error.retryable, false);
      assert.equal(provider.error.details?.reason, "provider_not_configured");
      assert.doesNotMatch(JSON.stringify(provider), /sk-it-synthetic/);
    });
  }

  it("the allowed fake adapter is labelled as a test adapter and its run config says provider 'fake'", () => {
    const config = getAiConfiguration({ AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "development" });
    assert.ok(config.ok);
    assert.equal(config.mode, "fake");
    assert.equal(config.runConfig.provider, "fake");
    assert.match(config.provider.displayName, /test adapter|not a real AI provider/i);
  });
});

describe("IT-08: actions write nothing without a provider", () => {
  for (const [label, env] of NOT_CONFIGURED) {
    it(`startProcessing and recordSourceConsent: ${label}`, async () => {
      const w = actionWorld();
      setAiEnv(env);
      if ("NODE_ENV" in env) assert.equal(process.env.NODE_ENV, env.NODE_ENV, "the action really runs with this NODE_ENV");
      w.userDb.returns("api_list_sources", [sourceRow(w.ids.source, w.ids.handover)]);

      const { result: started, lines } = await captureConsole(() => startProcessing({ handoverId: w.ids.handover }));
      assert.ok(!started.ok);
      assert.equal(started.error.code, "precondition_failed");
      assert.equal(started.error.details?.reason, "provider_not_configured");
      const consent = await recordSourceConsent(consentInput(w.ids.source));
      assert.ok(!consent.ok);
      assert.equal(consent.error.details?.reason, "provider_not_configured");

      assert.deepEqual(w.adminDb.fns(), [], "no service-role call at all: no run, no jobs, no consent row");
      assert.deepEqual(w.userDb.fns(), ["api_list_sources"], "only the RLS read that precedes the configuration check");
      assert.equal(pendingAfter(), 0, "no drain is scheduled");
      assert.doesNotMatch(JSON.stringify({ started, consent, lines }), /sk-it-synthetic/, "no credential in results or logs");
    });
  }
});

describe("IT-08: with the allowed fake adapter the server, not the request, names the provider", () => {
  it("recordSourceConsent records runConfig.provider and ignores provider fields smuggled into the input", async () => {
    const w = actionWorld();
    allowFakeAi();
    w.adminDb.returns("record_source_consent", null);
    w.userDb.returns("api_get_source", sourceRow(w.ids.source, w.ids.handover));
    const result = await recordSourceConsent({
      ...consentInput(w.ids.source),
      ...({ aiProvider: "some-other-provider", consentAiProvider: "x", p_ai_provider: "y", actorProfileId: randomUUID() } as object),
    });
    assert.ok(result.ok, JSON.stringify(result));
    const args = w.adminDb.last("record_source_consent")?.args;
    assert.equal(args?.p_ai_provider, "fake");
    assert.equal(args?.p_actor_profile_id, "0b6a1c1e-1f00-4c3b-9d7a-0000000000c3", "the actor is the verified session, never the input");
  });

  it("startProcessing snapshots the fake run config, and schedules a drain only after the run exists", async () => {
    const w = actionWorld();
    allowFakeAi();
    const runId = randomUUID();
    w.userDb.returns("api_list_sources", [sourceRow(w.ids.source, w.ids.handover, { state: "parsed" })]);
    w.adminDb.returns("start_processing", runId);
    const result = await startProcessing({ handoverId: w.ids.handover });
    assert.deepEqual(result, { ok: true, data: { runId } });
    const args = w.adminDb.last("start_processing")?.args as { p_ai_config: { provider: string }; p_jobs: Array<{ stage: string }> };
    assert.equal(args.p_ai_config.provider, "fake");
    assert.ok(args.p_jobs.length > 0 && !args.p_jobs.some((j) => j.stage === "parse"), "a parsed source is not parsed again");
    assert.equal(pendingAfter(), 1, "exactly one fire-and-forget drain, not run inline");
  });

  it("a database refusal (e.g. consent for another provider) schedules nothing", async () => {
    const w = actionWorld();
    allowFakeAi();
    w.userDb.returns("api_list_sources", [sourceRow(w.ids.source, w.ids.handover)]);
    w.adminDb.fails("start_processing", "BTPF0");
    const result = await startProcessing({ handoverId: w.ids.handover });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "precondition_failed");
    assert.equal(pendingAfter(), 0);
    assert.deepEqual(w.events, ["db:api_list_sources", "db:start_processing"]);
    assert.equal(allCalls(w).length, 2);
  });
});
