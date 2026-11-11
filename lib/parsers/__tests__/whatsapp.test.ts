import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TEST_PEPPER, fixtureBytes, input, fileError } from "../../../fixtures/parser/load";
import type { ParsedSource } from "../../contracts/parser";
import { computeIdentityHash } from "../../privacy/identity";
import { parseSource, previewSource } from "../parse-source";

async function parsed(file: string, extra: Partial<Parameters<typeof input>[0]> = {}): Promise<ParsedSource> {
  const r = await parseSource(input({ kind: "whatsapp_export", bytes: fixtureBytes(file), ...extra }));
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

function bodies(s: ParsedSource): string[] {
  return s.messages.map((m) => m.body);
}

describe("WhatsApp Android, 24-hour, day-first", () => {
  it("parses messages, kinds, multi-line bodies and timestamps", async () => {
    const s = await parsed("whatsapp/android-24h-dmy.txt");
    assert.equal(s.kind, "whatsapp_export");
    assert.equal(s.parserVersion, "1.1.0");
    assert.equal(s.messages.length, 13);
    // 21:15 IST = 15:45 UTC
    assert.equal(s.messages[0].sentAt, "2023-12-31T15:45:00.000Z");
    assert.equal(s.messages[0].kind, "system");
    assert.equal(s.messages[0].participantLocalId, null);
    assert.equal(s.messages[1].kind, "system"); // created group
    assert.equal(s.messages[2].kind, "system"); // added
    assert.equal(s.messages[3].kind, "text");
    assert.equal(s.messages[5].body, "Budget sheet is in the drive.\nSecond line of the same message.\nThird line.");
    assert.deepEqual(s.messages[5].location, { lineStart: 6, lineEnd: 8 });
    assert.equal(s.messages[6].kind, "media_omitted");
    assert.equal(s.messages[6].body, "");
    assert.equal(s.messages[7].kind, "deleted");
    assert.equal(s.messages[7].body, "");
    assert.equal(s.messages[8].body, "Venue is booked for Friday"); // edited marker stripped
    // A colon inside a system line does not create a fake sender.
    assert.equal(s.messages[11].kind, "system");
    assert.equal(s.messages[12].kind, "system"); // left
    assert.deepEqual(s.messages.map((m) => m.seq), s.messages.map((_, i) => i));
  });

  it("masks PII in bodies before output", async () => {
    const s = await parsed("whatsapp/android-24h-dmy.txt");
    assert.ok(!bodies(s).some((b) => b.includes("meera.sponsor@example.org")));
    assert.ok(s.messages[4].body.includes("[EMAIL_1]"));
    assert.equal(s.masking.counts.email, 1);
  });

  it("detects participants, hashes them, and hides phone-number senders", async () => {
    const s = await parsed("whatsapp/android-24h-dmy.txt");
    assert.deepEqual(
      s.participants.map((p) => [p.localId, p.displayLabel, p.messageCount]),
      [
        ["p_1", "Asha Rao", 3],
        ["p_2", "Ravi Kumar", 4],
        ["p_3", "Participant 3", 1],
      ],
    );
    assert.equal(s.participants[0].identityHash, computeIdentityHash("Asha Rao", TEST_PEPPER));
    assert.ok(!JSON.stringify(s).includes("99999"), "raw phone number leaked");
  });

  it("segments conversations on gaps over 6 hours", async () => {
    const s = await parsed("whatsapp/android-24h-dmy.txt");
    assert.equal(s.conversations.length, 2);
    assert.equal(s.conversations[0].localId, "c_1");
    assert.equal(s.conversations[0].messageCount, 9);
    assert.equal(s.conversations[1].messageCount, 4);
    assert.equal(s.conversations[1].startedAt, "2024-01-01T04:00:00.000Z");
    assert.equal(s.conversations[0].preview, "Welcome everyone! Handover notes go here.");
    assert.deepEqual(s.conversations[1].participantLocalIds, ["p_2", "p_3"]);
    assert.equal(s.firstMessageAt, "2023-12-31T15:45:00.000Z");
    assert.equal(s.lastMessageAt, "2024-01-01T04:03:00.000Z");
  });

  it("reports stats", async () => {
    const s = await parsed("whatsapp/android-24h-dmy.txt");
    assert.deepEqual(s.stats, { totalLines: 15, messagesKept: 13, messagesExcluded: 0, systemMessages: 5, mediaOmitted: 1 });
  });

  it("is deterministic", async () => {
    const a = await parsed("whatsapp/android-24h-dmy.txt");
    const b = await parsed("whatsapp/android-24h-dmy.txt");
    assert.deepEqual(a, b);
  });

  it("converts with the given timezone", async () => {
    const s = await parsed("whatsapp/android-24h-dmy.txt", { timezone: "UTC" });
    assert.equal(s.messages[0].sentAt, "2023-12-31T21:15:00.000Z");
  });
});

describe("WhatsApp Android, 12-hour, month-first", () => {
  it("parses AM/PM including 12 AM / 12 PM and narrow no-break spaces", async () => {
    const s = await parsed("whatsapp/android-12h-mdy.txt", { timezone: "UTC" });
    const times = s.messages.map((m) => m.sentAt);
    assert.equal(times[0], "2023-12-31T21:15:00.000Z");
    assert.equal(times[4], "2023-12-31T23:59:00.000Z");
    assert.equal(times[5], "2024-01-01T00:00:00.000Z"); // 12:00 AM
    assert.equal(times[6], "2024-01-01T12:30:00.000Z"); // 12:30 PM
  });
  it("treats attachments as media and keeps captions as text", async () => {
    const s = await parsed("whatsapp/android-12h-mdy.txt");
    assert.equal(s.messages[2].kind, "media_omitted");
    assert.equal(s.messages[3].kind, "text");
    assert.equal(s.messages[3].body, "Poster draft for the fest");
  });
});

describe("WhatsApp iOS", () => {
  it("parses bracketed headers, LRM-marked system lines, media, deleted and edited", async () => {
    const s = await parsed("whatsapp/ios-12h-dmy.txt");
    const kinds = s.messages.map((m) => m.kind);
    assert.deepEqual(kinds, ["system", "system", "text", "media_omitted", "media_omitted", "deleted", "text", "media_omitted", "text", "text"]);
    // The group name is not a participant.
    assert.ok(!s.participants.some((p) => p.displayLabel === "Robotics Club Core"));
    assert.equal(s.messages[6].body, "Room key is with the lab assistant");
    assert.equal(s.messages[0].sentAt, "2024-01-15T04:30:00.000Z");
  });
  it("keeps an invalid header as continuation text and warns", async () => {
    const s = await parsed("whatsapp/ios-12h-dmy.txt");
    assert.ok(s.messages[2].body.endsWith("This header has an impossible 12-hour time."));
    assert.ok(s.warnings.some((w) => w.code === "invalid_timestamp" && w.line === 4));
    const lunch = s.messages[8];
    assert.equal(lunch.body, "Lunch done, back to planning\nacross two lines");
  });
  it("hides bidi-wrapped phone senders", async () => {
    const s = await parsed("whatsapp/ios-12h-dmy.txt");
    const last = s.participants[s.participants.length - 1];
    assert.equal(last.displayLabel, `Participant ${last.localId.slice(2)}`);
    assert.equal(last.identityHash, computeIdentityHash("+919999900002", TEST_PEPPER));
  });
  it("parses ISO-style ymd dates without needing dateOrder", async () => {
    const s = await parsed("whatsapp/ios-24h-ymd.txt", { timezone: "UTC" });
    assert.equal(s.messages[1].sentAt, "2024-03-05T18:01:30.000Z");
  });
});

describe("date-order detection", () => {
  it("fails with date_format_ambiguous when the data cannot decide", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/ambiguous-dates.txt") }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, "parse_failed");
    assert.equal(fileError(r).details.parserCode, "date_format_ambiguous");
    assert.equal(r.error.retryable, false);
  });
  it("preview also reports the ambiguity", async () => {
    const r = await previewSource(input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/ambiguous-dates.txt") }));
    assert.ok(!r.ok);
    assert.equal(fileError(r).details.parserCode, "date_format_ambiguous");
  });
  it("uses dateOrder when given", async () => {
    const dmy = await parsed("whatsapp/ambiguous-dates.txt", { dateOrder: "dmy", timezone: "UTC" });
    const mdy = await parsed("whatsapp/ambiguous-dates.txt", { dateOrder: "mdy", timezone: "UTC" });
    assert.equal(dmy.messages[0].sentAt, "2024-04-03T10:00:00.000Z");
    assert.equal(mdy.messages[0].sentAt, "2024-03-04T10:00:00.000Z");
  });
  it("rejects a dateOrder the data contradicts", async () => {
    const r = await parseSource(
      input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/android-24h-dmy.txt"), dateOrder: "mdy" }),
    );
    assert.ok(!r.ok);
    assert.equal(fileError(r).details.parserCode, "date_format_ambiguous");
    assert.equal(fileError(r).details.line, 1);
  });
  it("rejects files mixing day-first and month-first dates", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/conflicting-dates.txt") }));
    assert.ok(!r.ok);
    assert.equal(fileError(r).details.parserCode, "date_format_ambiguous");
    assert.equal(fileError(r).details.line, 2);
  });
  it("needs no dateOrder when day equals month everywhere", async () => {
    const text = "01/01/2024, 10:00 - Asha: a\n02/02/2024, 10:00 - Asha: b\n";
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: new TextEncoder().encode(text) }));
    assert.ok(r.ok);
  });
});

describe("malformed input", () => {
  it("drops orphan lines before the first header with a warning", async () => {
    const s = await parsed("whatsapp/malformed.txt");
    assert.equal(s.messages.length, 3);
    assert.ok(s.warnings.some((w) => w.code === "orphan_lines"));
    assert.ok(!bodies(s).some((b) => b.includes("came before")));
  });
  it("keeps invalid-date header lines as continuation and preserves blank lines inside a message", async () => {
    const s = await parsed("whatsapp/malformed.txt");
    assert.equal(s.messages[0].body, "First real message\n40/02/2024, 08:01 - Ravi Kumar: impossible date kept as continuation text");
    assert.equal(s.messages[1].body, "Second real message\n\nwith a blank line inside");
    assert.deepEqual(s.messages[1].location, { lineStart: 5, lineEnd: 7 });
  });
  it("rejects text with no WhatsApp headers", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/not-whatsapp.txt") }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, "unsupported_file_type");
    assert.equal(fileError(r).details.parserCode, "unsupported_format");
  });
  it("rejects empty and whitespace-only files", async () => {
    for (const text of ["", "   \n\n  "]) {
      const r = await parseSource(input({ kind: "whatsapp_export", bytes: new TextEncoder().encode(text) }));
      assert.ok(!r.ok);
      assert.equal(fileError(r).details.parserCode, "empty_source");
    }
  });
  it("rejects invalid UTF-8 as encoding_error", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: new Uint8Array([0x31, 0xc3, 0x28, 0x0a]) }));
    assert.ok(!r.ok);
    assert.equal(fileError(r).details.parserCode, "encoding_error");
  });
  it("decodes UTF-16LE exports with a BOM", async () => {
    const text = "\uFEFF20/02/2024, 08:00 - Asha: hello\n";
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      bytes[i * 2] = text.charCodeAt(i) & 0xff;
      bytes[i * 2 + 1] = text.charCodeAt(i) >> 8;
    }
    const r = await parseSource(input({ kind: "whatsapp_export", bytes }));
    assert.ok(r.ok);
    assert.equal(r.data.messages[0].body, "hello");
  });
  it("warns on daylight-saving gaps instead of inventing a time silently", async () => {
    const text = "03/10/2024, 02:30 - Asha: during the spring-forward gap\n";
    const r = await parseSource(
      input({ kind: "whatsapp_export", bytes: new TextEncoder().encode(text), timezone: "America/New_York", dateOrder: "mdy" }),
    );
    assert.ok(r.ok);
    assert.ok(r.data.warnings.some((w) => w.code === "dst_gap"));
    // 02:30 does not exist on 2024-03-10 in New York; the pre-transition offset (EST, -05:00) is used.
    assert.equal(r.data.messages[0].sentAt, "2024-03-10T07:30:00.000Z");
  });
});

describe("preview", () => {
  it("returns participants, conversations and counts but no messages", async () => {
    const r = await previewSource({
      kind: "whatsapp_export",
      fileName: "x.txt",
      bytes: fixtureBytes("whatsapp/android-24h-dmy.txt"),
      timezone: "Asia/Kolkata",
      exclusions: [],
      identityPepper: TEST_PEPPER,
    });
    assert.ok(r.ok);
    assert.ok(!("messages" in r.data));
    assert.equal(r.data.participants.length, 3);
    assert.equal(r.data.conversations.length, 2);
    assert.equal(r.data.masking.counts.email, 1);
  });
  it("uses the same local ids as the final parse", async () => {
    const p = await previewSource(input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/android-24h-dmy.txt") }));
    const s = await parsed("whatsapp/android-24h-dmy.txt");
    assert.ok(p.ok);
    assert.deepEqual(p.data.participants, s.participants);
    assert.deepEqual(p.data.conversations, s.conversations);
  });
});

describe("end-to-end masking of a PII-heavy chat", () => {
  it("no raw sensitive value survives into the parsed output", async () => {
    const s = await parsed("whatsapp/pii-chat.txt", { dateOrder: "dmy" });
    const json = JSON.stringify(s);
    const raw = [
      "clubfunds@okaxis", "9999900003", "99999 00004", "099999", "001234567890", "SBIN0001234",
      "Robo@2024!", "4321", "treasurer [at] example", "sk-test1234567890", "23456789",
    ];
    for (const value of raw) assert.ok(!json.includes(value), `leaked ${value}`);
    assert.equal(s.messages[0].body, "Treasurer UPI is [UPI_1], also [UPI_2] works");
    assert.equal(s.messages[1].body, "Paid to [UPI_1], confirm?");
    // Pending phone policy (N3): the national form is not assumed Indian, so it gets its own token.
    assert.equal(s.messages[2].body, "Call me on [PHONE_1] or [PHONE_2]");
    assert.equal(s.messages[3].body, "Bank a/c no: [BANK_1] IFSC [IFSC_1]");
    assert.equal(s.messages[4].body, "wifi password: [PASSWORD] and the door pin is [PASSWORD]");
    assert.equal(s.messages[5].body, "Email [EMAIL_1] for receipts");
    assert.equal(s.messages[6].body, "Server key [API_KEY], don't share");
    assert.equal(s.messages[7].body, "Lab landline [PHONE_3]");
    assert.deepEqual(s.masking.counts, {
      phone: 3, email: 1, upi: 3, bank_account: 1, ifsc: 1, card: 0,
      government_id: 0, password: 2, api_key: 1, secret: 0,
    });
  });
});
