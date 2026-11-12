// Round 3 (D2): upload and parser robustness. Every input is synthetic; binary fixtures are built in
// the test (fixtures/parser/builders.ts), so no opaque binaries are committed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDocx, buildPdf, buildZip, bytesOf } from "../../../fixtures/parser/builders";
import { fileError, fixtureBytes, input } from "../../../fixtures/parser/load";
import type { ParsedSource, ParseSourceInput } from "../../contracts/parser";
import { parseSource, previewSource } from "../parse-source";
import { isSafeEntryName } from "../whatsapp/select-chat-entry";
import { openZip } from "../zip/read-zip";

const ANDROID = fixtureBytes("whatsapp/android-24h-dmy.txt");
const IOS = fixtureBytes("whatsapp/ios-12h-dmy.txt");

async function ok(i: ParseSourceInput): Promise<ParsedSource> {
  const r = await parseSource(i);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

async function failure(i: ParseSourceInput): Promise<{ code: string; message: string; line?: number }> {
  const e = fileError(await parseSource(i));
  return { code: String(e.details.parserCode), message: e.message, line: e.details.line as number | undefined };
}

const chatZip = (entries: Parameters<typeof buildZip>[0]) => input({ kind: "whatsapp_export", bytes: buildZip(entries), fileName: "export.zip" });

describe("R3 D2 ZIP: real-world layouts", () => {
  it("streaming exports with data descriptors (flag bit 3) parse exactly like the plain text", async () => {
    const zipped = await ok(chatZip([{ name: "WhatsApp Chat with Robotics.txt", data: ANDROID, dataDescriptor: true }]));
    const plain = await ok(input({ kind: "whatsapp_export", bytes: ANDROID }));
    assert.deepEqual(zipped, plain);
  });
  it("Windows-style backslash folders are accepted", async () => {
    const r = await ok(chatZip([{ name: "export\\_chat.txt", data: IOS }]));
    assert.equal(r.messages.length, 10);
  });
  it("attachments with an unsupported compression method are never read", async () => {
    const r = await ok(chatZip([
      { name: "_chat.txt", data: IOS },
      { name: "00000003-AUDIO.opus", data: new Uint8Array(64), methodField: 99 },
    ]));
    assert.equal(r.messages.length, 10);
  });
});

describe("R3 D2 ZIP: hostile archives fail closed with a typed error", () => {
  const cases: Array<{ name: string; entries: Parameters<typeof buildZip>[0]; code: string; message?: RegExp }> = [
    { name: "path traversal only (../../_chat.txt)", entries: [{ name: "../../_chat.txt", data: IOS }], code: "unsupported_format" },
    { name: "absolute path only (/tmp/_chat.txt)", entries: [{ name: "/tmp/_chat.txt", data: IOS }], code: "unsupported_format" },
    { name: "drive-qualified path only (C:/x/_chat.txt)", entries: [{ name: "C:/x/_chat.txt", data: IOS }], code: "unsupported_format" },
    { name: "traversal inside a folder (export/../chat.txt)", entries: [{ name: "export/../chat.txt", data: ANDROID }], code: "unsupported_format" },
    { name: "control characters in the name", entries: [{ name: "chat\u0000.txt", data: ANDROID }], code: "unsupported_format" },
    {
      name: "nested archive instead of a chat",
      entries: [{ name: "WhatsApp Chat - Club.zip", data: buildZip([{ name: "_chat.txt", data: IOS }]) }],
      code: "unsupported_format",
      message: /another archive/,
    },
    {
      name: "nested zip bomb is never opened (no recursion)",
      entries: [{ name: "inner.zip", data: buildZip([{ name: "_chat.txt", data: new Uint8Array(4 * 1024 * 1024) }]) }],
      code: "unsupported_format",
      message: /another archive/,
    },
    { name: "two _chat.txt entries with the same name", entries: [{ name: "_chat.txt", data: IOS }, { name: "_chat.txt", data: IOS }], code: "unsupported_format" },
    { name: "chat stored with an unsupported compression method (bzip2)", entries: [{ name: "_chat.txt", data: IOS, methodField: 12 }], code: "unsupported_format" },
    { name: "chat stored with AES (method 99)", entries: [{ name: "_chat.txt", data: IOS, methodField: 99 }], code: "unsupported_format" },
    {
      name: "stored entry declaring more than the per-entry cap",
      entries: [{ name: "_chat.txt", data: IOS, method: "store", declaredSize: 65 * 1024 * 1024 }],
      code: "too_large",
    },
    { name: "only attachments", entries: [{ name: "IMG-0001.jpg", data: new Uint8Array(8) }], code: "unsupported_format" },
    { name: "chat file is empty", entries: [{ name: "WhatsApp Chat.txt", data: "" }], code: "empty_source" },
    { name: "chat file holds only a BOM and blank lines", entries: [{ name: "_chat.txt", data: "\uFEFF\n\n  \n" }], code: "empty_source" },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const f = await failure(chatZip(c.entries));
      assert.equal(f.code, c.code, f.message);
      if (c.message) assert.match(f.message, c.message);
    });
  }

  it("a safe chat is still found next to a traversal entry, which is never selected or counted", async () => {
    const r = await ok(chatZip([
      { name: "../_chat.txt", data: "junk that would fail to parse" },
      { name: "_chat.txt", data: IOS },
    ]));
    assert.equal(r.messages.length, 10);
  });

  it("an empty archive (directory record only) is unsupported", async () => {
    const f = await failure(input({ kind: "whatsapp_export", bytes: buildZip([]) }));
    assert.equal(f.code, "unsupported_format");
  });

  it("split (multi-part) archives are unsupported", async () => {
    const zip = buildZip([{ name: "_chat.txt", data: IOS }]);
    const patched = zip.slice();
    new DataView(patched.buffer).setUint16(patched.length - 22 + 4, 1, true); // "number of this disk"
    const f = await failure(input({ kind: "whatsapp_export", bytes: patched }));
    assert.equal(f.code, "unsupported_format");
    assert.match(f.message, /multi-part/);
  });

  it("an archive whose directory count disagrees with this disk's count is unsupported", async () => {
    const zip = buildZip([{ name: "_chat.txt", data: IOS }]);
    const patched = zip.slice();
    new DataView(patched.buffer).setUint16(patched.length - 22 + 8, 0, true);
    assert.equal((await failure(input({ kind: "whatsapp_export", bytes: patched }))).code, "unsupported_format");
  });

  it("truncation at every structural boundary never throws", async () => {
    const zip = buildZip([{ name: "_chat.txt", data: IOS }]);
    for (const cut of [1, 4, 30, 60, zip.length - 30, zip.length - 22, zip.length - 1]) {
      const r = await parseSource(input({ kind: "whatsapp_export", bytes: zip.subarray(0, cut) }));
      assert.equal(r.ok, false, `cut at ${cut}`);
    }
  });

  it("isSafeEntryName", () => {
    for (const n of ["_chat.txt", "export/_chat.txt", "a/b/c.txt", "folder/", "WhatsApp Chat - Ünïcode.txt"]) assert.ok(isSafeEntryName(n), n);
    for (const n of ["", "../a.txt", "a/../../b.txt", "/a.txt", "\\a.txt", "C:\\a.txt", "c:a.txt", "./a.txt", "a//b.txt", "a\u0007.txt"]) {
      assert.ok(!isSafeEntryName(n), JSON.stringify(n));
    }
  });

  it("entry names are only compared: openZip never touches the filesystem", () => {
    const zip = openZip(buildZip([{ name: "../../../../etc/passwd", data: "x" }]));
    assert.equal(zip.entries[0].name, "../../../../etc/passwd");
    assert.deepEqual(Array.from(zip.read(zip.entries[0])), [0x78]);
  });
});

describe("R3 D2 TXT: chat exports and ambiguous dates", () => {
  const chat = (lines: string[]) => bytesOf(lines.join("\n") + "\n");

  it("ymd requested for a chat whose dates all have day == month fails as ambiguous, not as empty", async () => {
    const bytes = chat(["05/05/2024, 10:00 - Asha Rao: First", "06/06/2024, 11:00 - Ravi Kumar: Second"]);
    const f = await failure(input({ kind: "whatsapp_export", bytes, dateOrder: "ymd" }));
    assert.equal(f.code, "date_format_ambiguous");
    assert.equal(f.line, 1);
  });

  it("a single late day-first date settles the order for the whole chat", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `0${(i % 9) + 1}/0${((i + 1) % 9) + 1}/2024, 10:${String(i % 60).padStart(2, "0")} - Asha Rao: line ${i}`);
    lines.push("25/03/2024, 09:00 - Ravi Kumar: the day-first witness");
    const s = await ok(input({ kind: "whatsapp_export", bytes: chat(lines) }));
    assert.equal(s.parseContext.dateOrder, "dmy");
    assert.equal(s.messages[0].sentAt, "2024-02-01T04:30:00.000Z"); // 01/02 day-first, IST → UTC
  });

  it("without a witness the parser refuses to guess and names the first ambiguous line", async () => {
    const f = await failure(input({ kind: "whatsapp_export", bytes: chat(["02/03/2024, 10:00 - Asha Rao: a", "04/05/2024, 10:00 - Asha Rao: b"]) }));
    assert.equal(f.code, "date_format_ambiguous");
    assert.equal(f.line, 1);
  });

  it("two-digit years, dotted dates and seconds", async () => {
    const s = await ok(input({ kind: "whatsapp_export", bytes: chat(["31.12.23, 21:15:07 - Asha Rao: dotted", "01.01.24, 00:00:00 - Ravi Kumar: new year"]) }));
    assert.deepEqual(s.messages.map((m) => m.sentAt), ["2023-12-31T15:45:07.000Z", "2023-12-31T18:30:00.000Z"]);
  });

  it("LF, CRLF, lone-CR and BOM variants give identical results", async () => {
    const text = new TextDecoder().decode(ANDROID).replace(/\r\n/g, "\n");
    const base = await ok(input({ kind: "whatsapp_export", bytes: bytesOf(text) }));
    for (const variant of [text.replace(/\n/g, "\r\n"), text.replace(/\n/g, "\r"), "\uFEFF" + text]) {
      assert.deepEqual(await ok(input({ kind: "whatsapp_export", bytes: bytesOf(variant) })), base);
    }
  });

  it("UTF-16BE with a BOM decodes", async () => {
    const text = "31/12/2023, 21:17 - Asha Rao: Welcome everyone!\n";
    const be = new Uint8Array(2 + text.length * 2);
    be[0] = 0xfe;
    be[1] = 0xff;
    for (let i = 0; i < text.length; i++) {
      be[2 + i * 2] = text.charCodeAt(i) >> 8;
      be[3 + i * 2] = text.charCodeAt(i) & 0xff;
    }
    const s = await ok(input({ kind: "whatsapp_export", bytes: be }));
    assert.equal(s.messages[0].body, "Welcome everyone!");
  });

  it("a Slack-style paste is not a WhatsApp export (clear unsupported_format), but parses as a plain-text document", async () => {
    const slack = bytesOf(["Asha Rao  10:42 AM", "Venue is booked for Friday.", "", "Ravi Kumar  10:44 AM", "Thanks, I will tell the team."].join("\n"));
    const f = await failure(input({ kind: "whatsapp_export", bytes: slack }));
    assert.equal(f.code, "unsupported_format");
    assert.match(f.message, /No WhatsApp messages/);
    const doc = await ok(input({ kind: "text", bytes: slack }));
    assert.deepEqual(doc.messages.map((m) => [m.location!.lineStart, m.location!.lineEnd]), [[1, 2], [4, 5]]);
  });

  it("a 0-byte file and a BOM-only file are empty_source", async () => {
    assert.equal((await failure(input({ kind: "whatsapp_export", bytes: new Uint8Array(0) }))).code, "empty_source");
    assert.equal((await failure(input({ kind: "whatsapp_export", bytes: new Uint8Array([0xef, 0xbb, 0xbf]) }))).code, "empty_source");
    assert.equal((await failure(input({ kind: "markdown", bytes: new Uint8Array([0xef, 0xbb, 0xbf, 0x0a]) }))).code, "empty_source");
  });

  it("preview and parse agree on every failure (same rules, D33)", async () => {
    const bad = [chatZip([{ name: "../_chat.txt", data: IOS }]), input({ kind: "whatsapp_export", bytes: chat(["02/03/2024, 10:00 - A: a"]) })];
    for (const i of bad) {
      const p = await parseSource(i);
      const v = await previewSource(i);
      assert.ok(!p.ok && !v.ok);
      assert.deepEqual(p.error, v.error);
    }
  });
});

describe("R3 D2 documents: PDF, DOCX, Markdown", () => {
  it("a text-only PDF declared as Markdown or text is refused, not parsed as garbage", async () => {
    const pdfText = bytesOf("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
    for (const kind of ["markdown", "text"] as const) {
      const f = await failure(input({ kind, bytes: pdfText }));
      assert.equal(f.code, "unsupported_format");
      assert.match(f.message, /PDF/);
    }
  });
  it("a Markdown file that merely mentions %PDF- later is still Markdown", async () => {
    const s = await ok(input({ kind: "markdown", bytes: bytesOf("# Notes\n\nFiles start with %PDF- when they are PDFs.\n") }));
    assert.equal(s.messages.length, 2);
  });
  it("PDF truncated at many points fails without throwing", async () => {
    const pdf = buildPdf([{ paragraphs: [["Synthetic report"], ["Second paragraph."]] }]);
    for (const frac of [0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      const r = await parseSource(input({ kind: "pdf", bytes: pdf.subarray(0, Math.floor(pdf.length * frac)) }));
      if (r.ok) assert.ok(r.data.messages.length > 0);
    }
  });
  it("a DOCX without word/document.xml is unsupported", async () => {
    const f = await failure(input({ kind: "docx", bytes: buildZip([{ name: "[Content_Types].xml", data: "<Types/>" }]) }));
    assert.equal(f.code, "unsupported_format");
  });
  it("a DOCX whose document.xml is a compression bomb is too_large", async () => {
    const xml = `<w:document xmlns:w="x"><w:body>${" ".repeat(3 * 1024 * 1024)}</w:body></w:document>`;
    const f = await failure(input({ kind: "docx", bytes: buildZip([{ name: "word/document.xml", data: xml }]) }));
    assert.equal(f.code, "too_large");
  });
  it("a DOCX with traversal-named parts still reads only word/document.xml", async () => {
    const docx = buildDocx([{ text: "Synthetic paragraph one." }]);
    const zip = openZip(docx);
    const parts = zip.entries.map((e) => ({ name: e.name, data: zip.read(e) }));
    const s = await ok(input({ kind: "docx", bytes: buildZip([...parts, { name: "../../word/document.xml", data: "<evil/>" }]) }));
    assert.deepEqual(s.messages.map((m) => m.body), ["Synthetic paragraph one."]);
  });
  it("a ZIP declared as PDF, and a DOCX declared as a chat, are refused", async () => {
    assert.equal((await failure(input({ kind: "pdf", bytes: buildZip([{ name: "_chat.txt", data: IOS }]) }))).code, "unsupported_format");
    assert.equal((await failure(input({ kind: "whatsapp_export", bytes: buildDocx([{ text: "Hello there" }]) }))).code, "unsupported_format");
  });
});
