/**
 * Round 3 (D4): the multi-format synthetic QA set. Single source of truth for the files in this folder.
 * Everything is invented (people, club, numbers: 99999 000NN, example.org). Deterministic: the same code
 * always writes byte-identical files, which lib/parsers/__tests__/demo-multiformat-r3.test.ts checks.
 *
 * Regenerate (from the repository root):
 *   node --import ./lib/contracts/__tests__/resolve-ts.mjs fixtures/demo/round3-multiformat/build.ts
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { SourceKind } from "../../../lib/contracts/enums";
import { buildDocx, buildPdf, buildZip, bytesOf } from "../../parser/builders";

export interface DemoFile {
  file: string;
  kind: SourceKind;
  /** The wizard group it is uploaded through ("chat" accepts .txt/.zip, "doc" accepts .pdf/.docx/.md). */
  group: "chat" | "doc";
  bytes: () => Uint8Array;
  /** Expected parser outcome with the default upload settings (Asia/Kolkata, no date order chosen). */
  expect:
    | { ok: true; messages: number; participants: number; masked: Partial<Record<string, number>> }
    | { ok: false; parserCode: string; note: string };
}

const ANDROID_CHAT = [
  "15/04/2026, 18:00 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.",
  '15/04/2026, 18:01 - Kavya Menon created group "Synthetic Drama Society Core"',
  "15/04/2026, 18:02 - Kavya Menon added Arjun Pillai",
  "15/04/2026, 18:05 - Kavya Menon: This chat holds the stage-manager handover for the spring production.",
  "15/04/2026, 18:07 - Kavya Menon: We decided the spring production runs on the main auditorium stage for three nights.",
  "15/04/2026, 18:09 - Arjun Pillai: Kavya is responsible for the costume budget and the rental receipts.",
  "15/04/2026, 18:11 - Kavya Menon: The lighting rehearsal is blocked until the electrician signs the safety form.",
  "15/04/2026, 18:13 - Arjun Pillai: There is a risk that the sound desk might fail again during the dress rehearsal.",
  "15/04/2026, 18:15 - Kavya Menon: Next step is to send the volunteer rota to the cast by Friday.",
  "16/04/2026, 09:30 - Arjun Pillai: For costume pickups call the store desk on 99999 00041 or write to costumes@example.org",
  "16/04/2026, 09:32 - Kavya Menon: <Media omitted>",
  "16/04/2026, 09:35 - Arjun Pillai: We need to return the borrowed ladders",
  "before the end of the month, the venue office will check.",
].join("\n") + "\n";

const IOS_CHAT = [
  "[20/04/2026, 7:00:00 PM] Synthetic Drama Society Core: ‎Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.",
  "[20/04/2026, 7:02:10 PM] Arjun Pillai: The props cupboard handles everything for act two, Meera owns the key.",
  "[20/04/2026, 7:03:45 PM] Meera Iyer: ‎image omitted",
  "[20/04/2026, 7:05:00 PM] Meera Iyer: We agreed to keep the prop list in the shared drive folder.",
  "[20/04/2026, 7:06:30 PM] Arjun Pillai: Ticket printing is waiting on the final seating plan from the venue.",
  "[21/04/2026, 8:15:00 AM] Meera Iyer: The fog machine trips the fuse every time we test it, it failed again yesterday.",
].join("\n") + "\n";

const MARKDOWN = `# Synthetic Drama Society — production handbook (demo data)

All names, numbers and organisations in this file are invented for testing.

## Decisions
The committee decided that ticket income is reconciled every Monday by the treasurer.

## Responsibilities
The stage manager is responsible for the backstage safety checklist on every show night.

Contact for the venue office: venue.office@example.org.

## Open items
We need to renew the public liability insurance before the autumn season.

\`\`\`
Rota template
  Night 1: front of house
  Night 2: backstage
\`\`\`
`;

const PDF_PAGES = [
  {
    paragraphs: [
      ["Synthetic Venue Report"],
      ["The venue manager agreed to hold the auditorium for the spring production."],
      ["Booking reference contact: 99999 00042."],
    ],
  },
  {
    paragraphs: [
      ["Page two: open items"],
      ["The rigging inspection is pending and needs to happen before the first rehearsal."],
    ],
  },
];

const DOCX_PARAGRAPHS = [
  { text: "Sponsor handover (synthetic)", style: "Heading1" },
  { text: "The sponsorship lead handles the renewal call with the local bookshop sponsor." },
  { text: "We finalised the logo placement on the programme cover.", deleted: "an earlier draft placement" },
  { text: "Open questions", style: "Heading2" },
  { text: "The banner print order is stuck waiting on the sponsor's artwork." },
  { text: "Sponsor contact: sponsor.desk@example.org" },
];

const AMBIGUOUS_CHAT = [
  "02/03/2026, 10:00 - Kavya Menon: Auditions are on the second of the month.",
  "04/05/2026, 11:00 - Arjun Pillai: We decided the callbacks happen a week later.",
  "06/07/2026, 12:00 - Kavya Menon: Thanks, I will book the rehearsal room.",
].join("\n") + "\n";

export const MULTIFORMAT_SET: readonly DemoFile[] = [
  {
    file: "round3-drama-chat-android.txt",
    kind: "whatsapp_export",
    group: "chat",
    bytes: () => bytesOf(ANDROID_CHAT),
    expect: { ok: true, messages: 12, participants: 2, masked: { phone: 1, email: 1 } },
  },
  {
    file: "round3-drama-chat-ios.zip",
    kind: "whatsapp_export",
    group: "chat",
    bytes: () =>
      buildZip([
        { name: "_chat.txt", data: IOS_CHAT, dataDescriptor: true },
        { name: "00000003-PHOTO-2026-04-20-19-03-45.jpg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) },
      ]),
    expect: { ok: true, messages: 6, participants: 2, masked: {} },
  },
  {
    file: "round3-production-handbook.md",
    kind: "markdown",
    group: "doc",
    bytes: () => bytesOf(MARKDOWN),
    expect: { ok: true, messages: 10, participants: 0, masked: { email: 1 } },
  },
  {
    file: "round3-venue-report.pdf",
    kind: "pdf",
    group: "doc",
    bytes: () => buildPdf(PDF_PAGES, { compress: true }),
    expect: { ok: true, messages: 5, participants: 0, masked: { phone: 1 } },
  },
  {
    file: "round3-sponsor-handover.docx",
    kind: "docx",
    group: "doc",
    bytes: () => buildDocx(DOCX_PARAGRAPHS),
    expect: { ok: true, messages: 6, participants: 0, masked: { email: 1 } },
  },
  {
    file: "round3-ambiguous-dates-chat.txt",
    kind: "whatsapp_export",
    group: "chat",
    bytes: () => bytesOf(AMBIGUOUS_CHAT),
    expect: { ok: false, parserCode: "date_format_ambiguous", note: "Preview asks for the date order; choose day-first (dmy) and it parses 3 messages." },
  },
  {
    file: "round3-scanned-report.pdf",
    kind: "pdf",
    group: "doc",
    bytes: () => buildPdf([{ paragraphs: [["(scanned page)"]] }], { imageOnly: true }),
    expect: { ok: false, parserCode: "no_text_layer", note: "Image-only PDF: the preview shows the 'no selectable text' failure." },
  },
];

const HERE = dirname(fileURLToPath(import.meta.url));

function main() {
  for (const f of MULTIFORMAT_SET) writeFileSync(join(HERE, f.file), f.bytes());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
