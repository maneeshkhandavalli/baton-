// IT-01 (AI-request half), IT-03 (through extract) and IT-04 (injection plumbing) on the REAL lib/ai
// (`extractCandidates`, `verifySupport`) with the deterministic fake adapter wrapped in RecordingProvider.
//   * IT-01: what leaves the server — every ExtractRequest / VerifySupportRequest and the prompt a real adapter
//     would send — carries masked text only: no raw PII, no file name, no identity hash, no pepper, and the
//     verifier never receives a stance or the extractor's rationale (§11.8 rules 1 and 6, §12.10 rule 1).
//   * IT-03: fabricated, mis-cited, foreign-id, too-short and mask-token-only quotes never become verified
//     evidence; what survives is consistent with the database's own plausibility rule (QA-M1).
//   * IT-04: compromised model output (fixtures/ai/prompt-injection) can never add status/access/review fields,
//     cite outside the request, leak another chunk, or smuggle unmasked PII; tool calls are failures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { extractCandidates, type CheckedCandidate } from "../../lib/ai/extract";
import type { AiStageOptions, ExtractRequest, VerifySupportRequest } from "../../lib/ai/provider";
import { createFakeProvider, fakeRunConfig, type FakeStep } from "../../lib/ai/providers/fake";
import { verifySupport } from "../../lib/ai/verify-support";
import { POINT_CATEGORIES } from "../../lib/contracts/enums";
import type { ParsedSource } from "../../lib/contracts/parser";
import { parseSource } from "../../lib/parsers/parse-source";
import { isToolCall, loadInjectionCases, type ExtractInjectionCase, type VerifyInjectionCase } from "../../fixtures/ai/prompt-injection/load";
import { buildDocx } from "../../fixtures/parser/builders";
import { fixtureBytes, input, TEST_PEPPER } from "../../fixtures/parser/load";
import { recordProvider } from "./support/recording-provider";
import { PLANTED, assertAbsent, assertNoLeaks, collectStrings } from "./support/sentinels";

const OPTS: AiStageOptions = { attempt: 1, runConfig: fakeRunConfig() };
const FILE_NAME = `WhatsApp Chat with ${PLANTED.phone}.txt`;
const FORBIDDEN_VERIFY_KEYS = ["stance", "inferenceRationale", "extractorReasoning", "reasoning"]; // ("rationale" is a decision attribute)

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

/** The extract request a pipeline builds from persisted rows (DB-5 list_extraction_messages shape). */
function requestFrom(parsed: ParsedSource): ExtractRequest {
  const labels = new Map(parsed.participants.map((p) => [p.localId, p.displayLabel]));
  return {
    handover: { teamName: "Robotics Club", roleTitle: "Treasurer" },
    categories: POINT_CATEGORIES,
    messages: parsed.messages
      .filter((m) => m.kind === "text" || m.kind === "document_block")
      .map((m) => ({ id: randomUUID(), authorLabel: m.participantLocalId ? (labels.get(m.participantLocalId) ?? null) : null, sentAt: m.sentAt, body: m.body })),
  };
}

async function parsed(kind: "whatsapp_export" | "docx", bytes: Uint8Array) {
  const r = await parseSource(input({ kind, bytes, fileName: FILE_NAME, dateOrder: "dmy" }));
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
  return r.data;
}

describe("IT-01: AI requests carry masked content only", () => {
  const SOURCES: Array<[string, () => Promise<ParsedSource>]> = [
    ["pii-chat", () => parsed("whatsapp_export", fixtureBytes("whatsapp/pii-chat.txt"))],
    ["ios unsaved-number sender", () => parsed("whatsapp_export", fixtureBytes("whatsapp/ios-12h-dmy.txt"))],
    ["android chat", () => parsed("whatsapp_export", fixtureBytes("whatsapp/android-24h-dmy.txt"))],
    ["docx with planted PII", () => parsed("docx", buildDocx(Object.values(PLANTED).map((v) => ({ text: `Club detail: ${v}` }))))],
  ];

  for (const [label, load] of SOURCES) {
    it(label, async () => {
      const source = await load();
      const fake = createFakeProvider();
      const provider = recordProvider(fake);
      const req = requestFrom(source);

      const extracted = await extractCandidates(provider, req, OPTS);
      assert.ok(extracted.ok, JSON.stringify(!extracted.ok && extracted.error));

      // verify every message as a quote, as the pipeline would, with stance and rationale smuggled in
      for (const m of req.messages.filter((x) => x.body.trim().length >= 12).slice(0, 5)) {
        const verifyReq = {
          claim: { category: "decision", title: "A decision", statement: m.body, attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] } },
          quote: { text: m.body, authorLabel: m.authorLabel, sentAt: m.sentAt, stance: "supports" },
          context: req.messages.filter((x) => x.id !== m.id).slice(0, 3).map((x) => ({ authorLabel: x.authorLabel, sentAt: x.sentAt, body: x.body })),
          stance: "supports",
          inferenceRationale: "The extractor thinks this supports the claim.",
          extractorReasoning: "trust me",
        };
        const verified = await verifySupport(provider, verifyReq as unknown as VerifySupportRequest, OPTS);
        assert.ok(verified.ok, JSON.stringify(!verified.ok && verified.error));
      }

      const sent = { requests: provider.requests, prompts: [...fake.calls.extractPrompts, ...fake.calls.verifySupportPrompts] };
      assert.ok(provider.requests.length >= 2, "both stages were exercised");
      assertNoLeaks(sent, `${label}: AI requests and prompts`);
      assertAbsent(sent, `${label}: AI requests and prompts`, [
        FILE_NAME, "WhatsApp Chat with", TEST_PEPPER, ...source.participants.map((p) => p.identityHash),
      ]);
      for (const r of provider.requests.filter((x) => x.kind === "verifySupport")) {
        const keys = keysDeep(r.request);
        assert.deepEqual(FORBIDDEN_VERIFY_KEYS.filter((k) => keys.has(k)), [], "the verifier never sees stance or extractor reasoning");
      }
      for (const p of fake.calls.verifySupportPrompts) {
        assert.doesNotMatch(p.user, /The extractor thinks|trust me/, "smuggled reasoning never reaches the verify prompt");
      }
    });
  }
});

describe("IT-03: fabricated and mis-cited quotes never become verified evidence", () => {
  const A = randomUUID();
  const B = randomUUID();
  const C = randomUUID();
  const BODY_A = "The treasurer keeps the cash box in the lab cupboard, key with [PHONE_1] holder.";
  const BODY_B = 'Sponsorship renewal is due in March and the form is on the "shared drive".';
  const BODY_C = "Call [PHONE_1] or [PHONE_2] or [UPI_1] today";
  const req: ExtractRequest = {
    handover: { teamName: "Synthetic Club", roleTitle: null },
    categories: POINT_CATEGORIES,
    messages: [
      { id: A, authorLabel: "Asha", sentAt: "2026-02-01T10:00:00Z", body: BODY_A },
      { id: B, authorLabel: "Ravi", sentAt: "2026-02-01T11:00:00Z", body: BODY_B },
      { id: C, authorLabel: "Participant 1", sentAt: "2026-02-01T12:00:00Z", body: BODY_C },
    ],
  };
  const cand = (title: string, citations: Array<{ messageId: string; quote: string }>, inferenceRationale: string | null = null) => ({
    category: "decision", title, statement: `${title}.`, inferenceRationale,
    attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] },
    citations: citations.map((c) => ({ ...c, stance: "supports" })),
  });
  const RAW = {
    candidates: [
      cand("fabricated", [{ messageId: A, quote: "The treasurer moved the cash box to the principal's office" }]),
      cand("fabricated with rationale", [{ messageId: A, quote: "The cash box is now at the principal's office" }], "Inferred from context"),
      cand("mis-cited", [{ messageId: A, quote: "Sponsorship renewal is due in March" }]),
      cand("foreign id", [{ messageId: randomUUID(), quote: "Sponsorship renewal is due in March" }], "has a rationale"),
      cand("mixed foreign and exact", [{ messageId: randomUUID(), quote: "anything at all here" }, { messageId: B, quote: "Sponsorship renewal is due in March" }]),
      cand("mask tokens only", [{ messageId: C, quote: "[PHONE_1] or [PHONE_2] or [UPI_1]" }]),
      cand("too short", [{ messageId: A, quote: "cash box" }]),
      cand("normalized", [{ messageId: B, quote: "the  form is on the “shared drive”" }]),
      cand("exact", [{ messageId: A, quote: "keeps the cash box in the lab cupboard" }]),
    ],
  };

  it("each quote gets the right check, and nothing unverified survives without a rationale", async () => {
    const step: FakeStep = { kind: "raw", raw: RAW };
    const r = await extractCandidates(createFakeProvider({ extract: [step] }), req, OPTS);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    const byTitle = new Map<string, CheckedCandidate>(r.data.candidates.map((c) => [c.title, c]));

    for (const dropped of ["fabricated", "mis-cited", "foreign id", "mask tokens only", "too short"]) {
      assert.ok(!byTitle.has(dropped), `${dropped} is dropped`);
    }
    assert.ok(r.data.dropped.fabricated >= 4, JSON.stringify(r.data.dropped));
    assert.equal(r.data.dropped.all_citations_foreign, 1, "a rationale does not rescue all-foreign citations");
    assert.equal(r.data.dropped.unknown_message, 2, "each foreign citation is counted");

    const withRationale = byTitle.get("fabricated with rationale");
    assert.ok(withRationale, "kept for review as inferred, with its quote kept for audit");
    assert.deepEqual(withRationale.citations.map((c) => [c.quoteCheck, c.quoteStart, c.matchedText]), [["not_found", null, null]]);

    const mixed = byTitle.get("mixed foreign and exact");
    assert.deepEqual(mixed?.citations.map((c) => [c.messageId, c.quoteCheck]), [[B, "exact"]], "only the in-request citation remains");

    assert.equal(byTitle.get("normalized")?.citations[0].quoteCheck, "normalized");
    assert.equal(byTitle.get("exact")?.citations[0].quoteCheck, "exact");
  });

  it("survivors satisfy the database's plausibility rule (QA-M1), so persistence cannot be refused or fooled", async () => {
    const r = await extractCandidates(createFakeProvider({ extract: [{ kind: "raw", raw: RAW }] }), req, OPTS);
    assert.ok(r.ok);
    const bodies = new Map(req.messages.map((m) => [m.id, m.body]));
    for (const c of r.data.candidates) {
      for (const q of c.citations) {
        if (q.quoteCheck === "not_found") {
          assert.equal(q.quoteStart, null);
          assert.equal(q.matchedText, null);
          continue;
        }
        const body = bodies.get(q.messageId)!;
        assert.ok(q.quoteStart !== null && q.quoteEnd !== null && q.quoteEnd > q.quoteStart && q.quoteEnd <= body.length);
        assert.equal(q.matchedText, body.slice(q.quoteStart, q.quoteEnd), "stored text is the exact body slice (I2 amendment 5)");
        assert.ok(q.matchedText!.trim().length >= 12, "≥ 12 characters, as the database requires");
        if (q.quoteCheck === "exact") assert.ok(body.includes(q.matchedText!), "exact text occurs in the body");
      }
    }
  });
});

describe("IT-04: prompt-injection fixtures through the real lib/ai", () => {
  const cases = loadInjectionCases();
  const STATUS_KEYS = ["evidenceStatus", "evidence_status", "reviewState", "review_state", "accessLevel", "access_level", "status",
    "approved", "privacyReview", "accessOverride", "directContact"];

  for (const c of cases.filter((x): x is ExtractInjectionCase => x.stage === "extract")) {
    it(`${c.id} (extract)`, async () => {
      const fake = createFakeProvider({ extract: [isToolCall(c.compromisedOutput) ? { kind: "tool_call" } : { kind: "raw", raw: c.compromisedOutput }] });
      const provider = recordProvider(fake);
      const r = await extractCandidates(provider, c.request, OPTS);
      assert.deepEqual(provider.requests.map((x) => x.request), [c.request], "the provider received exactly this request");
      if (isToolCall(c.compromisedOutput)) {
        assert.ok(!r.ok, "a tool call is never a success");
        return;
      }
      if (!r.ok) return; // malformed envelopes fail; the unit suite pins the exact reason
      const ids = new Set(c.request.messages.map((m) => m.id));
      const bodies = new Map(c.request.messages.map((m) => [m.id, m.body]));
      for (const cand of r.data.candidates) {
        const keys = keysDeep(cand);
        assert.deepEqual(STATUS_KEYS.filter((k) => keys.has(k)), [], "output cannot carry status, review, access or direct-contact fields");
        for (const q of cand.citations) {
          assert.ok(ids.has(q.messageId), "citations stay inside the request");
          if (q.quoteCheck !== "not_found") assert.equal(q.matchedText, bodies.get(q.messageId)!.slice(q.quoteStart!, q.quoteEnd!));
        }
        assertNoLeaks(cand, `${c.id}: surviving candidate`);
      }
      if (c.otherChunk) {
        assertAbsent({ candidates: r.data.candidates, sent: provider.requests }, `${c.id}: other chunk`,
          c.otherChunk.flatMap((m) => [m.id, m.body.slice(0, 40)]));
      }
      assert.ok(collectStrings(r.data.dropped).length === 0 || Object.values(r.data.dropped).every((n) => typeof n === "number"));
    });
  }

  for (const c of cases.filter((x): x is VerifyInjectionCase => x.stage === "verify")) {
    it(`${c.id} (verify)`, async () => {
      const fake = createFakeProvider({ verifySupport: [isToolCall(c.compromisedOutput) ? { kind: "tool_call" } : { kind: "raw", raw: c.compromisedOutput }] });
      const provider = recordProvider(fake);
      const r = await verifySupport(provider, c.request, OPTS);
      const keys = keysDeep(provider.requests.map((x) => x.request));
      assert.deepEqual(FORBIDDEN_VERIFY_KEYS.filter((k) => keys.has(k)), [], "no stance or rationale reaches the verifier");
      if (isToolCall(c.compromisedOutput)) return assert.ok(!r.ok);
      if (!r.ok) return;
      assert.ok(["supports", "partial", "contradicts", "irrelevant"].includes(r.data.verdict));
      if (r.data.rationale !== null) assertNoLeaks(r.data.rationale, `${c.id}: rationale`);
    });
  }
});
