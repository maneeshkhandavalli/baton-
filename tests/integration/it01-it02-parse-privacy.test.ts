// IT-01 (parse half) and IT-02: what the parser hands to persistence — and therefore everything that can
// later reach the AI provider, which only ever reads persisted messages (§11.8 rule 6) — contains no raw
// PII, and excluded people, conversations and date ranges are gone before anything is persisted, in the
// preview as well as the final parse (§10.3, §12.1, §12.2, D28–D33). Real lib/parsers + lib/privacy, real
// synthetic fixtures (fixtures/parser/**); nothing is stubbed.
//
// The AI-request half of IT-01 (RecordingProvider over lib/ai's fake adapter) lands with lib/ai and
// lib/pipeline; it reuses the same scanner on the captured requests.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExclusionRule, ParsedSource, ParseSourceInput, ParserResult, SourcePreview } from "../../lib/contracts/parser";
import { EXCLUDED_PARTICIPANT_TOKEN } from "../../lib/contracts/parser";
import { parseSource, previewSource } from "../../lib/parsers/parse-source";
import { buildDocx, buildPdf } from "../../fixtures/parser/builders";
import { conversationRule, fixtureBytes, input, inputFailure, participantRule, TEST_PEPPER } from "../../fixtures/parser/load";
import { PLANTED, assertAbsent, assertNoLeaks } from "./support/sentinels";

function ok<T>(r: ParserResult<T>, label: string): T {
  assert.ok(r.ok, `${label}: expected success, got ${JSON.stringify(!r.ok && r.error)}`);
  return r.data;
}

const chat = (file: string, exclusions: ExclusionRule[] = [], extra: Partial<ParseSourceInput> = {}) =>
  input({ kind: "whatsapp_export", bytes: fixtureBytes(`whatsapp/${file}`), dateOrder: "dmy", exclusions, ...extra });

const plantedParagraphs = [
  `Treasurer phone ${PLANTED.phone} and mail ${PLANTED.email}`,
  `Pay to ${PLANTED.upi}, card ${PLANTED.card}, ${PLANTED.bank}`,
  `The portal ${PLANTED.password} and deploy token ${PLANTED.apiKey}`,
];

const SOURCES: Array<{ label: string; input: ParseSourceInput }> = [
  { label: "whatsapp pii-chat", input: chat("pii-chat.txt") },
  { label: "whatsapp ios-12h (unsaved-number sender)", input: chat("ios-12h-dmy.txt") },
  { label: "whatsapp android-24h", input: chat("android-24h-dmy.txt") },
  { label: "markdown notes", input: input({ kind: "markdown", bytes: fixtureBytes("documents/handover-notes.md") }) },
  { label: "plain text notes", input: input({ kind: "text", bytes: fixtureBytes("documents/plain-notes.txt") }) },
  {
    label: "docx with planted PII and a tracked deletion",
    input: input({
      kind: "docx",
      bytes: buildDocx([
        { text: "Accounts", style: "Heading1" },
        ...plantedParagraphs.map((text) => ({ text })),
        { text: "Deleted text follows", deleted: `old token ${PLANTED.apiKey}` },
      ]),
    }),
  },
  { label: "pdf with planted PII", input: input({ kind: "pdf", bytes: buildPdf([{ paragraphs: plantedParagraphs.map((p) => [p]) }]) }) },
];

describe("IT-01: parsed output (the persisted payload) carries no raw PII", () => {
  for (const { label, input: inp } of SOURCES) {
    it(label, async () => {
      const parsed = ok(await parseSource(inp), label);
      assert.ok(parsed.messages.length > 0, `${label}: something was kept`);
      assertNoLeaks(parsed, `${label} ParsedSource`);
      assertNoLeaks(ok(await previewSource(inp), `${label} preview`), `${label} SourcePreview`);
    });
  }

  it("a phone-number sender becomes 'Participant N' and its number appears nowhere", async () => {
    const parsed = ok(await parseSource(chat("ios-12h-dmy.txt")), "ios");
    const phoneSender = parsed.participants.find((p) => p.identityKind === "phone");
    assert.ok(phoneSender, "the unsaved number is a phone identity");
    assert.match(phoneSender.displayLabel, /^Participant \d+$/);
    assertAbsent(parsed, "ios", ["99999 00002", "9999900002"]);
  });

  it("masking is reported as counts only, and the pepper never appears in output", async () => {
    const parsed = ok(await parseSource(chat("pii-chat.txt")), "pii");
    assert.ok(Object.values(parsed.masking.counts).every((n) => typeof n === "number"));
    assert.ok(Object.values(parsed.masking.counts).reduce((a, b) => a + b, 0) >= 8, "the fixture's PII was masked");
    assertAbsent(parsed, "pii", [TEST_PEPPER]);
  });
});

describe("IT-02: exclusions are applied in memory, before persistence and before any preview", () => {
  const RAVI_ONLY = ["Budget sheet is in the drive", "The sponsor contact is", "New day, new discussion", "This message was deleted"];

  async function both(inp: ParseSourceInput): Promise<[ParsedSource, SourcePreview]> {
    return [ok(await parseSource(inp), "parse"), ok(await previewSource(inp), "preview")];
  }

  it("a participant (name) rule drops their messages and their name everywhere, in parse and preview alike", async () => {
    const unfiltered = ok(await parseSource(chat("android-24h-dmy.txt")), "unfiltered");
    const ravi = unfiltered.participants.find((p) => p.displayLabel === "Ravi Kumar");
    assert.ok(ravi, "control: Ravi Kumar is a participant without the rule");
    const [parsed, preview] = await both(chat("android-24h-dmy.txt", [participantRule("Ravi Kumar")]));
    for (const [label, value] of [["parse", parsed], ["preview", preview]] as const) {
      assertAbsent(value, label, ["Ravi Kumar", ...RAVI_ONLY]);
      assert.ok(value.stats.messagesExcluded > 0, `${label}: only an aggregate count remains`);
      assert.equal(value.participants.length, unfiltered.participants.length - 1, `${label}: the excluded participant is not listed`);
      assert.ok(!value.participants.some((p) => p.localId === ravi.localId), `${label}: not even under a positional id`);
      assert.ok(!value.conversations.some((c) => c.participantLocalIds.includes(ravi.localId)), `${label}: nor in conversations`);
    }
    assert.ok(!parsed.messages.some((m) => m.participantLocalId === ravi.localId), "no message is attributed to them");
  });

  it("a mention of an excluded person inside someone else's kept message becomes the canonical token", async () => {
    const parsed = ok(await parseSource(chat("adversarial-senders-android.txt", [participantRule("Asha Rao")])), "adv");
    assertAbsent(parsed, "adv", ["Asha Rao"]);
    const ios = ok(await parseSource(chat("adversarial-senders-ios.txt", [participantRule("Asha Rao")])), "adv-ios");
    assertAbsent(ios, "adv-ios", ["Asha Rao"]);
    assert.ok(ios.messages.some((m) => m.body.includes(EXCLUDED_PARTICIPANT_TOKEN)), "the mention was replaced, not left in place");
  });

  it("a phone rule drops the unsaved-number sender", async () => {
    const [parsed, preview] = await both(chat("ios-12h-dmy.txt", [participantRule("+91 99999 00002")]));
    for (const [label, value] of [["parse", parsed], ["preview", preview]] as const) {
      assertAbsent(value, label, ["Hello from an unsaved number"]);
      assert.ok(value.participants.every((p) => p.identityKind !== "phone"), `${label}: no phone participant left`);
    }
  });

  it("a date-range rule drops that day, and the first/last timestamps reflect retained content only", async () => {
    const parsed = ok(await parseSource(chat("android-24h-dmy.txt", [
      { kind: "date_range", rangeStart: "2024-01-01T00:00:00+05:30", rangeEnd: "2024-01-01T23:59:59+05:30" },
    ])), "range");
    assertAbsent(parsed, "range", ["New day, new discussion"]);
    assert.ok(parsed.lastMessageAt !== null && parsed.lastMessageAt < "2024-01-01", "lastMessageAt is not from excluded content");
  });

  it("a conversation rule chosen on a preview applies to the final parse with the same context", async () => {
    const preview = ok(await previewSource(chat("android-24h-dmy.txt")), "preview");
    const last = preview.conversations[preview.conversations.length - 1];
    assert.ok(preview.conversations.length >= 2 && last, "the fixture has a second conversation after a long gap");
    const parsed = ok(await parseSource(chat("android-24h-dmy.txt", [conversationRule(last.localId, preview.parseContext)])), "conv");
    assert.ok(!parsed.conversations.some((c) => c.localId === last.localId), "the conversation is gone");
    assertAbsent(parsed, "conv", ["New day, new discussion"]);
  });

  it("a conversation rule from another parse context fails the whole parse (D32) — never applied silently", async () => {
    const preview = ok(await previewSource(chat("android-24h-dmy.txt")), "preview");
    const stale = conversationRule("c_2", { ...preview.parseContext, parserVersion: "0.0.0-stale" });
    for (const fn of [parseSource, previewSource]) {
      const failure = inputFailure(await fn(chat("android-24h-dmy.txt", [stale])));
      assert.equal(failure.details.inputCode, "exclusion_context_mismatch");
      assert.equal(failure.code, "precondition_failed");
    }
  });

  it("a malformed rule is never skipped: the parse fails instead", async () => {
    const bad = { ...participantRule("Ravi Kumar"), participantIdentityHash: "not-a-hash" } as ExclusionRule;
    const failure = inputFailure(await parseSource(chat("android-24h-dmy.txt", [bad])));
    assert.equal(failure.details.inputCode, "exclusion_invalid");
    assert.doesNotMatch(JSON.stringify(failure), /Ravi|not-a-hash/, "the failure names a field, never a value");
  });

  it("a detect rule drops nothing but reports the match, so persistence can refuse it (§6.8.1; DB side: it11)", async () => {
    const parsed = ok(await parseSource(chat("android-24h-dmy.txt", [participantRule("Ravi Kumar", "detect", "rule-1")])), "detect");
    assert.equal(parsed.identityMatches.length, 1);
    assert.equal(parsed.identityMatches[0].ruleId, "rule-1");
    assert.ok(parsed.messages.some((m) => m.body.includes("Budget sheet")), "detect keeps content until the creator decides");
  });

  it("without a valid pepper nothing is parsed (D27/D30 fail closed)", async () => {
    for (const pepper of ["", "short", `  ${TEST_PEPPER}  `]) {
      const failure = inputFailure(await parseSource(chat("pii-chat.txt", [], { identityPepper: pepper })));
      assert.equal(failure.details.inputCode, "identity_pepper_invalid");
      assert.doesNotMatch(JSON.stringify(failure), new RegExp(TEST_PEPPER));
    }
  });

  it("preview and final parse with the same rules agree on participants and conversations (D33)", async () => {
    const rules = [participantRule("Ravi Kumar")];
    const [parsed, preview] = await both(chat("android-24h-dmy.txt", rules));
    assert.deepEqual(preview.participants, parsed.participants);
    assert.deepEqual(preview.conversations, parsed.conversations);
    assert.deepEqual(preview.parseContext, parsed.parseContext);
  });
});
