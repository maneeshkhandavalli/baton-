import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TEST_PEPPER,
  conversationRule,
  fixtureBytes,
  input,
  inputFailure,
  participantRule,
} from "../../../fixtures/parser/load";
import type { ExclusionRule, ParseContext, ParsedSource, SourcePreview } from "../../contracts/parser";
import { parseSource, previewSource } from "../../parsers/parse-source";
import { PARSER_VERSION } from "../../parsers/version";
import { computeIdentityHash } from "../identity";

const FILE = "whatsapp/android-24h-dmy.txt";

async function parseWith(exclusions: ExclusionRule[], file = FILE): Promise<ParsedSource> {
  const r = await parseSource(input({ kind: "whatsapp_export", bytes: fixtureBytes(file), exclusions }));
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

async function previewWith(exclusions: ExclusionRule[], file = FILE): Promise<SourcePreview> {
  const r = await previewSource(input({ kind: "whatsapp_export", bytes: fixtureBytes(file), exclusions }));
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

const RAVI = computeIdentityHash("Ravi Kumar", TEST_PEPPER);
const PHONE_SENDER = computeIdentityHash("+91 99999 00001", TEST_PEPPER);
/** The context a preview of FILE reports with the default test input (Asia/Kolkata, detected dmy). */
const CONTEXT: ParseContext = { timezone: "Asia/Kolkata", dateOrder: "dmy", parserVersion: PARSER_VERSION };

describe("participant exclusion (apply)", () => {
  it("drops the participant's messages, metadata and system lines naming them", async () => {
    const s = await parseWith([participantRule("Ravi Kumar")]);
    const json = JSON.stringify(s);
    assert.ok(!json.includes("Ravi"), "excluded participant's name leaked");
    assert.ok(!json.includes(RAVI), "excluded participant's hash leaked");
    assert.ok(!json.includes("Budget sheet"), "excluded content leaked");
    assert.ok(!json.includes("sponsor"), "excluded content leaked");
    assert.ok(!s.participants.some((p) => p.localId === "p_2"));
    // Ravi's 4 messages + "added Ravi Kumar" + "Ravi Kumar left".
    assert.equal(s.stats.messagesExcluded, 6);
    assert.equal(s.stats.messagesKept, 7);
    assert.deepEqual(s.messages.map((m) => m.seq), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepEqual(s.identityMatches, []);
  });

  it("excluded content never reaches masking (no counts, no token numbering gaps)", async () => {
    const s = await parseWith([participantRule("Ravi Kumar")]);
    assert.equal(s.masking.counts.email, 0); // the only email was in Ravi's message
  });

  it("keeps local ids stable with the preview", async () => {
    const s = await parseWith([participantRule("Ravi Kumar")]);
    assert.deepEqual(s.participants.map((p) => p.localId), ["p_1", "p_3"]);
    assert.deepEqual(s.conversations.map((c) => c.localId), ["c_1", "c_2"]);
  });

  it("matches hashes case-insensitively and phone senders by their normalized number", async () => {
    const rule = participantRule("+91 99999 00001");
    const s = await parseWith([{ ...rule, participantIdentityHash: rule.participantIdentityHash.toUpperCase() }]);
    assert.ok(!s.participants.some((p) => p.identityHash === PHONE_SENDER));
    assert.ok(!JSON.stringify(s).includes("treasurer"));
  });

  it("a hash from a different pepper does not match", async () => {
    const other = computeIdentityHash("Ravi Kumar", TEST_PEPPER + "-other");
    const s = await parseWith([{ ...participantRule("Ravi Kumar"), participantIdentityHash: other }]);
    assert.equal(s.stats.messagesExcluded, 0);
  });

  it("matches only when the identity KIND also agrees (D30, §12.11 point 6)", async () => {
    // The right hash under the wrong kind is a different identity and never matches.
    const s = await parseWith([{ ...participantRule("Ravi Kumar"), identityKind: "phone" }]);
    assert.equal(s.stats.messagesExcluded, 0);
    assert.ok(s.participants.some((p) => p.identityHash === RAVI));
    const t = await parseWith([{ ...participantRule("+91 99999 00001"), identityKind: "name" }]);
    assert.equal(t.stats.messagesExcluded, 0);
  });

  it("reports identity kind and pepper version on every participant (P3)", async () => {
    const s = await parseWith([]);
    for (const p of s.participants) assert.equal(p.identityPepperVersion, "p1");
    assert.deepEqual(
      s.participants.map((p) => p.identityKind),
      ["name", "name", "phone"],
    );
  });
});

describe("participant rules in detect mode (P5, §6.8.1)", () => {
  it("drops nothing and reports an IdentityMatch for the retained participant", async () => {
    const plain = await parseWith([]);
    const s = await parseWith([participantRule("Ravi Kumar", "detect", "rule-ravi")]);
    assert.deepEqual(s.messages, plain.messages);
    assert.deepEqual(s.participants, plain.participants);
    assert.equal(s.stats.messagesExcluded, 0);
    assert.deepEqual(s.identityMatches, [{ ruleId: "rule-ravi", participantLocalId: "p_2", identityKind: "name" }]);
    assert.ok(!s.warnings.some((w) => w.code === "excluded_mentions_redacted"));
  });
  it("reports ruleId null when the rule has none, once per rule", async () => {
    const s = await parseWith([participantRule("Ravi Kumar", "detect"), participantRule("Ravi Kumar", "detect")]);
    assert.deepEqual(s.identityMatches, [{ ruleId: null, participantLocalId: "p_2", identityKind: "name" }]);
  });
  it("an apply rule for the same identity wins: the participant is dropped and no match is reported", async () => {
    const s = await parseWith([participantRule("Ravi Kumar", "detect", "d"), participantRule("Ravi Kumar", "apply", "a")]);
    assert.equal(s.stats.messagesExcluded, 6);
    assert.deepEqual(s.identityMatches, []);
  });
  it("no match is reported for a participant with no retained messages", async () => {
    // p_3 (the phone sender) only writes in c_2.
    const s = await parseWith([conversationRule("c_2", CONTEXT), participantRule("+91 99999 00001", "detect", "r")]);
    assert.deepEqual(s.identityMatches, []);
  });
  it("the preview reports the same matches", async () => {
    const p = await previewWith([participantRule("Ravi Kumar", "detect", "rule-ravi")]);
    assert.deepEqual(p.identityMatches, [{ ruleId: "rule-ravi", participantLocalId: "p_2", identityKind: "name" }]);
  });
});

describe("conversation exclusion", () => {
  it("reports the effective parse context (P6)", async () => {
    const s = await parseWith([]);
    assert.deepEqual(s.parseContext, CONTEXT);
    const p = await previewWith([]);
    assert.deepEqual(p.parseContext, CONTEXT);
  });
  it("drops a whole conversation and recomputes participants", async () => {
    const s = await parseWith([conversationRule("c_2", CONTEXT)]);
    assert.deepEqual(s.conversations.map((c) => c.localId), ["c_1"]);
    assert.ok(!s.messages.some((m) => m.conversationLocalId === "c_2"));
    assert.ok(!s.participants.some((p) => p.localId === "p_3"), "participant only in excluded conversation emitted");
    assert.equal(s.stats.messagesExcluded, 4);
    assert.equal(s.lastMessageAt, "2023-12-31T15:52:00.000Z");
  });
  it("a context taken from a preview applies in the final parse", async () => {
    const p = await previewWith([]);
    const s = await parseWith([conversationRule("c_2", p.parseContext)]);
    assert.equal(s.stats.messagesExcluded, 4);
  });
  it("supplying the detected date order explicitly gives the same context", async () => {
    const r = await parseSource(
      input({ kind: "whatsapp_export", bytes: fixtureBytes(FILE), dateOrder: "dmy", exclusions: [conversationRule("c_2", CONTEXT)] }),
    );
    assert.ok(r.ok);
    assert.equal(r.data.stats.messagesExcluded, 4);
  });
  it("conversation preview comes from kept messages only", async () => {
    const s = await parseWith([participantRule("Asha Rao")]);
    assert.equal(s.conversations[0].preview, "Thanks. The sponsor contact is Meera, reach her at [EMAIL_1]");
  });
});

describe("conversation rules are bound to their parse context (D32)", () => {
  const variants: Array<[string, Partial<ParseContext>]> = [
    ["timezone", { timezone: "UTC" }],
    ["date order", { dateOrder: "mdy" }],
    ["date order null (a document context)", { dateOrder: null }],
    ["parser version", { parserVersion: "0.9.0" }],
    // A rule chosen under the pre-Revision 8 parser (different normalization) must not apply.
    ["parser version 1.0.0 (pre-R8 behaviour)", { parserVersion: "1.0.0" }],
  ];
  for (const [what, change] of variants) {
    for (const entry of [parseSource, previewSource]) {
      it(`${entry === parseSource ? "parseSource" : "previewSource"}: a changed ${what} fails with exclusion_context_mismatch`, async () => {
        const rule = conversationRule("c_2", { ...CONTEXT, ...change }, "rule-7");
        const r = await entry(
          input({ kind: "whatsapp_export", bytes: fixtureBytes(FILE), exclusions: [participantRule("Asha Rao"), rule] }),
        );
        const f = inputFailure(r);
        assert.equal(f.code, "precondition_failed");
        assert.equal(f.retryable, false);
        assert.deepEqual(f.details, { inputCode: "exclusion_context_mismatch", field: "exclusions[1]", ruleId: "rule-7" });
        assert.ok(!JSON.stringify(f).includes("Kolkata") && !JSON.stringify(f).includes("c_2"), "failure quotes a value");
      });
    }
  }
  it("the caller's timezone is part of the context: a rule chosen in Asia/Kolkata fails a UTC parse", async () => {
    const r = await parseSource(
      input({ kind: "whatsapp_export", bytes: fixtureBytes(FILE), timezone: "UTC", exclusions: [conversationRule("c_2", CONTEXT)] }),
    );
    assert.equal(inputFailure(r).details.inputCode, "exclusion_context_mismatch");
  });
  it("a conversation rule given for a document fails rather than being ignored", async () => {
    const r = await parseSource(
      input({ kind: "markdown", bytes: fixtureBytes("documents/handover-notes.md"), exclusions: [conversationRule("c_1", CONTEXT)] }),
    );
    assert.equal(inputFailure(r).details.inputCode, "exclusion_context_mismatch");
  });
  it("documents report a context with a null date order", async () => {
    const r = await previewSource(input({ kind: "markdown", bytes: fixtureBytes("documents/handover-notes.md") }));
    assert.ok(r.ok);
    assert.deepEqual(r.data.parseContext, { timezone: "Asia/Kolkata", dateOrder: null, parserVersion: PARSER_VERSION });
  });
});

describe("date-range exclusion", () => {
  it("is inclusive at both ends", async () => {
    const s = await parseWith([
      { kind: "date_range", rangeStart: "2023-12-31T15:47:00.000Z", rangeEnd: "2023-12-31T15:49:00Z" },
    ]);
    assert.equal(s.stats.messagesExcluded, 3);
    assert.ok(!JSON.stringify(s).includes("Welcome everyone"));
    assert.ok(!JSON.stringify(s).includes("Budget sheet"));
  });
  it("supports open-ended ranges and offsets", async () => {
    const s = await parseWith([{ kind: "date_range", rangeStart: "2024-01-01T00:00:00+05:30" }]);
    assert.equal(s.conversations.length, 1);
    assert.equal(s.stats.messagesExcluded, 4);
  });
  it("combines with other rules", async () => {
    const s = await parseWith([{ kind: "date_range", rangeStart: "2024-01-01T00:00:00+05:30" }, participantRule("Ravi Kumar")]);
    assert.equal(s.stats.messagesKept + s.stats.messagesExcluded, 13);
    assert.equal(s.stats.messagesKept, 5);
  });
});

describe("malformed rules fail closed with a returned exclusion_invalid (D34)", () => {
  const good = () => participantRule("Ravi Kumar");
  const bad: Array<[string, unknown]> = [
    ["participant without fields", { kind: "participant" }],
    ["non-hex hash", { ...good(), participantIdentityHash: "not-hex" }],
    ["missing identity kind", { ...good(), identityKind: undefined }],
    ["unknown identity kind", { ...good(), identityKind: "email" }],
    ["missing pepper version", { ...good(), identityPepperVersion: undefined }],
    ["unknown pepper version", { ...good(), identityPepperVersion: "p2" }],
    ["missing mode", { ...good(), mode: undefined }],
    ["unknown mode", { ...good(), mode: "maybe" }],
    ["non-string ruleId", { ...good(), ruleId: 7 }],
    ["conversation without fields", { kind: "conversation" }],
    ["conversation without context", { kind: "conversation", conversationLocalId: "c_1" }],
    ["conversation with a bad id", { kind: "conversation", conversationLocalId: "conversation-1", context: CONTEXT }],
    ["conversation c_0", { kind: "conversation", conversationLocalId: "c_0", context: CONTEXT }],
    ["context without parser version", { kind: "conversation", conversationLocalId: "c_1", context: { timezone: "UTC", dateOrder: "dmy" } }],
    ["context with a bad date order", { kind: "conversation", conversationLocalId: "c_1", context: { ...CONTEXT, dateOrder: "ydm" } }],
    ["date range without ends", { kind: "date_range" }],
    ["date range without an offset", { kind: "date_range", rangeStart: "2024-01-01" }],
    ["date range reversed", { kind: "date_range", rangeStart: "2024-02-01T00:00:00Z", rangeEnd: "2024-01-01T00:00:00Z" }],
    ["unknown kind", { kind: "everything" }],
    ["null", null],
  ];
  for (const [name, rule] of bad) {
    it(`rejects ${name}`, async () => {
      for (const entry of [parseSource, previewSource]) {
        const r = await entry(
          input({ kind: "whatsapp_export", bytes: fixtureBytes(FILE), exclusions: [good(), rule as ExclusionRule] }),
        );
        const f = inputFailure(r);
        assert.equal(f.code, "validation_failed");
        assert.equal(f.details.inputCode, "exclusion_invalid");
        assert.match(f.details.field, /^exclusions\[1\]/);
      }
    });
  }
  it("echoes the failing rule's ruleId", async () => {
    const r = await parseSource(
      input({ kind: "whatsapp_export", bytes: fixtureBytes(FILE), exclusions: [{ ...good(), mode: "x" as never, ruleId: "r-9" }] }),
    );
    assert.equal(inputFailure(r).details.ruleId, "r-9");
  });
  it("validates rules for documents too", async () => {
    const r = await parseSource(
      input({ kind: "markdown", bytes: fixtureBytes("documents/handover-notes.md"), exclusions: [{ kind: "participant" } as never] }),
    );
    assert.equal(inputFailure(r).details.inputCode, "exclusion_invalid");
  });
  it("a missing or non-array rule list is input_invalid, never treated as empty", async () => {
    for (const exclusions of [undefined, null, {}, "[]"]) {
      const r = await previewSource({ ...input({ kind: "whatsapp_export", bytes: fixtureBytes(FILE) }), exclusions: exclusions as never });
      assert.deepEqual(inputFailure(r).details, { inputCode: "input_invalid", field: "exclusions" });
    }
  });
});

describe("preview applies the same rules as the final parse (D33, P7)", () => {
  const rules = (): ExclusionRule[] => [participantRule("Ravi Kumar")];

  it("an excluded participant is absent from the preview", async () => {
    const p = await previewWith(rules());
    assert.ok(!p.participants.some((x) => x.identityHash === RAVI));
    assert.ok(!JSON.stringify(p).includes("Ravi"));
    assert.ok(!JSON.stringify(p).includes(RAVI));
  });
  it("preview equals the final parse minus messages", async () => {
    const p = await previewWith(rules());
    const s = await parseWith(rules());
    const rest: Partial<ParsedSource> = { ...s };
    delete rest.messages;
    assert.deepEqual(p, rest);
  });
  it("conversation, date-range and participant rules all apply in preview", async () => {
    const all: ExclusionRule[] = [
      participantRule("Ravi Kumar"),
      conversationRule("c_2", CONTEXT),
      { kind: "date_range", rangeEnd: "2023-12-31T15:46:59Z" },
    ];
    const p = await previewWith(all);
    const s = await parseWith(all);
    assert.deepEqual(p.stats, s.stats);
    assert.deepEqual(p.conversations, s.conversations);
    assert.deepEqual(p.participants, s.participants);
    assert.equal(p.firstMessageAt, s.firstMessageAt);
    assert.equal(p.lastMessageAt, s.lastMessageAt);
  });
  it("only aggregate counts of excluded content remain", async () => {
    const p = await previewWith(rules());
    const plain = await previewWith([]);
    assert.equal(p.stats.messagesExcluded, 6);
    assert.equal(p.stats.totalLines, plain.stats.totalLines);
    // Ravi's conversation preview and counts are recomputed from retained messages only.
    for (const c of p.conversations) assert.ok(!c.participantLocalIds.includes("p_2"));
    assert.ok(p.conversations.reduce((n, c) => n + c.messageCount, 0) === p.stats.messagesKept);
  });
});
