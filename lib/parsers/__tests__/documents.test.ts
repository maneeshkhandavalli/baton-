import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDocx, buildPdf, buildZip, bytesOf } from "../../../fixtures/parser/builders";
import { fixtureBytes, input, fileError } from "../../../fixtures/parser/load";
import type { ParsedSource, ParseSourceInput } from "../../contracts/parser";
import { parseSource } from "../parse-source";

async function ok(i: ParseSourceInput): Promise<ParsedSource> {
  const r = await parseSource(i);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

async function failCode(i: ParseSourceInput): Promise<string> {
  const r = await parseSource(i);
  assert.ok(!r.ok, "expected failure");
  return fileError(r).details.parserCode;
}

describe("Markdown", () => {
  it("splits into blocks with headings, line ranges and masking", async () => {
    const s = await ok(input({ kind: "markdown", bytes: fixtureBytes("documents/handover-notes.md") }));
    assert.equal(s.kind, "markdown");
    assert.deepEqual(s.participants, []);
    assert.deepEqual(s.conversations, []);
    const blocks = s.messages.map((m) => ({ body: m.body, loc: m.location }));
    assert.deepEqual(blocks[0].loc, { lineStart: 1, lineEnd: 3 }); // front matter
    assert.equal(blocks[1].body, "Robotics Club Handover");
    assert.deepEqual(blocks[1].loc, { lineStart: 5, lineEnd: 5, heading: "Robotics Club Handover" });
    const accounts = s.messages.find((m) => m.body.startsWith("The club email"));
    assert.ok(accounts);
    assert.equal(accounts.body, "The club email is [EMAIL_1] and the\ntreasurer phone is [PHONE_1].");
    assert.deepEqual(accounts.location, { lineStart: 11, lineEnd: 12, heading: "Accounts" });
    const wifi = s.messages.find((m) => m.body.startsWith("Wi-Fi"));
    assert.equal(wifi?.body, "Wi-Fi password: [PASSWORD]");
    const code = s.messages.find((m) => m.body.startsWith("```"));
    assert.ok(code?.body.includes("code block line three"), "fenced block split on blank line");
    const setext = s.messages.find((m) => m.body === "Setext Heading");
    assert.ok(setext);
    assert.equal(s.messages[s.messages.length - 1].location?.heading, "Setext Heading");
    for (const m of s.messages) {
      assert.equal(m.kind, "document_block");
      assert.equal(m.sentAt, null);
      assert.equal(m.participantLocalId, null);
      assert.equal(m.conversationLocalId, null);
    }
    assert.equal(s.firstMessageAt, null);
    assert.equal(s.masking.counts.email, 1);
    assert.equal(s.masking.counts.phone, 1);
    assert.equal(s.masking.counts.password, 1);
  });
  it("masks PII inside headings", async () => {
    const s = await ok(input({ kind: "markdown", bytes: bytesOf("# Contact 9999900001\n\nbody text\n") }));
    assert.equal(s.messages[1].location?.heading, "Contact [PHONE_1]");
  });
});

describe("plain text", () => {
  it("splits paragraphs and does not treat # as a heading", async () => {
    const s = await ok(input({ kind: "text", bytes: fixtureBytes("documents/plain-notes.txt") }));
    assert.equal(s.messages.length, 3);
    assert.equal(s.messages[0].body, "Plain text notes, first paragraph.\nStill the first paragraph.");
    assert.equal(s.messages[1].body, "Second paragraph with a contact: [EMAIL_1]");
    assert.equal(s.messages[2].body, "# Not a heading in plain text mode");
    assert.equal(s.messages[2].location?.heading, undefined);
  });
});

describe("DOCX", () => {
  const docx = () =>
    buildDocx([
      { text: "Synthetic Handover", style: "Title" },
      { text: "Accounts", style: "Heading1" },
      { text: "Login: club@example.org\tpassword: Sup3r$ecret", deleted: "OLD-SECRET-TEXT" },
      { text: "" },
      { text: "Tasks & owners <listed>", style: "Heading2" },
      { text: "Asha owns the budget." },
    ]);
  it("extracts paragraphs, headings, tabs and entities; masks PII", async () => {
    const s = await ok(input({ kind: "docx", bytes: docx() }));
    assert.deepEqual(
      s.messages.map((m) => [m.body, m.location?.heading, m.location?.lineStart]),
      [
        ["Synthetic Handover", "Synthetic Handover", 1],
        ["Accounts", "Accounts", 2],
        ["Login: [EMAIL_1]\tpassword: [PASSWORD]", "Accounts", 3],
        ["Tasks & owners <listed>", "Tasks & owners <listed>", 5],
        ["Asha owns the budget.", "Tasks & owners <listed>", 6],
      ],
    );
    assert.equal(s.stats.totalLines, 6);
  });
  it("never outputs tracked-change deletions", async () => {
    const s = await ok(input({ kind: "docx", bytes: docx() }));
    assert.ok(!JSON.stringify(s).includes("OLD-SECRET-TEXT"));
  });
  it("failures", async () => {
    assert.equal(await failCode(input({ kind: "docx", bytes: buildZip([{ name: "x.txt", data: "hi" }]) })), "unsupported_format");
    assert.equal(await failCode(input({ kind: "docx", bytes: bytesOf("plain text") })), "unsupported_format");
    assert.equal(await failCode(input({ kind: "docx", bytes: buildDocx([{ text: "" }]) })), "empty_source");
    const cfbHeader = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    const encName = Array.from("EncryptionInfo").flatMap((c) => [c.charCodeAt(0), 0]);
    assert.equal(await failCode(input({ kind: "docx", bytes: new Uint8Array([...cfbHeader, ...new Array(64).fill(0), ...encName]) })), "password_protected");
    assert.equal(await failCode(input({ kind: "docx", bytes: new Uint8Array([...cfbHeader, ...new Array(64).fill(0)]) })), "unsupported_format");
    const doctype = buildZip([{ name: "word/document.xml", data: '<!DOCTYPE x [<!ENTITY a "b">]><w:document/>' }]);
    assert.equal(await failCode(input({ kind: "docx", bytes: doctype })), "corrupt_file");
  });
});

describe("PDF", () => {
  const pages = [
    { paragraphs: [["Synthetic Handover Report"], ["The treasurer can be reached at", "treasurer@example.org or 9999900006."]] },
    { paragraphs: [["Page two paragraph one."], ["Page two paragraph two."]] },
  ];
  it("extracts text by page and paragraph, with spacing from TJ kerning", async () => {
    const s = await ok(input({ kind: "pdf", bytes: buildPdf(pages) }));
    assert.deepEqual(
      s.messages.map((m) => [m.body, m.location]),
      [
        ["Synthetic Handover Report", { lineStart: 1, lineEnd: 1, page: 1 }],
        ["The treasurer can be reached at\n[EMAIL_1] or [PHONE_1].", { lineStart: 2, lineEnd: 3, page: 1 }],
        ["Page two paragraph one.", { lineStart: 1, lineEnd: 1, page: 2 }],
        ["Page two paragraph two.", { lineStart: 2, lineEnd: 2, page: 2 }],
      ],
    );
  });
  it("handles Flate-compressed content streams", async () => {
    const a = await ok(input({ kind: "pdf", bytes: buildPdf(pages, { compress: true }) }));
    const b = await ok(input({ kind: "pdf", bytes: buildPdf(pages) }));
    assert.deepEqual(a.messages, b.messages);
  });
  it("decodes Type0 fonts through ToUnicode CMaps", async () => {
    const s = await ok(input({ kind: "pdf", bytes: buildPdf([{ paragraphs: [["Unicode text ₹500 ok"]] }], { type0: true }) }));
    assert.equal(s.messages[0].body, "Unicode text ₹500 ok");
  });
  it("scanned (image-only) PDFs fail with no_text_layer", async () => {
    assert.equal(await failCode(input({ kind: "pdf", bytes: buildPdf(pages, { imageOnly: true }) })), "no_text_layer");
  });
  it("undecodable fonts fail clearly", async () => {
    assert.equal(await failCode(input({ kind: "pdf", bytes: buildPdf(pages, { type0NoToUnicode: true }) })), "unsupported_format");
  });
  it("encrypted PDFs fail with password_protected", async () => {
    assert.equal(await failCode(input({ kind: "pdf", bytes: buildPdf(pages, { encrypted: true }) })), "password_protected");
  });
  it("non-PDF and damaged PDFs fail", async () => {
    assert.equal(await failCode(input({ kind: "pdf", bytes: bytesOf("hello") })), "unsupported_format");
    assert.equal(await failCode(input({ kind: "pdf", bytes: bytesOf("%PDF-1.7\n%%EOF") })), "corrupt_file");
    const truncated = buildPdf(pages).subarray(0, 120);
    const code = await failCode(input({ kind: "pdf", bytes: truncated }));
    assert.ok(["corrupt_file", "no_text_layer"].includes(code), code);
  });
});

describe("kind / content mismatch", () => {
  it("rejects binary data declared as markdown", async () => {
    assert.equal(await failCode(input({ kind: "markdown", bytes: buildPdf([{ paragraphs: [["x"]] }], { compress: true }) })), "unsupported_format");
    assert.equal(await failCode(input({ kind: "markdown", bytes: buildZip([{ name: "a.md", data: "# hi" }]) })), "unsupported_format");
  });
  it("rejects a PDF declared as a WhatsApp export", async () => {
    assert.equal(await failCode(input({ kind: "whatsapp_export", bytes: buildPdf([{ paragraphs: [["x"]] }], { compress: true }) })), "unsupported_format");
  });
});
