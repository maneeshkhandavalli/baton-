import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bytesOf } from "../../../fixtures/parser/builders";
import { fixtureBytes, input, fileError, inputFailure } from "../../../fixtures/parser/load";
import {
  PARSER_INPUT_ERROR_APP_CODES,
  PARSER_LIMITS,
  isParserInputFailure,
  type ParseSourceInput,
} from "../../contracts/parser";
import { LIMITS } from "../limits";
import { parseSource, previewSource } from "../parse-source";
import { wallTimeToUtc } from "../timezone";

const CHAT = fixtureBytes("whatsapp/android-24h-dmy.txt");

describe("limits", () => {
  it("uses the canonical contract limits", () => {
    assert.equal(LIMITS.maxFileBytes, PARSER_LIMITS.maxFileBytes);
    assert.equal(LIMITS.maxMessagesPerSource, PARSER_LIMITS.maxMessagesPerSource);
  });
  it("rejects files over 25 MB with payload_too_large", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: new Uint8Array(PARSER_LIMITS.maxFileBytes + 1) }));
    assert.ok(!r.ok);
    assert.equal(r.error.code, "payload_too_large");
    assert.equal(fileError(r).details.parserCode, "too_large");
  });
  it("rejects chats over 200,000 messages (counted before exclusions)", async () => {
    const line = "01/01/2024, 10:00 - A: x\n";
    const bytes = bytesOf(line.repeat(PARSER_LIMITS.maxMessagesPerSource + 1));
    const r = await parseSource(input({ kind: "whatsapp_export", bytes }));
    assert.ok(!r.ok);
    assert.equal(fileError(r).details.parserCode, "too_large");
  });
  it("accepts exactly 200,000 messages", async () => {
    const bytes = bytesOf("01/01/2024, 10:00 - A: x\n".repeat(PARSER_LIMITS.maxMessagesPerSource));
    const r = await previewSource(input({ kind: "whatsapp_export", bytes }));
    assert.ok(r.ok);
    assert.equal(r.data.stats.messagesKept, PARSER_LIMITS.maxMessagesPerSource);
  });
  it("rejects pathological line lengths", async () => {
    const bytes = bytesOf("01/01/2024, 10:00 - A: " + "x".repeat(LIMITS.maxLineChars + 1));
    const r = await parseSource(input({ kind: "whatsapp_export", bytes }));
    assert.ok(!r.ok);
    assert.equal(fileError(r).details.parserCode, "unsupported_format");
  });
  it("caps the number of warnings", async () => {
    const bytes = bytesOf("01/01/2024, 10:00 - A: x\n" + "41/01/2024, 10:00 - A: bad\n".repeat(500));
    const r = await parseSource(input({ kind: "whatsapp_export", bytes }));
    assert.ok(r.ok);
    assert.equal(r.data.warnings.length, LIMITS.maxWarnings + 1);
    assert.equal(r.data.warnings[r.data.warnings.length - 1].code, "warnings_truncated");
  });
});

describe("input contract: failures are returned, never thrown (D34, P8)", () => {
  const base = (): ParseSourceInput => input({ kind: "whatsapp_export", bytes: CHAT });
  const PEPPER_FAILURE = { inputCode: "identity_pepper_invalid", field: "identityPepper" };
  const bad: Array<[string, Partial<ParseSourceInput>, string, { inputCode: string; field: string }]> = [
    ["missing pepper", { identityPepper: undefined as unknown as string }, "processing_failed", PEPPER_FAILURE],
    ["empty pepper", { identityPepper: "" }, "processing_failed", PEPPER_FAILURE],
    ["short pepper", { identityPepper: "too-short" }, "processing_failed", PEPPER_FAILURE],
    ["31-character pepper", { identityPepper: "p".repeat(31) }, "processing_failed", PEPPER_FAILURE],
    ["padded pepper", { identityPepper: ` ${"p".repeat(40)}` }, "processing_failed", PEPPER_FAILURE],
    ["non-string pepper", { identityPepper: 42 as unknown as string }, "processing_failed", PEPPER_FAILURE],
    ["invalid timezone", { timezone: "Mars/Olympus" }, "validation_failed", { inputCode: "timezone_invalid", field: "timezone" }],
    ["empty timezone", { timezone: "" }, "validation_failed", { inputCode: "timezone_invalid", field: "timezone" }],
    ["missing timezone", { timezone: undefined as unknown as string }, "validation_failed", { inputCode: "timezone_invalid", field: "timezone" }],
    ["invalid dateOrder", { dateOrder: "ydm" as never }, "validation_failed", { inputCode: "date_order_invalid", field: "dateOrder" }],
    ["bytes not a Uint8Array", { bytes: "text" as unknown as Uint8Array }, "validation_failed", { inputCode: "input_invalid", field: "bytes" }],
    ["missing fileName", { fileName: undefined as unknown as string }, "validation_failed", { inputCode: "input_invalid", field: "fileName" }],
    ["unknown kind", { kind: "telegram" as never }, "validation_failed", { inputCode: "input_invalid", field: "kind" }],
    ["missing exclusions", { exclusions: undefined as never }, "validation_failed", { inputCode: "input_invalid", field: "exclusions" }],
  ];
  for (const [name, override, appCode, details] of bad) {
    for (const entry of [parseSource, previewSource]) {
      it(`${entry === parseSource ? "parseSource" : "previewSource"}: ${name}`, async () => {
        const r = await entry({ ...base(), ...override });
        const f = inputFailure(r);
        assert.ok(isParserInputFailure(f));
        assert.equal(f.code, appCode);
        assert.equal(f.code, PARSER_INPUT_ERROR_APP_CODES[f.details.inputCode]);
        assert.deepEqual(f.details, details);
        // A pepper problem is a retryable configuration failure; the others need new input.
        assert.equal(f.retryable, details.inputCode === "identity_pepper_invalid");
        assert.deepEqual(Object.keys(f).sort(), ["code", "details", "message", "retryable"]);
      });
    }
  }
  it("a missing or non-object input is returned as input_invalid", async () => {
    for (const value of [undefined, null, "x", 7]) {
      const r = await parseSource(value as never);
      assert.deepEqual(inputFailure(r).details, { inputCode: "input_invalid", field: "input" });
    }
  });
  it("pepper is required even for documents", async () => {
    const r = await parseSource(input({ kind: "markdown", bytes: bytesOf("# hi"), identityPepper: "" }));
    assert.equal(inputFailure(r).details.inputCode, "identity_pepper_invalid");
  });
  it("input is validated before the file is read: a bad pepper wins over an empty file", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: new Uint8Array(0), identityPepper: "short" }));
    assert.equal(inputFailure(r).details.inputCode, "identity_pepper_invalid");
  });
  it("failure messages never contain the pepper, timezone or rule values", async () => {
    const pepper = " leaky-pepper-value-0123456789abcdef-0123456789";
    const r = await parseSource({ ...base(), identityPepper: pepper, timezone: "Not/AZone" });
    const json = JSON.stringify(inputFailure(r));
    assert.ok(!json.includes("leaky-pepper"));
    const t = await parseSource({ ...base(), timezone: "Not/AZone" });
    assert.ok(!JSON.stringify(inputFailure(t)).includes("Not/AZone"));
  });
  it("file problems are still ParserErrors, not input failures", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: new Uint8Array(0) }));
    assert.equal(fileError(r).details.parserCode, "empty_source");
  });
});

describe("error shape", () => {
  it("is a contract ParserError with a user-safe message and no content", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: fixtureBytes("whatsapp/conflicting-dates.txt") }));
    assert.ok(!r.ok);
    assert.deepEqual(Object.keys(r.error).sort(), ["code", "details", "message", "retryable"]);
    assert.ok(!r.error.message.includes("Asha"));
    assert.equal(typeof r.error.message, "string");
  });
});

describe("timezone conversion", () => {
  it("Asia/Kolkata has a fixed +05:30 offset", () => {
    const r = wallTimeToUtc({ year: 2024, month: 6, day: 1, hour: 0, minute: 0, second: 0 }, "Asia/Kolkata");
    assert.equal(r.iso, "2024-05-31T18:30:00.000Z");
    assert.equal(r.nonexistent, false);
  });
  it("ambiguous fall-back times resolve to the earlier instant", () => {
    // 2024-11-03 01:30 occurs twice in New York (EDT then EST); earlier = EDT (-04:00).
    const r = wallTimeToUtc({ year: 2024, month: 11, day: 3, hour: 1, minute: 30, second: 0 }, "America/New_York");
    assert.equal(r.iso, "2024-11-03T05:30:00.000Z");
  });
  it("nonexistent spring-forward times are flagged", () => {
    // London skips 01:00–02:00 on 2024-03-31; the pre-transition offset (GMT) is used.
    const r = wallTimeToUtc({ year: 2024, month: 3, day: 31, hour: 1, minute: 30, second: 0 }, "Europe/London");
    assert.equal(r.nonexistent, true);
    assert.equal(r.iso, "2024-03-31T01:30:00.000Z");
    const ok = wallTimeToUtc({ year: 2024, month: 3, day: 31, hour: 2, minute: 30, second: 0 }, "Europe/London");
    assert.equal(ok.nonexistent, false);
    assert.equal(ok.iso, "2024-03-31T01:30:00.000Z");
  });
});
