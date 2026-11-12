// Round 3 (D2): evidence provenance. Every parsed unit must be traceable to its source and a location
// inside it (lines for text and chats, page + lines for PDF, paragraph ordinal for DOCX), because quotes
// and evidence are only ever cut from these units (§10.7) and reviewers jump back to the location.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { buildDocx, buildPdf, buildZip, bytesOf } from "../../../fixtures/parser/builders";
import { fixtureBytes, input } from "../../../fixtures/parser/load";
import type { ParsedSource, ParseSourceInput } from "../../contracts/parser";
import { parseSource, previewSource } from "../parse-source";
import { splitLines } from "../text-decode";

const TOKEN = /\[[A-Z_]+(?:_\d+)?\]/;

async function ok(i: ParseSourceInput): Promise<ParsedSource> {
  const r = await parseSource(i);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

/** Structural provenance invariants shared by every kind. */
function assertStructure(label: string, s: ParsedSource) {
  s.messages.forEach((m, i) => {
    assert.equal(m.seq, i, `${label}: seq is dense`);
    assert.ok(Number.isInteger(m.location!.lineStart) && m.location!.lineStart >= 1, `${label}: lineStart ≥ 1`);
    assert.ok(m.location!.lineEnd >= m.location!.lineStart, `${label}: lineEnd ≥ lineStart`);
    assert.ok(m.location!.lineEnd <= Math.max(s.stats.totalLines, 1) || m.location!.page !== undefined, `${label}: within the source`);
  });
}

/** Text sources: every body line (outside mask tokens) is verbatim inside the lines its location names. */
function assertTextTraceable(label: string, raw: Uint8Array, s: ParsedSource) {
  const lines = splitLines(new TextDecoder().decode(raw).replace(/^﻿/, ""));
  for (const m of s.messages) {
    const span = lines.slice(m.location!.lineStart - 1, m.location!.lineEnd).join("\n").normalize("NFC");
    for (const bodyLine of m.body.split("\n")) {
      const t = bodyLine.trim();
      if (t === "" || TOKEN.test(t)) continue;
      assert.ok(span.includes(t), `${label} seq ${m.seq}: ${JSON.stringify(t)} not in lines ${m.location!.lineStart}-${m.location!.lineEnd}`);
    }
  }
}

function chatsIn(dir: string): string[] {
  return readdirSync(new URL(`../../../fixtures/${dir}/`, import.meta.url)).filter((f) => f.endsWith(".txt") || f.endsWith(".md"));
}

describe("R3 D2 provenance: text sources", () => {
  const chatFixtures = ["android-24h-dmy.txt", "android-12h-mdy.txt", "ios-12h-dmy.txt", "ios-24h-ymd.txt", "adversarial-senders-android.txt", "adversarial-senders-ios.txt", "malformed.txt"];
  for (const f of chatFixtures) {
    it(`parser fixture whatsapp/${f}`, async () => {
      const raw = fixtureBytes(`whatsapp/${f}`);
      const s = await ok(input({ kind: "whatsapp_export", bytes: raw, dateOrder: f.includes("mdy") ? "mdy" : f.includes("ymd") ? undefined : "dmy" }));
      assertStructure(f, s);
      assertTextTraceable(f, raw, s);
      for (let i = 1; i < s.messages.length; i++) {
        assert.ok(s.messages[i].location!.lineStart > s.messages[i - 1].location!.lineEnd, `${f}: chat locations are ordered and disjoint`);
      }
    });
  }

  for (const f of chatsIn("demo")) {
    it(`demo fixture ${f}`, async () => {
      const raw = new Uint8Array(fixtureBytes(`../demo/${f}`));
      const kind = f.endsWith(".md") ? "markdown" : "whatsapp_export";
      const s = await ok(input({ kind, bytes: raw, ...(kind === "whatsapp_export" ? { dateOrder: "dmy" as const } : {}) }));
      assertStructure(f, s);
      assertTextTraceable(f, raw, s);
    });
  }

  it("Markdown: headings, setext, fences and front matter keep exact line ranges", async () => {
    const md = ["---", "title: Synthetic", "---", "", "# Budget", "", "First paragraph", "continues here.", "", "Owners", "======", "", "```", "code line", "", "more code", "```", "", "Tail."].join("\n");
    const s = await ok(input({ kind: "markdown", bytes: bytesOf(md) }));
    assert.deepEqual(
      s.messages.map((m) => [m.location!.lineStart, m.location!.lineEnd, m.location!.heading ?? null]),
      [[1, 3, null], [5, 5, "Budget"], [7, 8, "Budget"], [10, 11, "Owners"], [13, 17, "Owners"], [19, 19, "Owners"]],
    );
    assertTextTraceable("markdown", bytesOf(md), s);
  });

  it("CRLF and LF Markdown give the same locations", async () => {
    const md = "# A\n\nOne\ntwo\n\n# B\n\nThree\n";
    const a = await ok(input({ kind: "markdown", bytes: bytesOf(md) }));
    const b = await ok(input({ kind: "markdown", bytes: bytesOf(md.replace(/\n/g, "\r\n")) }));
    assert.deepEqual(a.messages, b.messages);
  });

  it("a ZIP export and its .txt give identical locations (the archive adds no offset)", async () => {
    const raw = fixtureBytes("whatsapp/ios-12h-dmy.txt");
    const a = await ok(input({ kind: "whatsapp_export", bytes: raw }));
    const b = await ok(input({ kind: "whatsapp_export", bytes: buildZip([{ name: "Chat/_chat.txt", data: raw }]) }));
    assert.deepEqual(a.messages.map((m) => m.location!), b.messages.map((m) => m.location!));
  });

  it("preview and parse assign the same conversation and participant ids to the same lines", async () => {
    const raw = fixtureBytes("whatsapp/android-24h-dmy.txt");
    const s = await ok(input({ kind: "whatsapp_export", bytes: raw }));
    const p = await previewSource(input({ kind: "whatsapp_export", bytes: raw }));
    assert.ok(p.ok);
    assert.deepEqual(p.data.conversations.map((c) => c.localId), [...new Set(s.messages.map((m) => m.conversationLocalId))]);
    assert.deepEqual(p.data.participants.map((x) => x.localId), s.participants.map((x) => x.localId));
    for (const m of s.messages) if (m.participantLocalId) assert.ok(s.participants.some((x) => x.localId === m.participantLocalId));
  });
});

describe("R3 D2 provenance: binary documents", () => {
  it("PDF: page and line numbers name where each block came from", async () => {
    const pages = [
      { paragraphs: [["Alpha one"], ["Alpha two", "wraps here"]] },
      { paragraphs: [["Beta one"]] },
      { paragraphs: [["Gamma one"], ["Gamma two"], ["Gamma three"]] },
    ];
    const s = await ok(input({ kind: "pdf", bytes: buildPdf(pages) }));
    assertStructure("pdf", s);
    const expected: Array<[string, number, number, number]> = [];
    pages.forEach((pg, pi) => {
      let line = 1;
      for (const para of pg.paragraphs) {
        expected.push([para.join("\n"), pi + 1, line, line + para.length - 1]);
        line += para.length;
      }
    });
    assert.deepEqual(s.messages.map((m) => [m.body, m.location!.page, m.location!.lineStart, m.location!.lineEnd]), expected);
  });

  it("DOCX: the location is the paragraph ordinal, counting empty paragraphs, with the nearest heading", async () => {
    const s = await ok(input({
      kind: "docx",
      bytes: buildDocx([
        { text: "Handover", style: "Heading1" },
        { text: "" },
        { text: "Para A" },
        { text: "Section two", style: "Heading2" },
        { text: "Para B", deleted: "removed words" },
      ]),
    }));
    assertStructure("docx", s);
    assert.deepEqual(
      s.messages.map((m) => [m.body, m.location!.lineStart, m.location!.heading]),
      [["Handover", 1, "Handover"], ["Para A", 3, "Handover"], ["Section two", 4, "Section two"], ["Para B", 5, "Section two"]],
    );
  });
});
