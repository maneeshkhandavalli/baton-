// Run: node --import ./lib/ai/__tests__/resolve-ai.mjs --test "lib/ai/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { maskText } from "../../privacy/mask";
import { EXTRACT_DROP_REASONS, EXTRACT_REQUEST_LIMITS, extractCandidates, type ExtractOutcome } from "../extract";
import type { AiResult } from "../provider";
import { createFakeProvider, type FakeStep } from "../providers/fake";
import { BODY, candidate, extractRequest, ID, runConfig } from "./helpers";

const opts = (attempt = 1) => ({ attempt, runConfig: runConfig() });

async function runWith(raw: unknown, attempt = 1) {
  const provider = createFakeProvider({ extract: [{ kind: "raw", raw }] });
  const result = await extractCandidates(provider, extractRequest(), opts(attempt));
  return { provider, result };
}

function ok(result: AiResult<ExtractOutcome>): ExtractOutcome {
  if (!result.ok) assert.fail(`expected ok, got ${result.error.code}/${String(result.error.details?.reason)}`);
  return result.data;
}

function droppedOnly(outcome: ExtractOutcome, expected: Partial<Record<(typeof EXTRACT_DROP_REASONS)[number], number>>) {
  const want = Object.fromEntries(EXTRACT_DROP_REASONS.map((r) => [r, expected[r] ?? 0]));
  assert.deepEqual(outcome.dropped, want);
}

// No logging at all from lib/ai (prompts, text and output must never reach logs). Only calls whose stack
// passes through a lib/ai source file count; Node's own process warnings also use console.error.
const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;
const LIB_AI_FRAME = /lib[\\/]ai[\\/](?!__tests__)[^\s)]+\.ts/;
let consoleCalls = 0;
const originals = new Map<string, (...args: unknown[]) => void>();
beforeEach(() => {
  consoleCalls = 0;
  for (const m of consoleMethods) {
    const original = console[m];
    originals.set(m, original);
    console[m] = (...args: unknown[]) => {
      if (LIB_AI_FRAME.test(new Error().stack ?? "")) consoleCalls++;
      else original(...args);
    };
  }
});
afterEach(() => {
  for (const m of consoleMethods) console[m] = originals.get(m)!;
  assert.equal(consoleCalls, 0, "lib/ai must not log");
});

describe("extractCandidates: success path", () => {
  it("annotates citations with checkQuote results, matchedText and body offsets", async () => {
    const { result } = await runWith({
      candidates: [
        candidate(),
        candidate({
          category: "open_task",
          title: "Pay the hall deposit",
          statement: "The hall deposit must be paid before Friday.",
          citations: [{ messageId: ID.m2, quote: "\"Pay the hall deposit to [UPI_1] before Friday - it is non-refundable.\"", stance: "supports" }],
        }),
      ],
    });
    const out = ok(result);
    assert.equal(out.candidates.length, 2);
    const [a, b] = out.candidates;
    assert.deepEqual(a.citations[0], {
      messageId: ID.m1,
      quote: "We decided to hold the inter-college fest on 14 March",
      stance: "supports",
      quoteCheck: "exact",
      quoteStart: 0,
      quoteEnd: 53,
      matchedText: "We decided to hold the inter-college fest on 14 March",
    });
    assert.equal(b.citations[0].quoteCheck, "normalized");
    assert.equal(b.citations[0].matchedText, BODY.m2.slice(b.citations[0].quoteStart!, b.citations[0].quoteEnd!));
    assert.equal(b.citations[0].matchedText, "“Pay the hall deposit to [UPI_1] before Friday — it is non-refundable.”");
    // Contract defaults are applied to attributes.
    assert.deepEqual(a.attributes, { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] });
    droppedOnly(out, {});
  });

  it("records provenance from the run snapshot plus the reported model, and a succeeded attempt", async () => {
    const provider = createFakeProvider({ extract: [{ kind: "raw", raw: { candidates: [] }, meta: { providerRequestId: "req_1", inputTokens: 120, outputTokens: 7 } }] });
    const out = ok(await extractCandidates(provider, extractRequest(), opts(3)));
    const rc = runConfig();
    assert.deepEqual(out.provenance, {
      provider: "fake",
      adapterVersion: rc.adapterVersion,
      requestedModel: rc.extract.model,
      model: rc.extract.model,
      promptVersion: rc.extract.promptVersion,
      schemaVersion: rc.extract.schemaVersion,
    });
    assert.equal(out.attempt.attempt, 3);
    assert.equal(out.attempt.outcome, "succeeded");
    assert.equal(out.attempt.errorCode, null);
    assert.equal(out.attempt.reportedModel, rc.extract.model);
    assert.equal(out.attempt.providerRequestId, "req_1");
    assert.equal(out.attempt.inputTokens, 120);
    assert.equal(out.attempt.outputTokens, 7);
    assert.ok(out.attempt.latencyMs !== null && out.attempt.latencyMs >= 0);
    assert.ok(Date.parse(out.attempt.startedAt) <= Date.parse(out.attempt.finishedAt!));
  });

  it("works end to end with the default fake output", async () => {
    const out = ok(await extractCandidates(createFakeProvider(), extractRequest(), opts()));
    assert.ok(out.candidates.length >= 2);
    for (const c of out.candidates) assert.ok(c.citations.every((x) => x.quoteCheck === "exact"));
    droppedOnly(out, {});
  });

  it("a zero-candidate envelope is a valid, empty result", async () => {
    const out = ok((await runWith({ candidates: [] })).result);
    assert.deepEqual(out.candidates, []);
  });
});

describe("extractCandidates: drop reasons", () => {
  it("schema_invalid: directContact, status/access fields, over-long title, missing rationale", async () => {
    const { result } = await runWith({
      candidates: [
        candidate({ category: "contact", attributes: { nameLabel: "Sponsor", directContact: { channel: "phone", value: "+91 99999 00001" } } }),
        candidate({ evidenceStatus: "sourced" }),
        candidate({ attributes: { accessLevel: "everyone" } }),
        candidate({ title: "x".repeat(121) }),
        candidate({ citations: [], inferenceRationale: null }),
        candidate({ category: "not_a_category" }),
        "just a string",
        null,
      ],
    });
    droppedOnly(ok(result), { schema_invalid: 8 });
  });

  it("unknown_message: foreign citations are removed and the candidate survives on the rest", async () => {
    const { result } = await runWith({
      candidates: [
        candidate({
          citations: [
            { messageId: ID.foreign, quote: "We decided to hold the inter-college fest on 14 March", stance: "supports" },
            { messageId: ID.m1, quote: "We decided to hold the inter-college fest on 14 March", stance: "supports" },
          ],
        }),
      ],
    });
    const out = ok(result);
    assert.equal(out.candidates.length, 1);
    assert.deepEqual(out.candidates[0].citations.map((c) => c.messageId), [ID.m1]);
    droppedOnly(out, { unknown_message: 1 });
  });

  it("all_citations_foreign drops the candidate even with a rationale (§10.6)", async () => {
    const { result } = await runWith({
      candidates: [
        candidate({
          citations: [{ messageId: ID.foreign, quote: "Something from another chunk entirely", stance: "supports" }],
          inferenceRationale: "Mentioned in another channel.",
        }),
      ],
    });
    droppedOnly(ok(result), { unknown_message: 1, all_citations_foreign: 1 });
  });

  it("category_not_requested", async () => {
    const provider = createFakeProvider({ extract: [{ kind: "raw", raw: { candidates: [candidate()] } }] });
    const out = ok(await extractCandidates(provider, extractRequest({ categories: ["owner"] }), opts()));
    droppedOnly(out, { category_not_requested: 1 });
  });

  it("contradictory_citations: the same quote cited with both stances", async () => {
    const quote = "We decided to hold the inter-college fest on 14 March";
    const { result } = await runWith({
      candidates: [
        candidate({
          citations: [
            { messageId: ID.m1, quote, stance: "supports" },
            { messageId: ID.m1, quote: `  ${quote} `, stance: "contradicts" },
          ],
        }),
      ],
    });
    droppedOnly(ok(result), { contradictory_citations: 1 });
  });

  it("duplicate citations are de-duplicated (no drop count)", async () => {
    const quote = "We decided to hold the inter-college fest on 14 March";
    const { result } = await runWith({
      candidates: [candidate({ citations: [1, 2, 3].map(() => ({ messageId: ID.m1, quote, stance: "supports" })) })],
    });
    const out = ok(result);
    assert.equal(out.candidates[0].citations.length, 1);
    droppedOnly(out, {});
  });

  it("fabricated: no exact/normalized citation and no rationale", async () => {
    const { result } = await runWith({
      candidates: [
        candidate({ citations: [{ messageId: ID.m1, quote: "We decided to cancel the fest this year", stance: "supports" }] }),
        // Mis-cited: the text exists, but in another message (§10.7.3: no search elsewhere).
        candidate({ citations: [{ messageId: ID.m3, quote: "We decided to hold the inter-college fest on 14 March", stance: "supports" }] }),
        // Too short to be evidence (§10.7.4).
        candidate({ citations: [{ messageId: ID.m1, quote: "14 March", stance: "supports" }] }),
      ],
    });
    droppedOnly(ok(result), { fabricated: 3 });
  });

  it("keeps not_found citations on surviving candidates (audit) and keeps rationale-only inferences", async () => {
    const { result } = await runWith({
      candidates: [
        candidate({
          citations: [
            { messageId: ID.m1, quote: "We decided to hold the inter-college fest on 14 March", stance: "supports" },
            { messageId: ID.m1, quote: "the fest is definitely on a weekend", stance: "supports" },
          ],
        }),
        candidate({
          category: "risk",
          title: "Permission may be late",
          statement: "The permission letter may not be signed in time.",
          citations: [{ messageId: ID.m3, quote: "the advisor will never sign anything", stance: "supports" }],
          inferenceRationale: "The letter is still unsigned close to the event.",
        }),
      ],
    });
    const out = ok(result);
    assert.equal(out.candidates.length, 2);
    assert.deepEqual(out.candidates[0].citations.map((c) => c.quoteCheck), ["exact", "not_found"]);
    assert.deepEqual(out.candidates[0].citations[1], {
      messageId: ID.m1,
      quote: "the fest is definitely on a weekend",
      stance: "supports",
      quoteCheck: "not_found",
      quoteStart: null,
      quoteEnd: null,
      matchedText: null,
    });
    assert.equal(out.candidates[1].citations[0].quoteCheck, "not_found");
    droppedOnly(out, {});
  });

  it("keeps a candidate whose only verified citations contradict it", async () => {
    const { result } = await runWith({
      candidates: [
        candidate({
          category: "blocker",
          title: "Permission letter signed",
          statement: "The faculty advisor has signed the permission letter.",
          citations: [{ messageId: ID.m3, quote: "The faculty advisor still has not signed the permission letter", stance: "contradicts" }],
        }),
      ],
    });
    const out = ok(result);
    assert.equal(out.candidates.length, 1);
    assert.equal(out.candidates[0].citations[0].stance, "contradicts");
    assert.equal(out.candidates[0].citations[0].quoteCheck, "exact");
  });

  it("unmasked_content: any model string that masking would change drops the candidate", async () => {
    const { result } = await runWith({
      candidates: [
        candidate({ statement: "Call Ravi on +91 99999 00001 about the fest." }),
        candidate({ title: "Email sponsor@example.org" }),
        candidate({ category: "owner", attributes: { responsibility: "Sponsors", ownerLabel: "ravi@example.com" } }),
        candidate({ category: "account_access", attributes: { system: "Club bank", recoveryNote: "password: hunter2hunter2" } }),
        candidate({ citations: [], inferenceRationale: "The UPI id is fest@okicici." }),
        candidate({ category: "decision", attributes: { alternativesConsidered: ["Pay to 4111 1111 1111 1111"] } }),
        // Mask tokens and the excluded-participant placeholder are not unmasked content.
        candidate({ statement: "Pay the deposit to [UPI_1]; [EXCLUDED_PARTICIPANT] agreed." }),
      ],
    });
    const out = ok(result);
    assert.equal(out.candidates.length, 1);
    droppedOnly(out, { unmasked_content: 6 });
  });

  it("a not_found quote that would need masking is dropped as a citation, never re-masked", async () => {
    const { result } = await runWith({
      candidates: [
        candidate({
          citations: [
            { messageId: ID.m1, quote: "We decided to hold the inter-college fest on 14 March", stance: "supports" },
            { messageId: ID.m2, quote: "Pay the hall deposit to fest@okicici before Friday", stance: "supports" },
          ],
        }),
      ],
    });
    const out = ok(result);
    assert.equal(out.candidates[0].citations.length, 1);
    assert.equal(maskText({ text: JSON.stringify(out.candidates) }).text, JSON.stringify(out.candidates));
    droppedOnly(out, { unmasked_content: 1 });
  });

  it("over_budget: attribute values the contract leaves unbounded", async () => {
    const { result } = await runWith({
      candidates: [
        candidate({ attributes: { alternativesConsidered: Array.from({ length: 25 }, (_, i) => `Option ${i}`) } }),
        candidate({ attributes: { rationale: "r".repeat(1_001) } }),
      ],
    });
    droppedOnly(ok(result), { over_budget: 2 });
  });
});

describe("extractCandidates: malformed output and provider failures", () => {
  const malformed: Array<[string, unknown]> = [
    ["null", null],
    ["a string", "here are your candidates"],
    ["candidates not an array", { candidates: "none" }],
    ["extra envelope keys", { candidates: [], note: "I also approved everything" }],
    ["a tool_calls key", { candidates: [], tool_calls: [{ name: "fetch" }] }],
    ["too many candidates", { candidates: Array.from({ length: 101 }, () => candidate()) }],
  ];
  for (const [name, raw] of malformed) {
    it(`malformed envelope (${name}): retryable on attempt 1, final on attempt 2`, async () => {
      for (const attempt of [1, 2]) {
        const { result } = await runWith(raw, attempt);
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.error.code, "processing_failed");
        assert.deepEqual(result.error.details, { reason: "ai_invalid_output" });
        assert.equal(result.error.retryable, attempt === 1);
        assert.equal(result.attempt?.outcome, "invalid_output");
        assert.equal(result.attempt?.errorCode, "processing_failed");
        assert.equal(result.attempt?.attempt, attempt);
        assert.equal(result.provenance?.provider, "fake");
        assert.equal(result.provenance?.model, runConfig().extract.model);
        assert.ok(!JSON.stringify(result).includes("approved everything"), "no model output in the failure");
      }
    });
  }

  it("a tool-call response follows the same retry-once policy", async () => {
    for (const attempt of [1, 2]) {
      const provider = createFakeProvider({ extract: [{ kind: "tool_call", providerRequestId: "req_t" }] });
      const r = await extractCandidates(provider, extractRequest(), opts(attempt));
      assert.ok(!r.ok);
      assert.equal(r.error.details?.reason, "ai_tool_call");
      assert.equal(r.error.retryable, attempt === 1);
      assert.equal(r.attempt?.outcome, "invalid_output");
      assert.equal(r.attempt?.providerRequestId, "req_t");
    }
  });

  it("provider errors are rebuilt from codes and tokens only", async () => {
    const step: FakeStep = {
      kind: "error",
      error: {
        code: "rate_limited",
        message: "Raw provider body: your prompt mentioned Asha (Treasurer) and [UPI_1]",
        retryable: true,
        details: { reason: "ai_provider_error", providerErrorType: "rate_limit_error", httpStatus: 429, providerRequestId: "req_429", body: "secret" },
      },
    };
    const r = await extractCandidates(createFakeProvider({ extract: [step] }), extractRequest(), opts());
    assert.ok(!r.ok);
    assert.equal(r.error.code, "rate_limited");
    assert.equal(r.error.retryable, true);
    assert.equal(r.error.message, "The AI provider could not complete the request.");
    assert.deepEqual(r.error.details, { reason: "ai_provider_error", providerErrorType: "rate_limit_error", httpStatus: 429, providerRequestId: "req_429" });
    assert.equal(r.attempt?.outcome, "failed");
    assert.equal(r.attempt?.httpStatus, 429);
    assert.equal(r.attempt?.providerErrorType, "rate_limit_error");
    assert.equal(r.provenance?.model, null);
  });

  it("an unknown error code or reason from an adapter becomes internal / ai_provider_error", async () => {
    const step: FakeStep = { kind: "error", error: { code: "teapot" as never, message: "x", retryable: false, details: { reason: "made up reason" } } };
    const r = await extractCandidates(createFakeProvider({ extract: [step] }), extractRequest(), opts());
    assert.ok(!r.ok);
    assert.equal(r.error.code, "internal");
    assert.deepEqual(r.error.details, { reason: "ai_provider_error" });
  });

  it("timeouts are recorded as timed_out and stay retryable", async () => {
    const provider = createFakeProvider({ extract: [{ kind: "hang" }] });
    const r = await extractCandidates(provider, extractRequest(), { ...opts(), signal: AbortSignal.timeout(10) });
    assert.ok(!r.ok);
    assert.equal(r.error.details?.reason, "ai_timed_out");
    assert.equal(r.error.retryable, true);
    assert.equal(r.attempt?.outcome, "timed_out");
  });

  it("an adapter that throws yields a retryable internal error with nothing from the exception", async () => {
    const provider = createFakeProvider();
    provider.extract = async () => {
      throw new Error("boom with Asha (Treasurer) text");
    };
    const r = await extractCandidates(provider, extractRequest(), opts());
    assert.ok(!r.ok);
    assert.equal(r.error.code, "internal");
    assert.equal(r.error.retryable, true);
    assert.ok(!JSON.stringify(r).includes("boom"));
  });

  it("provenance that does not match the run snapshot fails with ai_config_changed", async () => {
    for (const override of [{ promptVersion: "extract@999" }, { provider: "other" }, { requestedModel: "x" }, { schemaVersion: "s" }, { adapterVersion: "a" }]) {
      const provider = createFakeProvider({ extract: [{ kind: "raw", raw: { candidates: [] }, provenance: override }] });
      const r = await extractCandidates(provider, extractRequest(), opts());
      assert.ok(!r.ok);
      assert.equal(r.error.code, "precondition_failed");
      assert.deepEqual(r.error.details, { reason: "ai_config_changed" });
      assert.equal(r.error.retryable, false);
    }
  });

  it("an unreadable reported model id is recorded as null", async () => {
    const provider = createFakeProvider({ extract: [{ kind: "raw", raw: { candidates: [] }, reportedModel: "model id with spaces {json}" }] });
    const out = ok(await extractCandidates(provider, extractRequest(), opts()));
    assert.equal(out.provenance.model, null);
    assert.equal(out.attempt.reportedModel, null);
  });
});

describe("extractCandidates: options and request validation (provider never called)", () => {
  it("rejects a bad attempt number", async () => {
    for (const attempt of [0, -1, 1.5, Number.NaN]) {
      const provider = createFakeProvider();
      const r = await extractCandidates(provider, extractRequest(), { attempt, runConfig: runConfig() });
      assert.ok(!r.ok);
      assert.equal(r.error.code, "validation_failed");
      assert.equal(provider.calls.extract.length, 0);
    }
  });

  it("rejects a run snapshot for another provider or an older prompt/schema version", async () => {
    const variants = [
      { ...runConfig(), provider: "other" },
      { ...runConfig(), extract: { ...runConfig().extract, promptVersion: "extract@0" } },
      { ...runConfig(), extract: { ...runConfig().extract, schemaVersion: "extraction@0" } },
      null,
    ];
    for (const rc of variants) {
      const provider = createFakeProvider();
      const r = await extractCandidates(provider, extractRequest(), { attempt: 1, runConfig: rc as never });
      assert.ok(!r.ok);
      assert.equal(r.error.code, "precondition_failed");
      assert.equal(r.error.details?.reason, "ai_config_changed");
      assert.equal(r.error.retryable, false);
      assert.equal(provider.calls.extract.length, 0);
    }
  });

  it("rejects malformed requests with validation_failed / ai_request_invalid", async () => {
    const base = extractRequest();
    const bad = [
      { ...base, messages: [] },
      { ...base, categories: [] },
      { ...base, categories: ["gossip"] },
      { ...base, messages: [{ ...base.messages[0], id: "not-a-uuid" }] },
      { ...base, messages: [base.messages[0], { ...base.messages[1], id: base.messages[0].id }] },
      { ...base, messages: [{ ...base.messages[0], body: 42 }] },
    ];
    for (const req of bad) {
      const provider = createFakeProvider();
      const r = await extractCandidates(provider, req as never, opts());
      assert.ok(!r.ok);
      assert.equal(r.error.code, "validation_failed");
      assert.deepEqual(r.error.details, { reason: "ai_request_invalid" });
      assert.equal(r.error.retryable, false);
      assert.equal(r.attempt?.outcome, "failed");
      assert.equal(provider.calls.extract.length, 0);
    }
  });

  it("rejects oversized requests with validation_failed / ai_request_too_large", async () => {
    const base = extractRequest();
    const tooMany = Array.from({ length: EXTRACT_REQUEST_LIMITS.maxMessages + 1 }, (_, i) => ({
      ...base.messages[0],
      id: `a0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const tooLong = [{ ...base.messages[0], body: "x".repeat(EXTRACT_REQUEST_LIMITS.maxChars) }];
    for (const messages of [tooMany, tooLong]) {
      const provider = createFakeProvider();
      const r = await extractCandidates(provider, { ...base, messages }, opts());
      assert.ok(!r.ok);
      assert.deepEqual(r.error.details, { reason: "ai_request_too_large" });
      assert.equal(provider.calls.extract.length, 0);
    }
  });
});
