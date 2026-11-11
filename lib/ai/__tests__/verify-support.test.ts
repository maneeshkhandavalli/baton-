// Run: node --import ./lib/ai/__tests__/resolve-ai.mjs --test "lib/ai/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFakeProvider } from "../providers/fake";
import { verifySupport } from "../verify-support";
import { runConfig, verifyRequest } from "./helpers";

const opts = (attempt = 1) => ({ attempt, runConfig: runConfig() });

describe("verifySupport", () => {
  it("returns the verdict, rationale, verify-stage provenance and a succeeded attempt", async () => {
    const r = await verifySupport(createFakeProvider(), verifyRequest(), opts(2));
    assert.ok(r.ok);
    const rc = runConfig();
    assert.equal(r.data.verdict, "supports");
    assert.match(r.data.rationale ?? "", /Test adapter/);
    assert.deepEqual(r.data.provenance, {
      provider: "fake",
      adapterVersion: rc.adapterVersion,
      requestedModel: rc.verify.model,
      model: rc.verify.model,
      promptVersion: rc.verify.promptVersion,
      schemaVersion: rc.verify.schemaVersion,
    });
    assert.equal(r.data.attempt.attempt, 2);
    assert.equal(r.data.attempt.outcome, "succeeded");
  });

  it("passes every non-unchecked verdict through", async () => {
    for (const verdict of ["supports", "partial", "contradicts", "irrelevant"]) {
      const p = createFakeProvider({ verifySupport: [{ kind: "raw", raw: { verdict, rationale: "One sentence." } }] });
      const r = await verifySupport(p, verifyRequest(), opts());
      assert.ok(r.ok);
      assert.equal(r.data.verdict, verdict);
    }
  });

  it("forwards only claim, quote and context: never a stance or extractor reasoning (§11.8 rule 1)", async () => {
    const p = createFakeProvider();
    const req = { ...verifyRequest(), stance: "supports", extractorRationale: "I think so", quote: { ...verifyRequest().quote, stance: "supports" } };
    await verifySupport(p, req as never, opts());
    const sent = p.calls.verifySupport[0];
    assert.deepEqual(Object.keys(sent).sort(), ["claim", "context", "quote"]);
    assert.deepEqual(Object.keys(sent.quote).sort(), ["authorLabel", "sentAt", "text"]);
    assert.doesNotMatch(p.calls.verifySupportPrompts[0].user, /stance|extractorRationale|I think so/);
  });

  it("a rationale that masking would change becomes null; the verdict stands", async () => {
    const p = createFakeProvider({ verifySupport: [{ kind: "raw", raw: { verdict: "supports", rationale: "Ravi confirmed on +91 99999 00001." } }] });
    const r = await verifySupport(p, verifyRequest(), opts());
    assert.ok(r.ok);
    assert.equal(r.data.verdict, "supports");
    assert.equal(r.data.rationale, null);
  });

  const malformed: Array<[string, unknown]> = [
    ["unchecked verdict", { verdict: "unchecked", rationale: "x" }],
    ["status as verdict", { verdict: "sourced", rationale: "x" }],
    ["approved verdict", { verdict: "approved", rationale: "x" }],
    ["empty rationale", { verdict: "supports", rationale: "" }],
    ["over-long rationale", { verdict: "supports", rationale: "r".repeat(1_001) }],
    ["extra keys", { verdict: "supports", rationale: "x", accessLevel: "everyone" }],
    ["not an object", "supports"],
  ];
  for (const [name, raw] of malformed) {
    it(`malformed output (${name}): retryable on attempt 1, final on attempt 2`, async () => {
      for (const attempt of [1, 2]) {
        const p = createFakeProvider({ verifySupport: [{ kind: "raw", raw }] });
        const r = await verifySupport(p, verifyRequest(), opts(attempt));
        assert.ok(!r.ok);
        assert.equal(r.error.code, "processing_failed");
        assert.deepEqual(r.error.details, { reason: "ai_invalid_output" });
        assert.equal(r.error.retryable, attempt === 1);
        assert.equal(r.attempt?.outcome, "invalid_output");
        assert.equal(r.provenance?.requestedModel, runConfig().verify.model);
      }
    });
  }

  it("tool calls and provider errors use the shared handling", async () => {
    const t = await verifySupport(createFakeProvider({ verifySupport: [{ kind: "tool_call" }] }), verifyRequest(), opts(2));
    assert.ok(!t.ok);
    assert.equal(t.error.details?.reason, "ai_tool_call");
    assert.equal(t.error.retryable, false);
    const e = await verifySupport(
      createFakeProvider({ verifySupport: [{ kind: "error", error: { code: "processing_failed", message: "raw body", retryable: true, details: { reason: "ai_provider_error", httpStatus: 503 } } }] }),
      verifyRequest(),
      opts(),
    );
    assert.ok(!e.ok);
    assert.equal(e.error.retryable, true);
    assert.equal(e.attempt?.httpStatus, 503);
    assert.notEqual(e.error.message, "raw body");
  });

  it("rejects invalid or oversized requests without calling the provider", async () => {
    const base = verifyRequest();
    const ctx = base.context[0];
    const cases: Array<[unknown, string]> = [
      [{ ...base, context: [ctx, ctx, ctx, ctx] }, "ai_request_too_large"],
      [{ ...base, quote: { ...base.quote, text: "x".repeat(13_000) } }, "ai_request_too_large"],
      [{ ...base, quote: { ...base.quote, text: "" } }, "ai_request_invalid"],
      [{ ...base, claim: { ...base.claim, category: "gossip" } }, "ai_request_invalid"],
      [{ ...base, claim: { ...base.claim, statement: "" } }, "ai_request_invalid"],
      [{ ...base, context: "none" }, "ai_request_invalid"],
    ];
    for (const [req, reason] of cases) {
      const p = createFakeProvider();
      const r = await verifySupport(p, req as never, opts());
      assert.ok(!r.ok);
      assert.equal(r.error.code, "validation_failed");
      assert.deepEqual(r.error.details, { reason });
      assert.equal(p.calls.verifySupport.length, 0);
    }
  });

  it("rejects a run snapshot whose verify prompt version differs", async () => {
    const rc = { ...runConfig(), verify: { ...runConfig().verify, promptVersion: "support@0" } };
    const r = await verifySupport(createFakeProvider(), verifyRequest(), { attempt: 1, runConfig: rc });
    assert.ok(!r.ok);
    assert.equal(r.error.details?.reason, "ai_config_changed");
  });
});
