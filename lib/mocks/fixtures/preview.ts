/**
 * Deterministic stand-in for the parser's `previewSource` (§10.3 step 1, §11.4). The real preview
 * comes from lib/parsers; this produces a plausible rule-free `SourcePreview` from the file name and
 * size. `applyExclusionRules` (lib/mocks/preview-rules.ts) then applies the current rules (D33).
 */

import { MASK_KINDS, type IdentityKind, type MaskKind, type SourceKind } from "@/lib/contracts/enums";
import type { ParseContext, SourcePreview } from "@/lib/contracts/parser";

/** Mock parser version reported in `SourcePreview.parserVersion` and `ParseContext` (§11.4). */
export const MOCK_PARSER_VERSION = "0.8.0-mock";

function hash(s: string, seed = 2166136261) {
  let h = seed;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A 64-character lower-case hex stand-in for the identity HMAC (§12.11). NOT cryptographic: the mock
 * only needs a stable value that matches `IDENTITY_HASH_PATTERN`. Same input, same hash, so a saved
 * name seen in two chats produces the same `name` identity, as the real HMAC would.
 */
export function mockIdentityHash(normalizedIdentity: string): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += hash(normalizedIdentity, 2166136261 ^ Math.imul(i + 1, 0x9e3779b1)).toString(16).padStart(8, "0");
  return out;
}

const NAMES = ["Aditi Rao", "Karan Joshi", "Ishaan Gupta", "Riya Sen", "Dev Malhotra", "Tanvi Shah", "Participant 1", "Participant 2"];

/** Conversation previews (masked, ≤ 140 chars). Some mention a participant by name, as real chats do. */
const TOPICS: Array<(names: string[]) => string> = [
  () => "Planning the annual fest: venues, budget and volunteers",
  (n) => `Sponsor follow-ups and invoices, ${n[3] ?? n[1]} has the tracker`,
  () => "Weekly check-ins and task updates",
  (n) => `Recruitment drive and onboarding with ${n[1]}`,
  () => "Random banter and memes",
];

/** Phone-number senders are shown as "Participant N" and get a `phone` identity (§11.4). */
const identityKindOf = (label: string): IdentityKind => (/^Participant \d+$/.test(label) ? "phone" : "name");

function identityFor(label: string, fileName: string) {
  const identityKind = identityKindOf(label);
  // Different "Participant N" senders in different files are different numbers; a saved name is the same string everywhere.
  const normalized = identityKind === "phone" ? `tel:+9198${(hash(label + fileName) % 100_000_000).toString().padStart(8, "0")}` : `name:${label.toLowerCase()}`;
  return { identityKind, identityHash: mockIdentityHash(normalized), identityPepperVersion: "p1" as const };
}

export function mockParseContext(kind: SourceKind, timezone: string): ParseContext {
  return { timezone, dateOrder: kind === "whatsapp_export" ? "dmy" : null, parserVersion: MOCK_PARSER_VERSION };
}

export function mockPreview(kind: SourceKind, fileName: string, sizeBytes: number, timezone: string, now = Date.now()): SourcePreview {
  const seed = hash(fileName);
  const masking = { counts: Object.fromEntries(MASK_KINDS.map((k) => [k, 0])) as Record<MaskKind, number> };
  const parseContext = mockParseContext(kind, timezone);

  if (kind !== "whatsapp_export") {
    const blocks = Math.max(8, Math.min(400, Math.round(sizeBytes / 900)));
    masking.counts.phone = seed % 4;
    masking.counts.email = (seed >> 3) % 3;
    return {
      kind,
      parserVersion: MOCK_PARSER_VERSION,
      parseContext,
      participants: [],
      conversations: [],
      masking,
      stats: { totalLines: blocks * 3, messagesKept: blocks, messagesExcluded: 0, systemMessages: 0, mediaOmitted: 0 },
      identityMatches: [],
      firstMessageAt: null,
      lastMessageAt: null,
      warnings: [],
    };
  }

  const end = now - 2 * 86_400_000;
  const start = end - (120 + (seed % 120)) * 86_400_000;
  const total = Math.max(300, Math.min(9000, Math.round(sizeBytes / 140)));
  const people = NAMES.slice(0, 4 + (seed % 4));
  const participants = people.map((name, i) => ({
    localId: `p_${i + 1}`,
    displayLabel: name,
    ...identityFor(name, fileName),
    messageCount: Math.round((total / people.length) * (1.4 - i * 0.12)),
  }));
  const span = (end - start) / TOPICS.length;
  const conversations = TOPICS.map((topic, i) => ({
    localId: `c_${i + 1}`,
    startedAt: new Date(start + i * span).toISOString(),
    endedAt: new Date(start + (i + 1) * span - 3_600_000).toISOString(),
    messageCount: Math.round(total / TOPICS.length),
    participantLocalIds: participants.slice(0, 3 + (i % 3)).map((p) => p.localId),
    preview: topic(people).slice(0, 140),
  }));
  masking.counts.phone = 6 + (seed % 14);
  masking.counts.email = 2 + (seed % 5);
  masking.counts.upi = seed % 3;
  masking.counts.password = (seed >> 2) % 2;

  return {
    kind,
    parserVersion: MOCK_PARSER_VERSION,
    parseContext,
    participants,
    conversations,
    masking,
    stats: {
      totalLines: Math.round(total * 1.08),
      messagesKept: total,
      messagesExcluded: 0,
      systemMessages: Math.round(total * 0.03),
      mediaOmitted: Math.round(total * 0.04),
    },
    identityMatches: [],
    firstMessageAt: new Date(start).toISOString(),
    lastMessageAt: new Date(end).toISOString(),
    warnings: [],
  };
}
