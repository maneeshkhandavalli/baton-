/**
 * Turns format-specific raw records into the canonical `ParsedSource` (§11.4).
 *
 * Order of operations is fixed and is what keeps excluded content out of the output:
 *   1. limits (counted before exclusions),
 *   2. participants and identity hashes (first-appearance order, p_1…),
 *   3. conversation segmentation (> 6 h gap, c_1…) over ALL messages, so local ids are identical
 *      in the preview and the final parse,
 *   4. exclusions, in memory (excluded people's whole names and @mentions are also redacted from
 *      messages that are kept). Participant rules match on identity kind, hash AND pepper version;
 *      `detect` rules drop nothing and are reported as `identityMatches`. Conversation rules are
 *      checked against this parse's `ParseContext` first (mismatch → `exclusion_context_mismatch`),
 *   5. masking of the kept content only (bodies, labels, previews, headings),
 *   6. dense `seq` numbering and statistics.
 */

import type { IdentityKind, MessageKind, SourceKind } from "../contracts/enums";
import type {
  IdentityMatch,
  NormalizedMessage,
  ParseContext,
  ParsedConversation,
  ParsedParticipant,
  ParsedSource,
} from "../contracts/parser";
import {
  conversationIdsFor,
  inExcludedRange,
  participantRulesFor,
  type CompiledExclusions,
} from "../privacy/exclusions";
import {
  IDENTITY_PEPPER_VERSION,
  cleanSenderString,
  computeIdentityHash,
  identityKindOf,
  isPhoneLikeSender,
  normalizeSenderIdentity,
} from "../privacy/identity";
import { createExcludedMentionRedactor } from "../privacy/excluded-mentions";
import { createMasker, type Masker } from "../privacy/mask";
import { foldDigits } from "../privacy/phone";
import { ParserAbort } from "./errors";
import { LIMITS } from "./limits";
import { PARSER_VERSION } from "./version";
import type { WarningCollector } from "./warnings";

/** A new conversation segment starts after a gap of more than 6 hours (§11.4 [PROPOSED]). */
export const CONVERSATION_GAP_MS = 6 * 60 * 60 * 1000;

export interface RawChatMessage {
  lineStart: number; // 1-based
  lineEnd: number;
  sentAtIso: string;
  sentAtMs: number;
  /** Raw sender string as exported; null for system lines. */
  sender: string | null;
  kind: Exclude<MessageKind, "document_block">;
  /** Unmasked body; "" for media_omitted and deleted. */
  body: string;
  /**
   * iOS direction-marked system lines only: the name field the line was written under. Never a
   * participant; used solely so that excluding that identity also drops the line (fail-safe if a
   * real message was ever misclassified as an event).
   */
  systemAttribution?: string;
}

export interface RawDocumentBlock {
  body: string;
  page?: number;
  heading?: string;
  lineStart: number;
  lineEnd: number;
}

export interface BuildCommon {
  kind: SourceKind;
  totalLines: number;
  warnings: WarningCollector;
  /** Already validated by `compileExclusions`. */
  exclusions: CompiledExclusions;
  /** This parse's context: timezone, EFFECTIVE date order (null for documents), parser version. */
  parseContext: ParseContext;
}

function emptyStats(totalLines: number): ParsedSource["stats"] {
  return { totalLines, messagesKept: 0, messagesExcluded: 0, systemMessages: 0, mediaOmitted: 0 };
}

function truncatePreview(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim() !== "") ?? "";
  const chars = Array.from(firstLine.trim());
  if (chars.length <= LIMITS.maxPreviewChars) return chars.join("");
  return chars.slice(0, LIMITS.maxPreviewChars - 1).join("") + "…";
}

function maskedLabel(rawSender: string, ordinal: number, masker: Masker): string {
  const clean = cleanSenderString(rawSender);
  // Phone-number senders are never shown as numbers (§6.6, D22).
  if (isPhoneLikeSender(clean) || clean === "") return `Participant ${ordinal}`;
  return masker.mask(clean, "chat").text;
}

export function buildChatSource(
  common: BuildCommon,
  raw: readonly RawChatMessage[],
  identityPepper: string,
): ParsedSource {
  if (raw.length > LIMITS.maxMessagesPerSource) {
    throw new ParserAbort("too_large", `The chat has more than ${LIMITS.maxMessagesPerSource} messages.`);
  }
  const exclusions = common.exclusions;
  // Conversation rules from another parse context fail the whole call before anything is built.
  const excludedConversations = conversationIdsFor(exclusions, common.parseContext);

  // 2. Participants, keyed by normalized identity, first-appearance order.
  interface P {
    localId: string;
    ordinal: number;
    rawSender: string;
    identityKind: IdentityKind;
    identityHash: string;
    /** An `apply` rule matched (kind, hash and version). */
    excluded: boolean;
    /** `detect` rules that matched, in rule order. */
    detectedBy: Array<{ index: number; ruleId: string | null }>;
  }
  const byIdentity = new Map<string, P>();
  const participantOf: Array<P | null> = raw.map((m) => {
    if (m.sender === null) return null;
    const key = normalizeSenderIdentity(m.sender);
    let p = byIdentity.get(key);
    if (!p) {
      const ordinal = byIdentity.size + 1;
      const identityHash = computeIdentityHash(m.sender, identityPepper);
      const identityKind = identityKindOf(m.sender);
      const rules = participantRulesFor(exclusions, identityKind, identityHash, IDENTITY_PEPPER_VERSION);
      p = {
        localId: `p_${ordinal}`,
        ordinal,
        rawSender: m.sender,
        identityKind,
        identityHash,
        excluded: rules.some((r) => r.mode === "apply"),
        detectedBy: rules.filter((r) => r.mode === "detect").map((r) => ({ index: r.index, ruleId: r.ruleId })),
      };
      byIdentity.set(key, p);
    }
    return p;
  });

  // 3. Conversation segmentation over all messages.
  const conversationOf: string[] = [];
  let convoCount = 0;
  let prevMs: number | null = null;
  for (const m of raw) {
    if (prevMs === null || m.sentAtMs - prevMs > CONVERSATION_GAP_MS) convoCount++;
    conversationOf.push(`c_${convoCount}`);
    prevMs = prevMs === null ? m.sentAtMs : Math.max(prevMs, m.sentAtMs);
  }

  // Excluded identities known BY NAME in this source: excluded participants, plus excluded
  // identities that appear only as the attribution of a system line (an iOS "Name: \u200E<event>"
  // line, or an Android event line whose first ": " lies inside a quoted subject). The latter are
  // never participants, so without this their names would survive in other lines.
  const excludedSenders: string[] = [];
  const excludedKeys = new Set<string>();
  const addExcluded = (rawName: string) => {
    const key = normalizeSenderIdentity(rawName);
    if (excludedKeys.has(key)) return;
    excludedKeys.add(key);
    excludedSenders.push(rawName);
  };
  for (const p of byIdentity.values()) if (p.excluded) addExcluded(p.rawSender);
  const attributionExcluded: boolean[] = raw.map((m) => {
    if (m.systemAttribution === undefined || exclusions.applyCount === 0) return false;
    const excluded = participantRulesFor(
      exclusions,
      identityKindOf(m.systemAttribution),
      computeIdentityHash(m.systemAttribution, identityPepper),
      IDENTITY_PEPPER_VERSION,
    ).some((r) => r.mode === "apply");
    if (excluded) addExcluded(m.systemAttribution);
    return excluded;
  });

  // System lines naming an excluded identity ("Ravi left") are dropped too (substring match,
  // deliberately broad: dropping an extra system line is the safe failure).
  const excludedNames: string[] = [];
  const excludedDigits: string[] = [];
  for (const rawName of excludedSenders) {
    const clean = cleanSenderString(rawName);
    if (isPhoneLikeSender(clean)) excludedDigits.push(foldDigits(clean).replace(/\D/g, "").slice(-10));
    else if (clean.length >= 2) excludedNames.push(clean.toLowerCase());
  }
  // Their names and @mentions inside messages that are kept (written by others). Kept senders are
  // passed so a different, kept person whose name extends an excluded one is not misattributed.
  const keptSenders = Array.from(byIdentity.values())
    .filter((p) => !p.excluded)
    .map((p) => p.rawSender);
  const mentionRedactor = createExcludedMentionRedactor(excludedSenders, { keptSenders });
  let redactedMentions = 0;
  const mentionsExcluded = (body: string): boolean => {
    if (excludedNames.length === 0 && excludedDigits.length === 0) return false;
    const lower = cleanSenderString(body).toLowerCase();
    if (excludedNames.some((n) => lower.includes(n))) return true;
    const digits = foldDigits(body).replace(/\D/g, "");
    return excludedDigits.some((d) => d.length >= 7 && digits.includes(d));
  };

  // 4. Exclusions.
  const keptIdx: number[] = [];
  let excludedCount = 0;
  raw.forEach((m, i) => {
    const p = participantOf[i];
    const excluded =
      (p !== null && p.excluded) ||
      excludedConversations.has(conversationOf[i]) ||
      inExcludedRange(exclusions, m.sentAtMs) ||
      attributionExcluded[i] ||
      (m.kind === "system" && mentionsExcluded(m.body));
    if (excluded) excludedCount++;
    else keptIdx.push(i);
  });

  // 5–6. Mask kept content, number densely.
  const masker = createMasker();
  const stats = emptyStats(common.totalLines);
  const messages: NormalizedMessage[] = [];
  const participantCounts = new Map<string, number>();
  interface C {
    start: number;
    end: number;
    count: number;
    participants: string[];
    preview: string | null;
  }
  const convos = new Map<string, C>();

  for (const i of keptIdx) {
    const m = raw[i];
    const p = participantOf[i];
    const convoId = conversationOf[i];
    let text = m.body;
    if (text !== "" && !mentionRedactor.isEmpty) {
      const r = mentionRedactor.redact(text);
      text = r.text;
      redactedMentions += r.count;
    }
    const body = text === "" ? "" : masker.mask(text, "chat").text;
    messages.push({
      seq: messages.length,
      conversationLocalId: convoId,
      participantLocalId: p ? p.localId : null,
      sentAt: m.sentAtIso,
      kind: m.kind,
      body,
      location: { lineStart: m.lineStart, lineEnd: m.lineEnd },
    });
    if (m.kind === "system") stats.systemMessages++;
    if (m.kind === "media_omitted") stats.mediaOmitted++;
    if (p) participantCounts.set(p.localId, (participantCounts.get(p.localId) ?? 0) + 1);

    let c = convos.get(convoId);
    if (!c) {
      c = { start: m.sentAtMs, end: m.sentAtMs, count: 0, participants: [], preview: null };
      convos.set(convoId, c);
    }
    c.start = Math.min(c.start, m.sentAtMs);
    c.end = Math.max(c.end, m.sentAtMs);
    c.count++;
    if (p && !c.participants.includes(p.localId)) c.participants.push(p.localId);
    if (c.preview === null && m.kind === "text" && body.trim() !== "") c.preview = truncatePreview(body);
  }

  const participants: ParsedParticipant[] = [];
  const identityMatches: IdentityMatch[] = [];
  for (const p of byIdentity.values()) {
    const count = participantCounts.get(p.localId) ?? 0;
    if (p.excluded || count === 0) continue; // nothing about excluded participants is emitted
    // A `detect` rule matched a retained participant: report it for a human decision (§6.8.1).
    // One entry per distinct ruleId (identical entries would carry no extra information).
    const seenRules = new Set<string | null>();
    for (const d of p.detectedBy) {
      if (seenRules.has(d.ruleId)) continue;
      seenRules.add(d.ruleId);
      identityMatches.push({ ruleId: d.ruleId, participantLocalId: p.localId, identityKind: p.identityKind });
    }
    participants.push({
      localId: p.localId,
      // A label naming an excluded person ("Ravi Kumar's Mom") would leak that name: anonymise it.
      displayLabel: mentionRedactor.mentionsExcluded(cleanSenderString(p.rawSender))
        ? `Participant ${p.ordinal}`
        : maskedLabel(p.rawSender, p.ordinal, masker),
      identityKind: p.identityKind,
      identityHash: p.identityHash,
      identityPepperVersion: IDENTITY_PEPPER_VERSION,
      messageCount: count,
    });
  }

  const conversations: ParsedConversation[] = [];
  for (const [localId, c] of convos) {
    conversations.push({
      localId,
      startedAt: new Date(c.start).toISOString(),
      endedAt: new Date(c.end).toISOString(),
      messageCount: c.count,
      participantLocalIds: c.participants,
      preview: c.preview ?? "",
    });
  }

  stats.messagesKept = messages.length;
  stats.messagesExcluded = excludedCount;
  let first: number | null = null;
  let last: number | null = null;
  for (const i of keptIdx) {
    const ms = raw[i].sentAtMs;
    if (first === null || ms < first) first = ms;
    if (last === null || ms > last) last = ms;
  }

  if (redactedMentions > 0) {
    common.warnings.summary(
      "excluded_mentions_redacted",
      `${redactedMentions} mention(s) of excluded participants were removed from other people's messages.`,
    );
  }

  // A warning must never point at an excluded message (preview privacy, §11.4). Raw messages are in
  // source order, so their line spans are sorted and disjoint: binary search.
  const kept = new Uint8Array(raw.length);
  for (const i of keptIdx) kept[i] = 1;
  const isExcludedLine = (line: number): boolean => {
    let lo = 0;
    let hi = raw.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (raw[mid].lineEnd < line) lo = mid + 1;
      else if (raw[mid].lineStart > line) hi = mid - 1;
      else return kept[mid] === 0;
    }
    return false;
  };

  return {
    kind: common.kind,
    parserVersion: PARSER_VERSION,
    parseContext: { ...common.parseContext },
    participants,
    conversations,
    messages,
    masking: { counts: masker.totals() },
    stats,
    identityMatches,
    firstMessageAt: first === null ? null : new Date(first).toISOString(),
    lastMessageAt: last === null ? null : new Date(last).toISOString(),
    warnings: common.warnings.list(excludedCount > 0 ? isExcludedLine : undefined),
  };
}

export function buildDocumentSource(common: BuildCommon, blocks: readonly RawDocumentBlock[]): ParsedSource {
  if (blocks.length > LIMITS.maxMessagesPerSource) {
    throw new ParserAbort("too_large", `The document has more than ${LIMITS.maxMessagesPerSource} blocks.`);
  }
  // Rules were validated by the caller. Participant and date-range rules cannot match a document (no
  // senders, no timestamps); a conversation rule is still checked against this parse's context, so a
  // rule chosen elsewhere fails instead of being silently ignored (D32).
  conversationIdsFor(common.exclusions, common.parseContext);

  const masker = createMasker();
  const headingCache = new Map<string, string>();
  const messages: NormalizedMessage[] = blocks.map((b, seq) => {
    const location: NormalizedMessage["location"] = { lineStart: b.lineStart, lineEnd: b.lineEnd };
    if (b.page !== undefined) location.page = b.page;
    if (b.heading !== undefined) {
      let h = headingCache.get(b.heading);
      if (h === undefined) {
        h = masker.mask(b.heading, "document").text;
        headingCache.set(b.heading, h);
      }
      location.heading = h;
    }
    return {
      seq,
      conversationLocalId: null,
      participantLocalId: null,
      sentAt: null,
      kind: "document_block",
      body: masker.mask(b.body, "document").text,
      location,
    };
  });
  const stats = emptyStats(common.totalLines);
  stats.messagesKept = messages.length;
  return {
    kind: common.kind,
    parserVersion: PARSER_VERSION,
    parseContext: { ...common.parseContext },
    participants: [],
    conversations: [],
    messages,
    masking: { counts: masker.totals() },
    stats,
    identityMatches: [],
    firstMessageAt: null,
    lastMessageAt: null,
    warnings: common.warnings.list(),
  };
}
