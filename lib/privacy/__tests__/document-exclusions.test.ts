// R3 Task 02 (PRIV-3): excluded people are removed from documents exactly like from chats. Synthetic data.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDocx, buildPdf, bytesOf } from "../../../fixtures/parser/builders";
import { input, participantRule, TEST_PEPPER } from "../../../fixtures/parser/load";
import type { ParsedSource, ParseSourceInput } from "../../contracts/parser";
import { parseSource, previewSource } from "../../parsers/parse-source";
import { compileExclusions } from "../exclusions";
import { discoverExcludedNames } from "../excluded-discovery";

const TOKEN = "[EXCLUDED_PARTICIPANT]";

async function ok(i: ParseSourceInput): Promise<ParsedSource> {
  const r = await parseSource(i);
  assert.ok(r.ok, JSON.stringify(r));
  return r.data;
}

const rules = [participantRule("Ravi Kumar"), participantRule("Meera")];
const LINES = [
  "Ravi Kumar handles the bank login.",
  "Ask RAVI  KUMAR or @Ravi Kumar about the stall; Ravi Kumar's notes are in the drive.",
  "Ravi Kumar Singh is a different, kept person. Ravindra Kumar too.",
  "@Meera has the keys; meera time is ordinary text.",
  "Priya Sharma keeps the receipts.",
];

function assertRedacted(s: ParsedSource) {
  const text = s.messages.map((m) => `${m.location?.heading ?? ""} ${m.body}`).join("\n");
  // A document has no senders, so a longer name that merely starts with the excluded one cannot be told apart
  // from a mention: it is over-redacted (the safe failure, same as chats for people who are not senders).
  assert.ok(text.includes(`${TOKEN} Singh`), "over-redaction of an unknown extended name is the safe failure");
  assert.ok(text.includes("Ravindra Kumar"), "a longer word is never matched");
  assert.ok(text.includes("Priya Sharma"), "unrelated names are kept");
  assert.ok(text.includes("meera time"), "a single-word name in free text is left alone (same rule as chats)");
  assert.equal(/ravi\s+kumar/i.test(text), false, "every form of the excluded name is gone");
  assert.equal(/@meera/i.test(text), false, "an @mention of a single-word excluded name is gone");
  assert.ok((text.match(/\[EXCLUDED_PARTICIPANT\]/g) ?? []).length >= 5);
  assert.ok(s.warnings.some((w) => w.code === "excluded_mentions_redacted"));
}

describe("document exclusion parity", () => {
  it("Markdown (bodies and headings)", async () => {
    const md = `# Notes from Ravi Kumar\n\n${LINES.join("\n\n")}\n`;
    const s = await ok(input({ kind: "markdown", bytes: bytesOf(md), exclusions: rules }));
    assertRedacted(s);
    assert.ok(s.messages.every((m) => !(m.location?.heading ?? "").includes("Ravi")), "heading redacted");
  });

  it("plain text", async () => {
    assertRedacted(await ok(input({ kind: "text", bytes: bytesOf(LINES.join("\n\n")), exclusions: rules })));
  });

  it("DOCX", async () => {
    assertRedacted(await ok(input({ kind: "docx", bytes: buildDocx(LINES.map((text) => ({ text }))), exclusions: rules })));
  });

  it("PDF", async () => {
    const pdf = buildPdf([{ paragraphs: LINES.map((l) => [l]) }]);
    assertRedacted(await ok(input({ kind: "pdf", bytes: pdf, exclusions: rules })));
  });

  it("the preview applies the same redaction (nothing excluded is shown before processing)", async () => {
    const r = await previewSource(input({ kind: "text", bytes: bytesOf(LINES.join("\n\n")), exclusions: rules }));
    assert.ok(r.ok);
    assert.equal(JSON.stringify(r.data).includes("RAVI"), false);
  });

  it("documents are unchanged when nobody is excluded", async () => {
    const a = await ok(input({ kind: "text", bytes: bytesOf(LINES.join("\n\n")) }));
    const b = await ok(input({ kind: "text", bytes: bytesOf(LINES.join("\n\n")), exclusions: [participantRule("Someone Else")] }));
    assert.deepEqual(b.messages, a.messages);
    assert.equal(JSON.stringify(a).includes(TOKEN), false);
  });

  it("detect-mode rules never redact (a human decision is pending); only apply rules do", async () => {
    const s = await ok(input({ kind: "text", bytes: bytesOf("Ravi Kumar paid."), exclusions: [participantRule("Ravi Kumar", "detect")] }));
    assert.equal(s.messages[0].body, "Ravi Kumar paid.");
  });
});

describe("excluded-name discovery (hash-only rules)", () => {
  it("finds a name written in any case or spacing, never a partial or longer one", () => {
    const c = compileExclusions([participantRule("Ravi Kumar")]);
    const found = discoverExcludedNames(["hello RAVI   KUMAR!"], c, TEST_PEPPER);
    assert.deepEqual(found.map((s) => s.toLowerCase().replace(/\s+/g, " ")), ["ravi kumar"]);
    assert.deepEqual(discoverExcludedNames(["Ravi Kumaran", "Ravi", "Kumar"], c, TEST_PEPPER), []);
  });

  it("finds Devanagari and hyphenated names", () => {
    const c = compileExclusions([participantRule("रवि कुमार"), participantRule("Mary-Jane Watson")]);
    assert.equal(discoverExcludedNames(["कल रवि कुमार आएगा", "and mary-jane watson"], c, TEST_PEPPER).length, 2);
  });

  it("is a no-op without apply name rules", () => {
    assert.deepEqual(discoverExcludedNames(["Ravi Kumar"], compileExclusions([participantRule("Ravi Kumar", "detect")]), TEST_PEPPER), []);
    assert.deepEqual(discoverExcludedNames(["Ravi Kumar"], compileExclusions([]), TEST_PEPPER), []);
  });
});

describe("chat exclusion parity: handover-wide excluded people who never wrote in this chat", () => {
  it("their names are removed from other people's messages too", async () => {
    const chat = ["20/02/2024, 08:00 - Asha Rao: Ravi Kumar will pay the deposit", "20/02/2024, 08:01 - Priya Sharma: ok", ""].join("\n");
    const s = await ok(input({ kind: "whatsapp_export", bytes: bytesOf(chat), exclusions: [participantRule("Ravi Kumar")] }));
    assert.equal(s.messages[0].body, `${TOKEN} will pay the deposit`);
    assert.equal(s.participants.length, 2);
  });
});
