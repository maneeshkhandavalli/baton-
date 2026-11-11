/**
 * Regression and adversarial tests for the security audit findings fixed in the parser layer:
 * C1 (sender classification), H3 (PDF object scan), H4 (CMap bounds, font cache),
 * M9 (DOCX tokenizer).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDocx, buildPdf, buildZip, bytesOf } from "../../../fixtures/parser/builders";
import { fixtureBytes, input, fileError, participantRule } from "../../../fixtures/parser/load";
import type { ParsedSource, ParseSourceInput } from "../../contracts/parser";
import { extractDocxParagraphs } from "../docx/parse-docx";
import { LIMITS } from "../limits";
import { parseSource } from "../parse-source";
import { FontDecoderCache, parseToUnicodeCMap } from "../pdf/fonts";
import { isRef, loadPdf, type PdfValue } from "../pdf/objects";
import { isSystemEvent } from "../whatsapp/system-events";

async function ok(i: ParseSourceInput): Promise<ParsedSource> {
  const r = await parseSource(i);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// ---------------------------------------------------------------------------------------------
// C1: sender classification

const ANDROID = "whatsapp/adversarial-senders-android.txt";
const IOS = "whatsapp/adversarial-senders-ios.txt";
const chat = (file: string, extra: Partial<ParseSourceInput> = {}) =>
  ok(input({ kind: "whatsapp_export", bytes: fixtureBytes(file), dateOrder: "dmy", timezone: "UTC", ...extra }));

describe("C1: system-event grammar", () => {
  const events = [
    "Messages and calls are end-to-end encrypted. No one outside of this chat can read them.",
    "Asha added Ravi",
    "Asha added Ravi, Meera and Sam",
    "Ravi left",
    "+91 99999 00001 joined using this group's invite link",
    'Asha changed the subject from "Robotics: Core" to "Robotics: 2024"',
    'Asha created group "Club: 2024"',
    "Asha changed this group's icon",
    "You're now an admin",
    "Your security code with Ravi changed. Tap to learn more.",
    "Ravi changed their phone number to a new number. Tap to message or add the new number.",
  ];
  for (const e of events) it(`recognises: ${e}`, () => assert.ok(isSystemEvent(e)));

  const notEvents = [
    "Sam (left wing): hello",
    "Asha: Ravi left",
    "Ravi left: a message",
    "Priya Changed Number: hi",
    'Ravi "RK" Kumar: hi',
    "Asha: Asha added Ravi",
    "I think Ravi left early today, right?",
    "x".repeat(5000) + " left",
  ];
  for (const e of notEvents) it(`rejects: ${e.slice(0, 40)}`, () => assert.ok(!isSystemEvent(e)));
});

describe("C1: Android sender names never lose their identity", () => {
  const senders = ["Sam (left wing)", "Priya Changed Number", 'Ravi "RK" Kumar', "Joined Club", "Added Value Team", "Ravi left"];

  it("every sender becomes a participant and their messages are text", async () => {
    const s = await chat(ANDROID);
    const labels = s.participants.map((p) => p.displayLabel);
    for (const name of senders) assert.ok(labels.includes(name), `missing participant ${name}`);
    for (const m of s.messages.filter((x) => x.body.startsWith("private message"))) {
      assert.equal(m.kind, "text");
      assert.notEqual(m.participantLocalId, null);
    }
  });

  const bodyOf: Record<string, string> = {
    "Sam (left wing)": "private message from sam",
    "Priya Changed Number": "private message from priya",
    'Ravi "RK" Kumar': "private message from ravi",
    "Joined Club": "private message from joined club",
    "Added Value Team": "private message from added value",
    "Ravi left": "private message from a person literally named Ravi left",
  };
  for (const name of senders) {
    it(`excluding "${name}" removes their message`, async () => {
      const s = await chat(ANDROID, {
        exclusions: [participantRule(name)],
      });
      assert.ok(!s.messages.some((m) => m.body === bodyOf[name]), `leaked message of ${name}`);
      // Only that person's message is removed.
      for (const other of senders.filter((n) => n !== name)) {
        assert.ok(s.messages.some((m) => m.body === bodyOf[other]), `over-excluded ${other}`);
      }
      assert.ok(!s.participants.some((p) => p.displayLabel === name));
      assert.ok(s.stats.messagesExcluded >= 1);
    });
  }

  it("a message whose text looks like an event keeps its sender", async () => {
    const s = await chat(ANDROID);
    const m = s.messages.find((x) => x.body === "Ravi left");
    assert.ok(m);
    assert.equal(m.kind, "text");
    assert.equal(s.participants.find((p) => p.localId === m.participantLocalId)?.displayLabel, "Asha Rao");
  });

  it("real events stay system messages without a participant", async () => {
    const s = await chat(ANDROID);
    const systemBodies = s.messages.filter((m) => m.kind === "system").map((m) => m.body);
    assert.ok(systemBodies.includes('Asha Rao changed the subject from "Robotics: Core" to "Robotics: 2024"'));
    assert.ok(systemBodies.includes('Asha Rao created group "Club: 2024"'));
    assert.ok(systemBodies.includes("Some future system event we do not know about"));
    assert.ok(systemBodies.includes("Meera left"));
    assert.ok(systemBodies.some((b) => b.startsWith("Asha Rao added Sam (left wing)")));
    assert.ok(s.messages.filter((m) => m.kind === "system").every((m) => m.participantLocalId === null));
    // The quoted subject's ": " did not create a pseudo-participant.
    assert.ok(!s.participants.some((p) => p.displayLabel.includes("changed the subject")));
  });

  it("system lines naming an excluded participant are still dropped", async () => {
    const s = await chat(ANDROID, {
      exclusions: [participantRule("Sam (left wing)")],
    });
    assert.ok(!s.messages.some((m) => m.body.includes("Sam (left wing)")));
  });
});

describe("C1: iOS", () => {
  it("direction-marked events are system; direction mark alone or event words alone are not", async () => {
    const s = await chat(IOS);
    const byBody = (start: string) => s.messages.find((m) => m.body.startsWith(start));
    assert.equal(byBody("Asha Rao added Sam")?.kind, "system");
    assert.equal(byBody("Meera left")?.kind, "system");
    // Residual (documented): a direction-marked iOS body that is itself a complete event sentence
    // ("... who left") is read as an event. It stays attributable: see the exclusion test below.
    const lrm = byBody("private message that starts");
    assert.equal(lrm?.kind, "system");
    const eventWords = byBody("Asha Rao added Ravi");
    assert.equal(eventWords?.kind, "text");
    assert.notEqual(eventWords?.participantLocalId, null);
    assert.ok(!s.participants.some((p) => p.displayLabel === "Robotics Club"));
  });
  it("excluding an adversarially named iOS sender removes their messages", async () => {
    const own: Record<string, string> = {
      "Sam (left wing)": "private message from sam",
      "Priya Changed Number": "private message that starts",
      'Ravi "RK" Kumar': "Asha Rao added Ravi",
    };
    for (const [name, body] of Object.entries(own)) {
      const s = await chat(IOS, {
        exclusions: [participantRule(name)],
      });
      assert.ok(!s.participants.some((p) => p.displayLabel === name), name);
      assert.ok(!s.messages.some((m) => m.body.startsWith(body)), `leaked message of ${name}`);
      assert.ok(s.stats.messagesExcluded >= 1, name);
    }
  });
  it("the group-name attribution never becomes a participant", async () => {
    const s = await chat(IOS);
    assert.ok(!s.participants.some((p) => p.displayLabel === "Robotics Club"));
    assert.ok(s.messages.filter((m) => m.kind === "system").every((m) => m.participantLocalId === null));
  });
});

describe("C1: grammar cost stays linear on adversarial lines", () => {
  it("20,000 long event-like lines parse quickly", async () => {
    const line = "20/02/2024, 08:00 - " + "a added ".repeat(50) + "b\n";
    const bytes = bytesOf(line.repeat(20_000));
    const start = performance.now();
    const s = await ok(input({ kind: "whatsapp_export", bytes, dateOrder: "dmy" }));
    assert.equal(s.messages.length, 20_000);
    assert.ok(performance.now() - start < 10_000, "classification is too slow");
  });
});

// ---------------------------------------------------------------------------------------------
// H3: PDF object scanning

describe("H3: PDF object scan is linear and bounded", () => {
  it("thousands of unterminated-string objects (was 28 s for 295 KB)", () => {
    const body = "%PDF-1.7\n" + Array.from({ length: 8000 }, (_, i) => `${i + 1} 0 obj (`).join(" ") + "x".repeat(200_000);
    const { ms } = timed(() => loadPdf(latin1(body)));
    assert.ok(ms < 2000, `took ${ms} ms`);
  });
  it("a 6 MB file of unterminated objects finishes or aborts quickly", () => {
    const body = "%PDF-1.7\n" + "1 0 obj (".repeat((6 * 1024 * 1024) / 9);
    const { value: code, ms } = timed(() => {
      try {
        loadPdf(latin1(body));
        return "ok";
      } catch (e) {
        return (e as { error?: { details: { parserCode: string } } }).error?.details.parserCode ?? "threw";
      }
    });
    assert.ok(["ok", "too_large", "corrupt_file"].includes(code), code);
    assert.ok(ms < 5000, `took ${ms} ms`);
  });
  it("many unterminated trailers are bounded", () => {
    const body = "%PDF-1.7\n" + "trailer << /A (".repeat(50_000);
    const { ms } = timed(() => loadPdf(latin1(body)));
    assert.ok(ms < 3000, `took ${ms} ms`);
  });
  it("objects without endobj still parse", async () => {
    const pdf = buildPdf([{ paragraphs: [["Hello from a damaged file"]] }]);
    let s = "";
    for (const b of pdf) s += String.fromCharCode(b);
    const stripped = latin1(s.replace(/endobj/g, ""));
    const doc = await ok(input({ kind: "pdf", bytes: stripped }));
    assert.equal(doc.messages[0].body, "Hello from a damaged file");
  });
  it("binary stream data containing object headers is skipped as data", async () => {
    const pdf = buildPdf([{ paragraphs: [["Real text"]] }], { compress: true });
    const doc = await ok(input({ kind: "pdf", bytes: pdf }));
    assert.equal(doc.messages[0].body, "Real text");
  });
  it("reads objects packed in an object stream, each confined to its own slice", async () => {
    const objs = [
      "<< /Type /Catalog /Pages 3 0 R >>",
      "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 3 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    ];
    let offsets = "";
    let data = "";
    [2, 3, 4].forEach((n, i) => {
      offsets += `${n} ${data.length} `;
      data += objs[i] + "\n";
    });
    const header = offsets.trim() + "\n";
    const objstm = header + data;
    const content = "BT /F1 12 Tf 72 700 Td (Hello from an object stream) Tj ET";
    const pdf =
      "%PDF-1.7\n" +
      `1 0 obj\n<< /Type /ObjStm /N 3 /First ${header.length} /Length ${objstm.length} >>\nstream\n${objstm}\nendstream\nendobj\n` +
      "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n" +
      `6 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n` +
      "trailer\n<< /Root 2 0 R >>\n%%EOF\n";
    const doc = await ok(input({ kind: "pdf", bytes: latin1(pdf) }));
    assert.equal(doc.messages[0].body, "Hello from an object stream");
  });
  it("an object stream with many entries at one offset is linear", () => {
    const n = 50_000;
    const header = Array.from({ length: n }, (_, i) => `${i + 10} 0`).join(" ") + "\n";
    const objstm = header + "(" + "y".repeat(100_000);
    const pdf = `%PDF-1.7\n1 0 obj\n<< /Type /ObjStm /N ${n} /First ${header.length} /Length ${objstm.length} >>\nstream\n${objstm}\nendstream\nendobj\n`;
    const { ms } = timed(() => loadPdf(latin1(pdf)));
    assert.ok(ms < 3000, `took ${ms} ms`);
  });
});

// ---------------------------------------------------------------------------------------------
// H4: CMap bounds and per-document font cache

describe("H4: ToUnicode CMap bounds", () => {
  it("caps bfrange expansion (2,000 full ranges)", () => {
    const cmap = "begincmap\n2000 beginbfrange\n" + "<0000> <FFFF> <0041>\n".repeat(2000) + "endbfrange\nendcmap";
    const { value, ms } = timed(() => parseToUnicodeCMap(bytesOf(cmap)));
    assert.ok(ms < 2000, `took ${ms} ms`);
    assert.equal(value.truncated, true);
    assert.ok(value.map.size <= 65_536);
  });
  it("ignores codes wider than 2 bytes (bounded key space)", () => {
    const cmap =
      "begincmap\n1 begincodespacerange <00000000> <FFFFFFFF> endcodespacerange\n" +
      "2 beginbfrange <00010000> <0001FFFF> <0041> <0041> <0042> <0061> endbfrange\n" +
      "1 beginbfchar <0102030405> <0058> endbfchar\nendcmap";
    const r = parseToUnicodeCMap(bytesOf(cmap));
    assert.deepEqual(Array.from(r.map.keys()), [0x41, 0x42]);
    assert.ok(Array.from(r.map.keys()).every((k) => k <= 0xffff));
  });
  it("ignores oversized destination strings", () => {
    const huge = "00".repeat(10_000);
    const cmap = `begincmap\n1 beginbfrange <0000> <00FF> <${huge}> endbfrange\n1 beginbfchar <41> <0041> endbfchar\nendcmap`;
    const r = parseToUnicodeCMap(bytesOf(cmap));
    assert.equal(r.map.size, 1);
    assert.equal(r.map.get(0x41), "A");
  });
  it("normal CMaps are not truncated", () => {
    const r = parseToUnicodeCMap(bytesOf("begincmap\n1 beginbfrange <0020> <007E> <0020> endbfrange\nendcmap"));
    assert.equal(r.truncated, false);
    assert.equal(r.map.get(0x41), "A");
  });
  it("respects the configured expansion limit", () => {
    assert.ok(LIMITS.maxCMapRangeExpansion >= 65_536);
  });
});

describe("H4: font decoders are cached per document", () => {
  it("one CMap parse for a font used on many pages", async () => {
    const pages = Array.from({ length: 40 }, (_, i) => ({ paragraphs: [[`Page ${i + 1} text`]] }));
    const bytes = buildPdf(pages, { type0: true });
    const doc = loadPdf(bytes);
    let fontRef: PdfValue | null = null;
    for (const [n, v] of doc.objects) {
      if (typeof v === "object" && v !== null && !Array.isArray(v) && v.t === "dict") {
        const sub = v.v.get("Subtype");
        if (typeof sub === "object" && sub !== null && !Array.isArray(sub) && sub.t === "name" && sub.v === "Type0") {
          fontRef = { t: "ref", n, g: 0 };
        }
      }
    }
    assert.ok(fontRef && isRef(fontRef));
    const cache = new FontDecoderCache(doc);
    const a = cache.get(fontRef);
    const b = cache.get(fontRef);
    assert.equal(a, b);
    assert.equal(cache.builds, 1);
    const s = await ok(input({ kind: "pdf", bytes }));
    assert.equal(s.messages.length, 40);
    assert.equal(s.messages[39].body, "Page 40 text");
  });
});

// ---------------------------------------------------------------------------------------------
// M9: DOCX tokenizer

describe("M9: DOCX XML tokenizer is linear", () => {
  it("unterminated comment / CDATA / PI / tag fail as corrupt_file", () => {
    for (const xml of ["<w:document><!-- never closed", "<w:document><![CDATA[ never closed", "<w:document><?pi never", "<w:document><w:p"]) {
      assert.throws(() => extractDocxParagraphs(xml), (e: { error?: { details: { parserCode: string } } }) => e.error?.details.parserCode === "corrupt_file");
    }
  });
  it("many unterminated comment openers fail fast (was quadratic)", () => {
    const xml = "<w:document>" + "<!--".repeat(2_000_000);
    const { ms } = timed(() => {
      try {
        extractDocxParagraphs(xml);
      } catch {
        // expected corrupt_file
      }
    });
    assert.ok(ms < 1000, `took ${ms} ms`);
  });
  it("a large well-formed document with comments, PIs and CDATA parses linearly", () => {
    const para = "<!-- c --><?pi x?><w:p><w:r><w:t>Hello <![CDATA[world]]></w:t></w:r></w:p>";
    const xml = "<w:document><w:body>" + para.repeat(100_000) + "</w:body></w:document>";
    const { value, ms } = timed(() => extractDocxParagraphs(xml));
    assert.equal(value.length, 100_000);
    assert.equal(value[0].text, "Hello world");
    assert.ok(ms < 5000, `took ${ms} ms`);
  });
  it("end-to-end: a DOCX whose document.xml has an unterminated comment is corrupt_file", async () => {
    const bad = buildZip([{ name: "word/document.xml", data: "<w:document><w:body><!-- oops" }]);
    const r = await parseSource(input({ kind: "docx", bytes: bad }));
    assert.ok(!r.ok);
    assert.equal(fileError(r).details.parserCode, "corrupt_file");
  });
  it("existing DOCX behaviour is preserved", async () => {
    const s = await ok(input({ kind: "docx", bytes: buildDocx([{ text: "Heading", style: "Heading1" }, { text: "A & B\tC" }]) }));
    assert.deepEqual(s.messages.map((m) => m.body), ["Heading", "A & B\tC"]);
  });
});
