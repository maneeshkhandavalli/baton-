// Round 3 (D2 privacy): PII masking coverage across every source format and every output field, and
// participant exclusions: excluded people and their mentions never reach anything evidence can cite.
// Synthetic data only (phones 99999 000NN, example.org, checksum-valid but invented card/Aadhaar).
// The credential/password detector is Agent 4's (QA-L5) and is deliberately not exercised here.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDocx, buildPdf, buildZip, bytesOf } from "../../../fixtures/parser/builders";
import { input, participantRule } from "../../../fixtures/parser/load";
import { EXCLUDED_PARTICIPANT_TOKEN, type ParsedSource, type ParseSourceInput, type SourcePreview } from "../../contracts/parser";
import { parseSource, previewSource } from "../../parsers/parse-source";
import { luhnCheckDigit, verhoeffCheckDigit } from "../checksums";

const CARD = "411111111111111" + luhnCheckDigit("411111111111111");
const AADHAAR = "23456789012" + verhoeffCheckDigit("23456789012");

/** One PII sentence per detector family, and the raw fragments that must never survive. */
const PII_LINES = [
  "Call the venue desk on +91 99999 00011 or 99999-00012 after lunch.",
  "Send the receipts to treasurer.synthetic@example.org please.",
  "Pay the hall deposit to robofunds@okaxis today.",
  "Bank a/c no: 009876543210 IFSC SBIN0004321 for refunds.",
  `Aadhaar on file is ${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)} for the permit.`,
  "The club PAN ABCPE1234F goes on the invoice.",
  `Card ${CARD.slice(0, 4)} ${CARD.slice(4, 8)} ${CARD.slice(8, 12)} ${CARD.slice(12)} was charged.`,
];
const LEAKS = [
  "00011", "00012", "treasurer.synthetic", "robofunds", "009876543210", "SBIN0004321",
  AADHAAR.slice(8), "ABCPE1234F", CARD.slice(12),
];
const EXPECTED_KINDS = ["phone", "email", "upi", "bank_account", "ifsc", "government_id", "card"] as const;

async function parsed(i: ParseSourceInput): Promise<ParsedSource> {
  const r = await parseSource(i);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.error));
  return r.data;
}

function assertNoLeak(label: string, value: unknown, leaks: readonly string[] = LEAKS) {
  const json = JSON.stringify(value);
  for (const leak of leaks) assert.ok(!json.includes(leak), `${label}: leaked ${leak}`);
}

function assertAllKindsCounted(label: string, s: ParsedSource) {
  for (const k of EXPECTED_KINDS) assert.ok(s.masking.counts[k] >= 1, `${label}: no ${k} masked`);
}

describe("R3 privacy: PII masking in every format and field", () => {
  const chatText =
    PII_LINES.map((l, i) => `14/02/2024, 18:${String(i).padStart(2, "0")} - Asha Rao: ${l}`).join("\n") +
    "\n14/02/2024, 18:30 - +91 99999 00014: sent from an unsaved number\n" +
    "14/02/2024, 18:31 - lead.synthetic@example.org: sent by an email-named contact\n";
  const chatLeaks = [...LEAKS, "00014", "lead.synthetic"];

  const formats: Array<{ name: string; make: () => ParseSourceInput }> = [
    { name: "WhatsApp .txt", make: () => input({ kind: "whatsapp_export", bytes: bytesOf(chatText) }) },
    {
      name: "WhatsApp .zip (file name holds a number too)",
      make: () => input({ kind: "whatsapp_export", bytes: buildZip([{ name: "WhatsApp Chat with +91 99999 00015.txt", data: chatText }]) }),
    },
    {
      name: "Markdown (PII in headings and body)",
      make: () => input({ kind: "markdown", bytes: bytesOf(`# Contacts 99999 00013\n\n${PII_LINES.join("\n\n")}\n\n## Owner treasurer.synthetic@example.org\n\nDone.\n`) }),
    },
    { name: "plain text", make: () => input({ kind: "text", bytes: bytesOf(PII_LINES.join("\n\n")) }) },
    {
      name: "DOCX (heading style + paragraphs)",
      make: () => input({ kind: "docx", bytes: buildDocx([{ text: "Contacts 99999 00013", style: "Heading1" }, ...PII_LINES.map((text) => ({ text }))]) }),
    },
    { name: "PDF", make: () => input({ kind: "pdf", bytes: buildPdf([{ paragraphs: PII_LINES.map((l) => [l]) }]) }) },
    { name: "PDF (compressed)", make: () => input({ kind: "pdf", bytes: buildPdf([{ paragraphs: PII_LINES.map((l) => [l]) }], { compress: true }) }) },
  ];

  for (const f of formats) {
    it(`${f.name}: no raw value in messages, headings, labels, previews or warnings`, async () => {
      const s = await parsed(f.make());
      assertNoLeak(f.name, s, [...chatLeaks, "00013", "00015"]);
      assertAllKindsCounted(f.name, s);
      const p = await previewSource(f.make());
      assert.ok(p.ok);
      assertNoLeak(`${f.name} preview`, p.data, [...chatLeaks, "00013", "00015"]);
    });
  }

  it("the same value gets the same token across messages and formats keep tokens numbered per source", async () => {
    const s = await parsed(input({ kind: "markdown", bytes: bytesOf("Call 99999 00021.\n\nAgain: 99999 00021.\n\nOther: 99999 00022.\n") }));
    assert.deepEqual(s.messages.map((m) => m.body), ["Call [PHONE_1].", "Again: [PHONE_1].", "Other: [PHONE_2]."]);
  });

  it("phone-number senders are labelled 'Participant N' and email-named senders are masked", async () => {
    const s = await parsed(formats[0].make());
    const labels = s.participants.map((p) => p.displayLabel);
    assert.deepEqual(labels.slice(0, 1), ["Asha Rao"]);
    assert.ok(labels.includes("Participant 2"), JSON.stringify(labels));
    assert.ok(labels.some((l) => /^\[EMAIL_\d+\]$/.test(l)), JSON.stringify(labels));
  });

  it("obfuscated digits (full-width, Devanagari, zero-width) inside documents are still masked", async () => {
    const s = await parsed(input({ kind: "text", bytes: bytesOf("Desk ９９９９９００００１\n\nAlt ९९९९९०००० २\n\nZW 99999​00003\n".replace(" २", "२")) }));
    assert.equal(s.masking.counts.phone, 3, JSON.stringify(s.messages));
  });
});

// ── Exclusions ─────────────────────────────────────────────────────────────────────────────────

const RAVI_PHONE = "+91 99999 00031";
const EXCL_CHAT = [
  "21/03/2024, 10:00 - Asha Rao: Morning all, venue is confirmed.",
  "21/03/2024, 10:01 - Ravi Kumar: I will bring the projector.",
  "Ravi's continuation line: Asha Rao: this looks like a header but is mine",
  "21/03/2024, 10:02 - Meera Iyer: Thanks Ravi Kumar, and @Ravi Kumar please confirm.",
  "21/03/2024, 10:03 - Asha Rao: RAVI KUMAR owes the receipts; ask ravi kumar's team.",
  "21/03/2024, 10:04 - Asha Rao added Ravi Kumar",
  `21/03/2024, 10:05 - ${RAVI_PHONE}: second phone of the excluded volunteer`,
  "21/03/2024, 10:06 - Meera Iyer: His other number is +91-99999-00031, call 9999900031 if needed.",
  "21/03/2024, 10:07 - Asha Rao: Ravindra from the AV team is a different person.",
].join("\n");

const excludeRavi = () => [participantRule("Ravi Kumar"), participantRule(RAVI_PHONE)];

function citableText(s: ParsedSource | SourcePreview): string {
  // Everything downstream (extraction prompts, quotes, evidence, previews) is derived from these fields.
  const messages = "messages" in s ? s.messages.map((m) => m.body) : [];
  return JSON.stringify({
    messages,
    labels: s.participants.map((p) => p.displayLabel),
    previews: s.conversations.map((c) => c.preview),
    warnings: s.warnings,
  });
}

describe("R3 privacy: excluded participants never reach evidence", () => {
  const make = (bytes: Uint8Array) => input({ kind: "whatsapp_export", bytes, exclusions: excludeRavi() });

  for (const [name, bytes] of [
    ["txt", bytesOf(EXCL_CHAT)],
    ["zip", buildZip([{ name: "WhatsApp Chat with Club.txt", data: EXCL_CHAT, dataDescriptor: true }])],
  ] as const) {
    it(`${name}: no message, continuation line, name (any case), @mention or number of the excluded person survives`, async () => {
      const s = await parsed(make(bytes));
      const text = citableText(s).toLowerCase();
      for (const leak of ["ravi kumar", "@ravi", "projector", "this looks like a header but is mine", "second phone", "00031"]) {
        assert.ok(!text.includes(leak), `${name}: leaked ${leak}: ${text}`);
      }
      assert.ok(text.includes("ravindra"), "a different person whose name extends the excluded one is kept");
      assert.ok(s.messages.some((m) => m.body.includes(EXCLUDED_PARTICIPANT_TOKEN)), "mentions are replaced by the reserved token");
      assert.equal(s.participants.length, 2, JSON.stringify(s.participants.map((p) => p.displayLabel)));
      assert.ok(s.messages.every((m) => m.kind !== "system" || !/ravi/i.test(m.body)), "system lines naming them are dropped");
      const p = await previewSource(make(bytes));
      assert.ok(p.ok);
      const ptext = citableText(p.data).toLowerCase();
      for (const leak of ["ravi kumar", "projector", "00031"]) assert.ok(!ptext.includes(leak), `${name} preview: leaked ${leak}`);
    });
  }

  it("every kept message's location points at lines whose author is not excluded", async () => {
    const s = await parsed(make(bytesOf(EXCL_CHAT)));
    const lines = EXCL_CHAT.split("\n");
    for (const m of s.messages) {
      const span = lines.slice(m.location!.lineStart - 1, m.location!.lineEnd).join("\n");
      assert.ok(!/ - (Ravi Kumar|\+91 99999 00031): /.test(span), `kept message spans an excluded line: ${span}`);
    }
  });

  it("counts are the only trace: stats report what was dropped, nothing else", async () => {
    const s = await parsed(make(bytesOf(EXCL_CHAT)));
    const all = await parsed(input({ kind: "whatsapp_export", bytes: bytesOf(EXCL_CHAT) }));
    assert.equal(s.stats.messagesKept + s.stats.messagesExcluded, all.stats.messagesKept);
    assert.equal(s.stats.messagesExcluded, 3); // Ravi's message, his phone's message, "Asha Rao added Ravi Kumar"
  });

  it("an exclusion is fail-closed: a malformed rule list stops the parse instead of keeping everything", async () => {
    const r = await parseSource({ ...make(bytesOf(EXCL_CHAT)), exclusions: [{ kind: "participant" }] as never });
    assert.ok(!r.ok);
  });
});
