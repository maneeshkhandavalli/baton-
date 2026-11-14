// PROTOTYPE sample data (lib/prototype/sample-data): the CodeCell sample files must go through the REAL parser
// and masking like any upload, contain no credential-like strings, and never duplicate.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { input } from "../../../fixtures/parser/load";
import { maskText } from "../../privacy/mask";
import { CODECELL_SAMPLE_POINTS, CODECELL_SAMPLE_SOURCES, isSampleFileName, missingSampleSources, SAMPLE_SOURCE_FILE_NAMES } from "../../prototype/sample-data/codecell";
import { parseSource } from "../parse-source";

const bytes = (s: string) => new TextEncoder().encode(s);
const PLANTED = ["99999 00003", "sponsors@example.org"];

describe("prototype sample sources", () => {
  it("are exactly the registered sample file names, all recognisable as sample data", () => {
    assert.deepEqual(CODECELL_SAMPLE_SOURCES.map((s) => s.fileName), [...SAMPLE_SOURCE_FILE_NAMES]);
    for (const s of CODECELL_SAMPLE_SOURCES) {
      assert.ok(isSampleFileName(s.fileName));
      assert.ok(isSampleFileName(s.fileName.replace(/\.(txt|md)$/, "")), "the stored title without extension still counts");
    }
    assert.equal(isSampleFileName("WhatsApp Chat with Robotics Club.txt"), false);
    assert.equal(isSampleFileName(null), false);
  });

  it("the duplicate guard skips files already in the list (any extension form) and adds nothing twice", () => {
    assert.equal(missingSampleSources([]).length, CODECELL_SAMPLE_SOURCES.length);
    const names = CODECELL_SAMPLE_SOURCES.map((s) => s.fileName);
    assert.deepEqual(missingSampleSources(names), []);
    assert.deepEqual(missingSampleSources(names.map((n) => n.replace(/\.(txt|md)$/, ""))), [], "titles stored without extension");
    assert.deepEqual(missingSampleSources([names[0]]).map((s) => s.id), [CODECELL_SAMPLE_SOURCES[1].id], "only the missing one");
    assert.deepEqual(missingSampleSources(["my-own-file.txt"]).length, CODECELL_SAMPLE_SOURCES.length);
  });

  it("the WhatsApp sample parses with the real parser (day-first detected) and its planted contact details are masked", async () => {
    const chat = CODECELL_SAMPLE_SOURCES.find((s) => s.kind === "whatsapp_export")!;
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: bytes(chat.content), fileName: chat.fileName }));
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
    const text = r.data.messages.filter((m) => m.kind === "text");
    assert.ok(text.length >= 15, `${text.length} text messages`);
    assert.ok(r.data.participants.length >= 4, "Kabir, Neha, Priya and Arjun");
    const all = JSON.stringify(r.data);
    for (const p of PLANTED) assert.ok(!all.includes(p), `${p} must be masked`);
    assert.ok(text.some((m) => m.body.includes("[PHONE_1]")) && text.some((m) => m.body.includes("[EMAIL_1]")));
  });

  it("the Markdown sample parses with the real parser", async () => {
    const md = CODECELL_SAMPLE_SOURCES.find((s) => s.kind === "markdown")!;
    const r = await parseSource(input({ kind: "markdown", bytes: bytes(md.content), fileName: md.fileName }));
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
    assert.ok(r.data.messages.length >= 3);
  });

  it("contains no credential-like strings (nothing masked as a password, key or secret)", () => {
    const texts = [
      ...CODECELL_SAMPLE_SOURCES.map((s) => s.content),
      ...Object.values(CODECELL_SAMPLE_POINTS).flatMap((p) => [p.title, p.statement, ...Object.values(p.fields)]),
    ];
    for (const t of texts) {
      const masked = maskText({ text: t, context: "user_input" }).text;
      assert.doesNotMatch(masked, /\[(PASSWORD|API_KEY|SECRET|CARD|BANK|IFSC|UPI|ID)(_\d+)?\]/, `credential-like content in: ${t.slice(0, 60)}`);
    }
  });
});
