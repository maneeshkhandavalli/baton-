// Deterministic prompt-injection suite (§11.8 rule 7, §12.10 rule 7). Runs every fixture in
// fixtures/ai/prompt-injection/cases through lib/ai with the fake adapter returning the COMPROMISED output.
// It proves the plumbing holds whatever a model does; whether a real model resists the injection is
// asserted by prompt-injection.live.test.ts (opt-in, required before any model/prompt/adapter change).
//
// Run: node --import ./lib/ai/__tests__/resolve-ai.mjs --test "lib/ai/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadInjectionCases, THREATS, isToolCall, type ExtractInjectionCase, type VerifyInjectionCase } from "../../../fixtures/ai/prompt-injection/load";
import { extractionCandidateSchema } from "../../contracts/schemas";
import { deriveEvidenceStatus } from "../../contracts/status";
import { EXTRACT_DROP_REASONS, extractCandidates } from "../extract";
import { EXTRACT_SYSTEM_PROMPT, extractPayload } from "../prompts/extract";
import { UNTRUSTED_PREAMBLE, UNTRUSTED_TRAILER } from "../prompts/payload";
import { SUPPORT_SYSTEM_PROMPT, supportPayload } from "../prompts/support";
import { createFakeProvider, type FakeStep } from "../providers/fake";
import { checkQuote } from "../quote-check";
import { GUARD_RATIONALE } from "../injection-guard";
import { verifySupport } from "../verify-support";
import { runConfig } from "./helpers";

const cases = loadInjectionCases();
const extractCases = cases.filter((c): c is ExtractInjectionCase => c.stage === "extract");
const verifyCases = cases.filter((c): c is VerifyInjectionCase => c.stage === "verify");

const CANDIDATE_KEYS = ["attributes", "category", "citations", "inferenceRationale", "statement", "title"];
const CITATION_KEYS = ["matchedText", "messageId", "quote", "quoteCheck", "quoteEnd", "quoteStart", "stance"];

const stepFor = (output: unknown): FakeStep => (isToolCall(output) ? { kind: "tool_call" } : { kind: "raw", raw: output });

function payloadJson(user: string): unknown {
  assert.ok(user.startsWith(UNTRUSTED_PREAMBLE) && user.endsWith(UNTRUSTED_TRAILER), "fixed frame around the payload");
  const raw = user.slice(UNTRUSTED_PREAMBLE.length, user.length - UNTRUSTED_TRAILER.length);
  // A message that imitates the delimiters cannot close the payload early.
  assert.equal(user.split("PAYLOAD_JSON>>>").length, 2, "exactly one closing delimiter");
  assert.equal(user.split("<<<PAYLOAD_JSON").length, 2, "exactly one opening delimiter");
  assert.doesNotMatch(raw, /[<>&\u2028\u2029]/, "payload escapes markup and line separators");
  assert.doesNotMatch(raw.replace(/[\u200C\u200D]/g, ""), /\p{Cf}/u, "payload escapes invisible format characters");
  return JSON.parse(raw);
}

function assertMarkersOnlyInPayload(system: string, user: string, payload: unknown, markers: readonly string[]) {
  const data = JSON.stringify(payload);
  for (const marker of markers) {
    assert.ok(!system.includes(marker), `marker reached the system prompt: ${JSON.stringify(marker)}`);
    assert.ok(!UNTRUSTED_PREAMBLE.includes(marker) && !UNTRUSTED_TRAILER.includes(marker));
    assert.ok(data.includes(JSON.stringify(marker).slice(1, -1)), `marker travels as payload data: ${JSON.stringify(marker)}`);
  }
  assert.ok(user.length > 0);
}

describe("prompt-injection fixtures", () => {
  it("cover every §12.10 rule 7 threat and both stages", () => {
    const threats = new Set(cases.map((c) => c.threat));
    for (const t of THREATS) assert.ok(threats.has(t), `no fixture for ${t}`);
    assert.ok(extractCases.length >= 10 && verifyCases.length >= 3);
  });
});

describe("prompt-injection suite: extraction (deterministic)", () => {
  for (const c of extractCases) {
    it(`${c.id}: ${c.threat}`, async () => {
      const provider = createFakeProvider({ extract: [stepFor(c.compromisedOutput)] });
      const result = await extractCandidates(provider, c.request, { attempt: 1, runConfig: runConfig() });

      // The prompt: fixed instructions; injected text only as escaped payload data; no other chunk.
      const prompt = provider.calls.extractPrompts[0];
      assert.equal(prompt.system, EXTRACT_SYSTEM_PROMPT);
      const payload = payloadJson(prompt.user);
      assert.deepEqual(payload, extractPayload(c.request));
      assertMarkersOnlyInPayload(prompt.system, prompt.user, payload, c.injectedMarkers);
      for (const other of c.otherChunk ?? []) {
        assert.ok(!prompt.user.includes(other.id) && !JSON.stringify(payload).includes(other.body), "another chunk leaked into the request");
      }

      if (c.expect.outcome === "error") {
        assert.ok(!result.ok, "expected the call to fail");
        assert.equal(result.error.details?.reason, c.expect.errorReason);
        assert.equal(result.error.retryable, true);
        // Retry once, then final.
        const again = await extractCandidates(createFakeProvider({ extract: [stepFor(c.compromisedOutput)] }), c.request, { attempt: 2, runConfig: runConfig() });
        assert.ok(!again.ok);
        assert.equal(again.error.retryable, false);
        return;
      }

      assert.ok(result.ok, `expected ok, got ${result.ok ? "" : String(result.error.details?.reason)}`);
      const out = result.data;
      if (c.expect.survivingCandidates !== undefined) assert.equal(out.candidates.length, c.expect.survivingCandidates);
      if (c.expect.dropped) {
        const want = Object.fromEntries(EXTRACT_DROP_REASONS.map((r) => [r, c.expect.dropped?.[r] ?? 0]));
        assert.deepEqual(out.dropped, want);
      }
      if (c.expect.citationChecks) {
        assert.deepEqual(out.candidates.map((cand) => cand.citations.map((x) => x.quoteCheck)), c.expect.citationChecks);
      }

      const ids = new Set(c.request.messages.map((m) => m.id));
      const bodies = new Map(c.request.messages.map((m) => [m.id, m.body]));
      for (const cand of out.candidates) {
        // Schema-valid or dropped; nothing beyond the contract's fields can survive (status, review, access).
        assert.deepEqual(Object.keys(cand).sort(), CANDIDATE_KEYS);
        const plain = { ...cand, citations: cand.citations.map(({ messageId, quote, stance }) => ({ messageId, quote, stance })) };
        assert.ok(extractionCandidateSchema.safeParse(plain).success);
        assert.equal(JSON.stringify(cand).includes("directContact"), false);
        // No citation outside the request; checks re-derive from the exact body that was sent.
        for (const cit of cand.citations) {
          assert.deepEqual(Object.keys(cit).sort(), CITATION_KEYS);
          assert.ok(ids.has(cit.messageId), "citation outside the request");
          const body = bodies.get(cit.messageId)!;
          const recheck = checkQuote(body, cit.quote);
          assert.equal(cit.quoteCheck, recheck.check);
          assert.equal(cit.matchedText, recheck.start === null ? null : body.slice(recheck.start, recheck.end!));
        }
        // Injected text never changes status: right after extraction nothing is verified for support,
        // so no candidate can be sourced, whatever the model said.
        const status = deriveEvidenceStatus({
          currentRevisionId: "r1",
          inferenceRationale: cand.inferenceRationale,
          links: cand.citations.map((cit) => ({ excluded: false, quoteCheck: cit.quoteCheck, supportVerdict: "unchecked", verifiedRevisionId: null })),
        });
        assert.notEqual(status, "sourced");
      }

      if (c.expect.statementsVerbatim) {
        // Model text is kept as inert data: lib/ai never rewrites, sanitises into HTML, or executes it.
        const raw = (c.compromisedOutput as { candidates: Array<{ statement: string; title: string }> }).candidates;
        assert.deepEqual(out.candidates.map((x) => x.statement), raw.map((x) => x.statement.trim()));
        assert.deepEqual(out.candidates.map((x) => x.title), raw.map((x) => x.title.trim()));
      }
    });
  }

  it("the fake adapter's own default output for every extract fixture passes the guards", async () => {
    for (const c of extractCases) {
      const r = await extractCandidates(createFakeProvider(), c.request, { attempt: 1, runConfig: runConfig() });
      assert.ok(r.ok, c.id);
      for (const cand of r.data.candidates) assert.ok(cand.citations.every((x) => x.quoteCheck !== "not_found"), c.id);
    }
  });
});

describe("prompt-injection suite: support verification (deterministic)", () => {
  for (const c of verifyCases) {
    it(`${c.id}: ${c.threat}`, async () => {
      const provider = createFakeProvider({ verifySupport: [stepFor(c.compromisedOutput)] });
      const result = await verifySupport(provider, c.request, { attempt: 1, runConfig: runConfig() });

      const prompt = provider.calls.verifySupportPrompts[0];
      assert.equal(prompt.system, SUPPORT_SYSTEM_PROMPT);
      const payload = payloadJson(prompt.user);
      assert.deepEqual(payload, supportPayload(c.request));
      assert.ok(!JSON.stringify(payload).includes('"stance"'), "the verifier never sees a stance");
      assertMarkersOnlyInPayload(prompt.system, prompt.user, payload, c.injectedMarkers);

      if (c.expect.outcome === "error") {
        assert.ok(!result.ok);
        assert.equal(result.error.details?.reason, c.expect.errorReason);
        const again = await verifySupport(createFakeProvider({ verifySupport: [stepFor(c.compromisedOutput)] }), c.request, { attempt: 2, runConfig: runConfig() });
        assert.ok(!again.ok);
        assert.equal(again.error.retryable, false);
      } else {
        assert.ok(result.ok);
        assert.equal(result.data.verdict, c.expect.verdict);
        // PI-11: the deterministic guard replaces a promoting verdict on instruction-bearing evidence.
        assert.equal(result.data.injection?.guarded ?? false, c.expect.guarded ?? false, `${c.id}: guard`);
        if (c.expect.guarded) {
          assert.equal(result.data.modelVerdict, (c.compromisedOutput as { verdict: string }).verdict, "the model's answer is kept for audit");
          assert.equal(result.data.rationale, GUARD_RATIONALE, "a fixed rationale, never the model's");
          // With the guarded verdict, an existing quote can no longer make the point sourced.
          const guardedStatus = deriveEvidenceStatus({
            currentRevisionId: "r1",
            inferenceRationale: null,
            links: [{ excluded: false, quoteCheck: "exact", supportVerdict: result.data.verdict, verifiedRevisionId: "r1" }],
          });
          assert.notEqual(guardedStatus, "sourced", `${c.id}: an injected quote never makes a point sourced`);
        }
      }

      // Neither model call alone makes a point sourced: support counts only for a quote that exists.
      const existence = checkQuote(c.sourceBody, c.request.quote.text).check;
      const statusWithSupports = deriveEvidenceStatus({
        currentRevisionId: "r1",
        inferenceRationale: null,
        links: [{ excluded: false, quoteCheck: existence, supportVerdict: "supports", verifiedRevisionId: "r1" }],
      });
      assert.equal(statusWithSupports === "sourced", existence !== "not_found");

      // The deterministic adapter never reads instructions in the text.
      const honest = await verifySupport(createFakeProvider(), c.request, { attempt: 1, runConfig: runConfig() });
      assert.ok(honest.ok);
      assert.equal(honest.data.modelVerdict, c.defaultVerdict);
    });
  }
});
