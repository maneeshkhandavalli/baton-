/**
 * Revision 8 reconciliation (docs/architecture/contract-reconciliation.md §4.1): preview privacy
 * (D33/P7), the reserved excluded-participant token (D31), the closed warning-code list (D31/P9),
 * the preview shape (P11) and the parse context (D32/P6). Identity (P1/P2/P10), rule matching
 * (P4/P5), context binding (P6) and returned input failures (P8) are covered in
 * lib/privacy/__tests__/identity.test.ts, lib/privacy/__tests__/exclusions.test.ts and
 * lib/parsers/__tests__/limits-and-inputs.test.ts.
 */

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildPdf, bytesOf } from "../../../fixtures/parser/builders";
import { fixtureBytes, input, participantRule } from "../../../fixtures/parser/load";
import { MASK_KINDS } from "../../contracts/enums";
import {
  EXCLUDED_PARTICIPANT_TOKEN,
  PARSER_WARNING_CODES,
  type ExclusionRule,
  type ParseSourceInput,
  type SourcePreview,
} from "../../contracts/parser";
import { EXCLUDED_PARTICIPANT_TOKEN as REDACTOR_TOKEN } from "../../privacy/excluded-mentions";
import { maskText } from "../../privacy/mask";
import { LIMITS } from "../limits";
import { parseSource, previewSource } from "../parse-source";
import { PARSER_VERSION } from "../version";

const chatInput = (lines: string[], over: Partial<ParseSourceInput> = {}): ParseSourceInput =>
  input({ kind: "whatsapp_export", bytes: bytesOf(lines.join("\n") + "\n"), dateOrder: "dmy", timezone: "UTC", ...over });

async function both(i: ParseSourceInput) {
  const p = await previewSource(i);
  const s = await parseSource(i);
  assert.ok(p.ok, p.ok ? "" : JSON.stringify(p.error));
  assert.ok(s.ok, s.ok ? "" : JSON.stringify(s.error));
  return { preview: p.data, parsed: s.data };
}

describe("D33/P7: preview never exposes an excluded participant", () => {
  const lines = [
    "01/03/2024, 09:00 - Asha Rao: morning, Ravi Kumar sent the list",
    "01/03/2024, 09:01 - Ravi Kumar: private: my list is attached",
    "01/03/2024, 09:02 - Ravi Kumar's Mom: tell @Ravi Kumar to eat",
    "01/03/2024, 23:00 - Ravi Kumar: late private note",
    "02/03/2024, 09:00 - Asha Rao: next day",
  ];
  const rules: ExclusionRule[] = [participantRule("Ravi Kumar")];

  it("not in participants, labels, previews, counts or time range", async () => {
    const { preview, parsed } = await both(chatInput(lines, { exclusions: rules }));
    for (const out of [preview, parsed]) {
      const json = JSON.stringify(out);
      assert.ok(!json.includes("Ravi"), json);
      assert.ok(!json.includes("private"), json);
      assert.ok(!out.participants.some((p) => p.localId === "p_2"));
      // The kept relative's label named the excluded person: it is anonymised.
      assert.deepEqual(out.participants.map((p) => p.displayLabel), ["Asha Rao", "Participant 3"]);
      for (const c of out.conversations) assert.ok(!c.participantLocalIds.includes("p_2"));
      // The 23:00 message was Ravi's; the retained range ends with Asha's next-day message.
      assert.equal(out.firstMessageAt, "2024-03-01T09:00:00.000Z");
      assert.equal(out.lastMessageAt, "2024-03-02T09:00:00.000Z");
      // Only aggregates remain.
      assert.equal(out.stats.messagesExcluded, 2);
      assert.equal(out.stats.messagesKept, 3);
      assert.ok(out.warnings.some((w) => w.code === "excluded_mentions_redacted"));
    }
    assert.equal(preview.conversations[0].preview, `morning, ${EXCLUDED_PARTICIPANT_TOKEN} sent the list`);
  });

  it("conversation counts and ranges come from retained messages only", async () => {
    const { preview } = await both(chatInput(lines, { exclusions: rules }));
    // 09:02 → 23:00 is a gap of more than 6 hours, so 23:00 starts c_2 (Ravi only) and is omitted.
    assert.deepEqual(
      preview.conversations.map((c) => [c.localId, c.messageCount, c.startedAt, c.endedAt]),
      [
        ["c_1", 2, "2024-03-01T09:00:00.000Z", "2024-03-01T09:02:00.000Z"],
        ["c_3", 1, "2024-03-02T09:00:00.000Z", "2024-03-02T09:00:00.000Z"],
      ],
    );
  });

  it("warnings never point at an excluded line; their code and message stay", async () => {
    const dst = [
      "03/10/2024, 01:00 - Asha Rao: before",
      "03/10/2024, 02:30 - Ravi Kumar: inside the spring-forward gap",
      "03/10/2024, 02:45 - Asha Rao: also inside the gap",
    ];
    const i = chatInput(dst, { timezone: "America/New_York", dateOrder: "mdy", exclusions: rules });
    const { preview, parsed } = await both(i);
    for (const out of [preview, parsed]) {
      const gaps = out.warnings.filter((w) => w.code === "dst_gap");
      assert.equal(gaps.length, 2);
      assert.deepEqual(gaps.map((w) => w.line), [undefined, 3]);
      assert.ok(gaps.every((w) => w.message.length > 0));
    }
    // Without the exclusion both lines are reported.
    const plain = await parseSource({ ...i, exclusions: [] });
    assert.ok(plain.ok);
    assert.deepEqual(plain.data.warnings.filter((w) => w.code === "dst_gap").map((w) => w.line), [2, 3]);
  });

  it("a warning inside an excluded message's continuation lines loses its line too", async () => {
    const withBadHeader = [
      "01/03/2024, 09:00 - Asha Rao: hello",
      "01/03/2024, 09:01 - Ravi Kumar: start",
      "41/03/2024, 09:02 - Ravi Kumar: invalid date kept as continuation",
      "01/03/2024, 09:03 - Asha Rao: bye",
    ];
    const { preview } = await both(chatInput(withBadHeader, { exclusions: rules }));
    const invalid = preview.warnings.filter((w) => w.code === "invalid_timestamp");
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0].line, undefined);
  });

  it("participant and date-range rules give a preview identical to the parse minus messages", async () => {
    const { preview, parsed } = await both(
      chatInput(lines, { exclusions: [...rules, { kind: "date_range", rangeStart: "2024-03-02T00:00:00Z" }] }),
    );
    const rest: Partial<typeof parsed> = { ...parsed };
    delete rest.messages;
    assert.deepEqual(preview, rest);
  });
});

describe("D31: [EXCLUDED_PARTICIPANT] is reserved and is not a mask token", () => {
  it("the parser uses the contract's token", () => {
    assert.equal(REDACTOR_TOKEN, EXCLUDED_PARTICIPANT_TOKEN);
  });
  it("is not counted in masking, never numbered, and survives masking unchanged", async () => {
    const lines = [
      "01/03/2024, 09:00 - Ravi Kumar: hi",
      "01/03/2024, 09:01 - Asha Rao: I told Ravi Kumar and @Ravi Kumar twice",
    ];
    const { parsed } = await both(chatInput(lines, { exclusions: [participantRule("Ravi Kumar")] }));
    assert.equal(parsed.messages[0].body, `I told ${EXCLUDED_PARTICIPANT_TOKEN} and ${EXCLUDED_PARTICIPANT_TOKEN} twice`);
    assert.ok(Object.values(parsed.masking.counts).every((n) => n === 0), JSON.stringify(parsed.masking.counts));
    assert.ok(!(MASK_KINDS as readonly string[]).includes("excluded_participant"));
    assert.ok(!/\[EXCLUDED_PARTICIPANT_\d+\]/.test(JSON.stringify(parsed)));
    const m = maskText({ text: `x ${EXCLUDED_PARTICIPANT_TOKEN} y`, context: "chat" });
    assert.equal(m.text, `x ${EXCLUDED_PARTICIPANT_TOKEN} y`);
    assert.ok(Object.values(m.counts).every((n) => n === 0));
  });
  it("is distinct from mask tokens in the same message", async () => {
    const lines = [
      "01/03/2024, 09:00 - Ravi Kumar: hi",
      "01/03/2024, 09:01 - Asha Rao: Ravi Kumar's number is +44 20 7946 0958",
    ];
    const { parsed } = await both(chatInput(lines, { exclusions: [participantRule("Ravi Kumar")] }));
    assert.equal(parsed.messages[0].body, `${EXCLUDED_PARTICIPANT_TOKEN}'s number is [PHONE_1]`);
    assert.equal(parsed.masking.counts.phone, 1);
  });
});

describe("D31/P9: only ratified warning codes are emitted", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(join(HERE, "../../../fixtures/parser/whatsapp")).filter((f) => f.endsWith(".txt"));

  it("every fixture's warnings use PARSER_WARNING_CODES", async () => {
    let checked = 0;
    for (const f of files) {
      for (const dateOrder of [undefined, "dmy", "mdy", "ymd"] as const) {
        const r = await previewSource(input({ kind: "whatsapp_export", bytes: fixtureBytes(`whatsapp/${f}`), dateOrder }));
        if (!r.ok) continue;
        checked++;
        for (const w of r.data.warnings) assert.ok((PARSER_WARNING_CODES as readonly string[]).includes(w.code), w.code);
      }
    }
    assert.ok(checked > 0);
  });
  it("excluded_mentions_redacted survives the warning cap and warnings_truncated stays last", async () => {
    const lines = [
      "01/01/2024, 10:00 - Ravi Kumar: x",
      "01/01/2024, 10:01 - Asha Rao: hi Ravi Kumar",
      ...Array.from({ length: 500 }, () => "41/01/2024, 10:00 - Asha Rao: bad"),
    ];
    const { preview, parsed } = await both(chatInput(lines, { exclusions: [participantRule("Ravi Kumar")] }));
    for (const out of [preview, parsed]) {
      assert.equal(out.warnings.length, LIMITS.maxWarnings + 2);
      assert.equal(out.warnings.at(-2)?.code, "excluded_mentions_redacted");
      assert.equal(out.warnings.at(-1)?.code, "warnings_truncated");
      assert.equal(out.warnings.filter((w) => w.code === "warnings_truncated").length, 1);
    }
  });
});

describe("P11/P6: preview shape and parse context", () => {
  it("SourcePreview has exactly the contract's fields, including parserVersion, parseContext and identityMatches", async () => {
    const r = await previewSource(input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/android-24h-dmy.txt") }));
    assert.ok(r.ok);
    const keys: Array<keyof SourcePreview> = [
      "conversations",
      "firstMessageAt",
      "identityMatches",
      "kind",
      "lastMessageAt",
      "masking",
      "parseContext",
      "parserVersion",
      "participants",
      "stats",
      "warnings",
    ];
    assert.deepEqual(Object.keys(r.data).sort(), keys);
    assert.equal(r.data.parserVersion, PARSER_VERSION);
    // Revision 8 changed normalization and output, so it is a new minor version (semver).
    assert.equal(PARSER_VERSION, "1.1.0");
    assert.equal(r.data.parseContext.parserVersion, "1.1.0");
    assert.deepEqual(r.data.identityMatches, []);
  });
  it("the context reports the EFFECTIVE date order, detected or supplied", async () => {
    const detected = await previewSource(input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/android-12h-mdy.txt") }));
    assert.ok(detected.ok);
    assert.equal(detected.data.parseContext.dateOrder, "mdy");
    const supplied = await previewSource(
      input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/ambiguous-dates.txt"), dateOrder: "mdy", timezone: "UTC" }),
    );
    assert.ok(supplied.ok);
    assert.deepEqual(supplied.data.parseContext, { timezone: "UTC", dateOrder: "mdy", parserVersion: PARSER_VERSION });
  });
  it("the parse context is a copy: mutating it does not affect later parses", async () => {
    const i = input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/android-24h-dmy.txt") });
    const a = await previewSource(i);
    assert.ok(a.ok);
    a.data.parseContext.timezone = "UTC";
    const b = await previewSource(i);
    assert.ok(b.ok);
    assert.equal(b.data.parseContext.timezone, "Asia/Kolkata");
  });
  it("phone senders are reported with identityKind phone and p1", async () => {
    const { parsed } = await both(chatInput(["01/03/2024, 09:00 - +91 99999 00001: hi", "01/03/2024, 09:01 - Asha Rao: hello"]));
    assert.deepEqual(
      parsed.participants.map((p) => [p.displayLabel, p.identityKind, p.identityPepperVersion]),
      [
        ["Participant 1", "phone", "p1"],
        ["Asha Rao", "name", "p1"],
      ],
    );
  });
});

describe("final review: defects propagate, hostile input does not crash", () => {
  it("a page with 150,000 lines parses (no stack overflow computing line gaps)", async () => {
    const lines = Array.from({ length: 150_000 }, (_, i) => `line ${i}`);
    const bytes = buildPdf([{ paragraphs: [lines] }], { compress: true });
    const r = await parseSource(input({ kind: "pdf", bytes }));
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
    assert.ok(r.data.messages.length >= 1);
    assert.ok(r.data.messages.some((m) => m.body.includes("line 149999")));
  });
  it("a corrupt deflate stream is skipped with pdf_decode_failures; other pages are kept", async () => {
    const bytes = buildPdf([{ paragraphs: [["first page"]] }, { paragraphs: [["second page survives"]] }], { compress: true });
    // Break the zlib header of the first stream ("incorrect header check" → Z_DATA_ERROR).
    const marker = new TextEncoder().encode("stream\n");
    let at = -1;
    for (let i = 0; i + marker.length <= bytes.length && at < 0; i++) {
      if (marker.every((b, j) => bytes[i + j] === b)) at = i + marker.length;
    }
    assert.ok(at > 0);
    const corrupt = bytes.slice();
    corrupt[at] = 0xff;
    corrupt[at + 1] = 0xff;
    const r = await parseSource(input({ kind: "pdf", bytes: corrupt }));
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
    assert.ok(r.data.warnings.some((w) => w.code === "pdf_decode_failures"));
    assert.ok(r.data.messages.some((m) => m.body.includes("second page survives")));
    assert.ok(!r.data.messages.some((m) => m.body.includes("first page")));
  });
});
