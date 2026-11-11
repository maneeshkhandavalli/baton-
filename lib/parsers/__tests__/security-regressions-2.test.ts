/**
 * Regression tests for the SECOND security audit's findings, using its reproduction inputs:
 * N1 (distant-endobj quadratic), N2 (CMap amplification across fonts), N4 (single-word
 * over-redaction, name extensions), N5 (excluded names in display labels), N6 (iOS attribution
 * names), N7 (grammar tails spanning ": "). N3 (phone policy) is covered in
 * lib/privacy/__tests__/security-regressions.test.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { input, participantRule } from "../../../fixtures/parser/load";
import type { ExclusionRule, ParsedSource, ParseSourceInput } from "../../contracts/parser";
import { EXCLUDED_PARTICIPANT_TOKEN as X, createExcludedMentionRedactor } from "../../privacy/excluded-mentions";
import { LIMITS } from "../limits";
import { parseSource } from "../parse-source";
import { parseToUnicodeCMap } from "../pdf/fonts";
import { ForwardSearch, loadPdf } from "../pdf/objects";
import { isSystemEvent } from "../whatsapp/system-events";

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

async function ok(i: ParseSourceInput): Promise<ParsedSource> {
  const r = await parseSource(i);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

const exclude = (name: string): ExclusionRule => participantRule(name);

const chat = (lines: string[], exclusions: ExclusionRule[] = []) =>
  ok(input({ kind: "whatsapp_export", bytes: new TextEncoder().encode(lines.join("\n")), dateOrder: "dmy", timezone: "UTC", exclusions }));

// ---------------------------------------------------------------------------------------------
// N1

describe("N1: repeated endobj search is linear", () => {
  const distant = (objects: number, tailMb: number) =>
    "%PDF-1.7\n" +
    Array.from({ length: objects }, (_, i) => `${i + 1} 0 obj 1\n`).join("") +
    "x".repeat(tailMb * 1024 * 1024) +
    " endobj";

  for (const mb of [2, 4, 8]) {
    it(`20,000 objects then a distant endobj after ${mb} MB (audit: 1.2 / 2.3 / 4.9 s)`, () => {
      const { value: doc, ms } = timed(() => loadPdf(latin1(distant(20_000, mb))));
      assert.equal(doc.objects.size, 20_000);
      assert.ok(ms < 1500, `took ${ms} ms`);
    });
  }
  it("cost does not grow with object count × tail size", () => {
    const small = timed(() => loadPdf(latin1(distant(2_000, 8)))).ms;
    const large = timed(() => loadPdf(latin1(distant(40_000, 8)))).ms;
    // 20x more objects over the same tail must not cost anything like 20x (quadratic) more.
    assert.ok(large < small * 8 + 500, `small=${small} ms, large=${large} ms`);
  });
  it("ForwardSearch scans each character at most once across many queries", () => {
    const text = "a".repeat(100_000) + "needle" + "b".repeat(100_000);
    const s = new ForwardSearch(text, "needle");
    for (let pos = 0; pos <= 100_000; pos += 7) assert.equal(s.from(pos), 100_000);
    assert.equal(s.from(100_001), -1);
    for (let pos = 100_001; pos < text.length; pos += 1000) assert.equal(s.from(pos), -1);
    assert.ok(s.scanned <= text.length + 6, `scanned ${s.scanned} of ${text.length}`);
  });
  it("ForwardSearch stays correct for non-monotonic queries", () => {
    const text = "x endobj y endobj z";
    const s = new ForwardSearch(text, "endobj");
    assert.equal(s.from(0), 2);
    assert.equal(s.from(9), 11);
    assert.equal(s.from(3), 11);
    assert.equal(s.from(1), 2);
    assert.equal(s.from(12), -1);
  });
});

// ---------------------------------------------------------------------------------------------
// N2

/** One page drawing one character with each of `fonts` Type0 fonts. */
function manyFontsPdf(fonts: number, sharedToUnicode: boolean): Uint8Array {
  const cmap = "begincmap\n4 beginbfrange\n" + "<0000> <FFFF> <0041>\n".repeat(4) + "endbfrange\nendcmap";
  const objs: string[] = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  // Shared: object 5 is the CMap, fonts are 6, 7, 8...  Distinct: CMap i is 5 + 2i, font i is 6 + 2i.
  const fontIds = Array.from({ length: fonts }, (_, i) => (sharedToUnicode ? 6 + i : 6 + 2 * i));
  const fontDict = fontIds.map((id, i) => `/F${i} ${id} 0 R`).join(" ");
  objs.push(`<< /Type /Page /Parent 2 0 R /Resources << /Font << ${fontDict} >> >> /Contents 4 0 R >>`);
  const content = Array.from({ length: fonts }, (_, i) => `BT /F${i} 12 Tf 72 ${700 - (i % 50) * 12} Td <0041> Tj ET`).join("\n");
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  if (sharedToUnicode) {
    objs.push(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`); // object 5
    for (let i = 0; i < fonts; i++) objs.push(`<< /Type /Font /Subtype /Type0 /BaseFont /S${i} /Encoding /Identity-H /ToUnicode 5 0 R >>`);
  } else {
    for (let i = 0; i < fonts; i++) {
      objs.push(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
      objs.push(`<< /Type /Font /Subtype /Type0 /BaseFont /S${i} /Encoding /Identity-H /ToUnicode ${objs.length} 0 R >>`);
    }
  }
  let pdf = "%PDF-1.7\n";
  objs.forEach((o, i) => {
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  return latin1(pdf + "trailer\n<< /Root 1 0 R >>\n%%EOF\n");
}

describe("N2: CMap work is bounded per document", () => {
  it("1,000 fonts sharing one ToUnicode stream (audit: 12.3 s)", async () => {
    const start = performance.now();
    const s = await ok(input({ kind: "pdf", bytes: manyFontsPdf(1000, true) }));
    const ms = performance.now() - start;
    assert.ok(ms < 2500, `took ${ms} ms`);
    assert.ok(s.warnings.some((w) => w.code === "pdf_font_limit"), "font cap not reported");
    assert.ok(s.messages.length > 0);
  });
  it("a shared ToUnicode stream is parsed once", async () => {
    const { FontDecoderCache } = await import("../pdf/fonts");
    const bytes = manyFontsPdf(100, true);
    const doc = loadPdf(bytes);
    const cache = new FontDecoderCache(doc);
    for (let i = 0; i < 100; i++) cache.get({ t: "ref", n: 6 + i, g: 0 });
    assert.equal(cache.builds, 100);
    assert.equal(cache.cmapParses, 1);
  });
  it("hundreds of DISTINCT heavy CMaps are capped by the document-wide budget", async () => {
    const start = performance.now();
    const s = await ok(input({ kind: "pdf", bytes: manyFontsPdf(300, false) }));
    const ms = performance.now() - start;
    assert.ok(ms < 3000, `took ${ms} ms`);
    const codes = s.warnings.map((w) => w.code);
    assert.ok(codes.includes("pdf_cmap_truncated"), codes.join(","));
    assert.ok(codes.includes("pdf_font_limit"), codes.join(","));
  });
  it("limits were lowered and a document budget exists", () => {
    assert.ok(LIMITS.maxPdfFonts <= 256);
    assert.ok(LIMITS.maxPdfCMapExpansionTotal >= LIMITS.maxCMapRangeExpansion);
    assert.ok(LIMITS.maxPdfCMapExpansionTotal <= 16 * 65_536);
  });
  it("parseToUnicodeCMap honours a shared budget", () => {
    const budget = { remaining: 100 };
    const a = parseToUnicodeCMap(latin1("begincmap\n1 beginbfrange <0000> <0031> <0041> endbfrange\nendcmap"), budget);
    assert.equal(a.truncated, false);
    assert.equal(budget.remaining, 50);
    const b = parseToUnicodeCMap(latin1("begincmap\n1 beginbfrange <0000> <0063> <0041> endbfrange\nendcmap"), budget);
    assert.equal(b.truncated, true);
    assert.equal(b.map.size, 0);
  });
  it("oversized ToUnicode streams are parsed only up to the cap", () => {
    const filler = "% padding\n".repeat(Math.ceil(LIMITS.maxCMapStreamBytes / 10) + 10);
    const r = parseToUnicodeCMap(latin1("begincmap\n1 beginbfchar <41> <0041> endbfchar\n" + filler));
    assert.equal(r.truncated, true);
    assert.equal(r.map.get(0x41), "A");
  });
});

// ---------------------------------------------------------------------------------------------
// N4

describe("N4: no over-redaction of ordinary words", () => {
  const audit: Array<[string, string]> = [
    ["Mom", "Tell mom the venue changed, Mom said yes"],
    ["Admin", "Ask the admin to unlock the room"],
    ["Team", "Great work team!"],
    ["Sir", "Sir, the lab is closed"],
    ["Asha", "There is still asha (hope) for the event"],
    ["Notes", "See the notes folder"],
  ];
  for (const [name, text] of audit) {
    it(`single-word "${name}": free text untouched, @mention redacted`, () => {
      const r = createExcludedMentionRedactor([name]);
      assert.equal(r.redact(text).text, text);
      assert.equal(r.redact(`cc @${name} please`).text, `cc ${X} please`);
      assert.equal(r.redact(`cc @\u2068~${name}\u2069 please`).text, `cc ${X} please`);
    });
  }
  it("name extensions of a different person are not redacted", () => {
    const r = createExcludedMentionRedactor(["Ravi Kumar"]);
    assert.equal(r.redact("Ravi Kumar Sr and Ravi Kumar-Jr both agreed").text, "Ravi Kumar Sr and Ravi Kumar-Jr both agreed");
    assert.equal(r.redact("Ravi Kumar Jr. agreed").text, "Ravi Kumar Jr. agreed");
    assert.equal(r.redact("Ravi Kumar III signed").text, "Ravi Kumar III signed");
  });
  it("a kept participant whose name extends the excluded one is protected", () => {
    const r = createExcludedMentionRedactor(["Ravi Kumar"], { keptSenders: ["Ravi Kumar Singh"] });
    assert.equal(r.redact("Ravi Kumar Singh and Ravi Kumar met").text, `Ravi Kumar Singh and ${X} met`);
  });
  it("the excluded person themselves is still redacted (possessive, punctuation, @)", () => {
    const r = createExcludedMentionRedactor(["Ravi Kumar"]);
    assert.equal(r.redact("Ravi Kumar's notes, @Ravi Kumar. ravi kumar!").text, `${X}'s notes, ${X}. ${X}!`);
  });
  it("end-to-end: excluding 'Mom' keeps ordinary words", async () => {
    const s = await chat(["20/02/2024, 08:00 - Mom: private", "20/02/2024, 08:01 - Asha: tell mom, great work team, cc @Mom"], [exclude("Mom")]);
    assert.deepEqual(s.messages.map((m) => m.body), [`tell mom, great work team, cc ${X}`]);
  });
});

// ---------------------------------------------------------------------------------------------
// N5

describe("N5: excluded names never survive in other participants' labels", () => {
  it("audit example: \"Ravi Kumar's Mom\"", async () => {
    const s = await chat(
      ["20/02/2024, 08:00 - Ravi Kumar: my message", "20/02/2024, 08:01 - Ravi Kumar's Mom: hello beta", "20/02/2024, 08:02 - Asha: hi"],
      [exclude("Ravi Kumar")],
    );
    assert.deepEqual(s.participants.map((p) => p.displayLabel), ["Participant 2", "Asha"]);
    assert.ok(!JSON.stringify(s).includes("Ravi Kumar"));
  });
  it("single-word excluded names are checked strictly in labels", async () => {
    const s = await chat(
      ["20/02/2024, 08:00 - Mom: x", "20/02/2024, 08:01 - Asha's Mom: y", "20/02/2024, 08:02 - Momin: z"],
      [exclude("Mom")],
    );
    assert.deepEqual(s.participants.map((p) => p.displayLabel), ["Participant 2", "Momin"]);
  });
  it("labels containing an excluded phone number are anonymised", async () => {
    const s = await chat(
      ["20/02/2024, 08:00 - +91 99999 00009: x", "20/02/2024, 08:01 - Office 99999 00009: y"],
      [exclude("+91 99999 00009")],
    );
    assert.deepEqual(s.participants.map((p) => p.displayLabel), ["Participant 2"]);
  });
  it("unrelated labels are unchanged", async () => {
    const s = await chat(["20/02/2024, 08:00 - Ravi Kumar: x", "20/02/2024, 08:01 - Meera: y"], [exclude("Ravi Kumar")]);
    assert.deepEqual(s.participants.map((p) => p.displayLabel), ["Meera"]);
  });
});

// ---------------------------------------------------------------------------------------------
// N6

describe("N6: iOS attribution-only excluded identities do not leak", () => {
  const L = "\u200E";
  const ios = [
    `[20/02/2024, 08:00:00] Club: ${L}Asha added Priya`,
    `[20/02/2024, 08:01:00] Priya: ${L}Ravi left`,
    `[20/02/2024, 08:02:00] Asha: hello @Priya, and Priya's notes`,
    `[20/02/2024, 08:03:00] Club: ${L}Priya left`,
  ];
  it("audit example: excluding Priya removes her line, system lines naming her, and @mentions", async () => {
    const s = await chat(ios, [exclude("Priya")]);
    const json = JSON.stringify(s);
    assert.ok(!s.messages.some((m) => m.body.includes("Asha added Priya")), "system line naming Priya kept");
    assert.ok(!s.messages.some((m) => m.body === "Ravi left"), "her misread message kept");
    assert.ok(!s.messages.some((m) => m.body.includes("Priya left")));
    assert.ok(s.messages.some((m) => m.body.startsWith(`hello ${X}`)), "@mention not redacted");
    // Single-word name: free-text "Priya's" is deliberately left (documented N4 trade-off).
    assert.ok(json.includes("Priya's notes"));
  });
  it("without the exclusion everything is kept and nobody is invented as a participant", async () => {
    const s = await chat(ios);
    assert.deepEqual(s.participants.map((p) => p.displayLabel), ["Asha"]);
    assert.equal(s.stats.messagesExcluded, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// N7

describe("N7: grammar tails cannot absorb a sender separator", () => {
  const audit = [
    "Ravi changed the group's settings: secret text",
    "Ravi turned off disappearing messages.: secret",
    "Messages and calls are end-to-end encrypted. Fan: secret",
    "Ravi's security code changed. Tap: secret",
    "Ravi changed their phone number to a new number. Tap: secret",
    "Disappearing messages were turned on. X: secret",
  ];
  for (const line of audit) it(`not an event: ${line}`, () => assert.ok(!isSystemEvent(line)));

  it("real tails still parse", () => {
    assert.ok(isSystemEvent("Ravi turned off disappearing messages. Tap to change."));
    assert.ok(isSystemEvent("Your security code with Ravi changed. Tap to learn more."));
    assert.ok(isSystemEvent("Ravi changed the group's settings to allow only admins to send messages"));
  });

  it("tail-shaped senders keep their identity and can be excluded", async () => {
    const lines = ["20/02/2024, 08:00 - Asha: hi", "20/02/2024, 08:01 - Ravi's security code changed. Tap: private text"];
    const s = await chat(lines);
    const m = s.messages.find((x) => x.body === "private text");
    assert.equal(m?.kind, "text");
    assert.notEqual(m?.participantLocalId, null);
    const ex = await chat(lines, [exclude("Ravi's security code changed. Tap")]);
    assert.ok(!ex.messages.some((x) => x.body === "private text"));
  });

  it("quoted-slot events stay events but remain excludable by their would-be sender", async () => {
    const lines = ["20/02/2024, 08:00 - Asha: hi", '20/02/2024, 08:01 - Bob created group "x: secret"'];
    const s = await chat(lines);
    assert.equal(s.messages[1].kind, "system");
    assert.ok(!s.participants.some((p) => p.displayLabel.startsWith("Bob")));
    const ex = await chat(lines, [exclude('Bob created group "x')]);
    assert.ok(!ex.messages.some((x) => x.body.includes("secret")), "attribution fail-safe did not apply");
  });

  it("a real subject change with ': ' in the subject is still a system event", async () => {
    const s = await chat(['20/02/2024, 08:00 - Asha changed the subject from "Robotics: Core" to "Robotics: 2024"']);
    assert.equal(s.messages[0].kind, "system");
    assert.deepEqual(s.participants, []);
  });
});
