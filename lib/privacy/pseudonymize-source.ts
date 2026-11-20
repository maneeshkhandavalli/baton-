/**
 * Applies participant pseudonymisation to a parser result before it is persisted (Round 3 Task 02, PRIV-1;
 * R4 mentioned-only names). Pure. Runs AFTER the parser (exclusions, excluded-mention redaction and masking
 * are already applied), so excluded people stay `[EXCLUDED_PARTICIPANT]` and are never registered as people.
 *
 * - Every participant's label becomes its handover-wide placeholder `[PERSON_n]`.
 * - Message bodies and document headings: mentions of every known person of the handover are replaced
 *   (pseudonymize.ts), then joined-honorific, nickname and transliteration forms of known names
 *   (name-detect.ts `createFuzzyKnownMatcher`).
 * - `discoverSourceNames` / `pseudonymizeMentionedNames` (R4): names of people who never sent a message
 *   (mentioned only, or in a document-only handover) are found locally (name-detect.ts) and replaced by the
 *   placeholders the parse stage reserved for them in the vault.
 * - Conversation previews are rebuilt from the pseudonymised messages (the parser's previews are cut from the
 *   unpseudonymised text and could end in half a name).
 */

import type { ParsedSource } from "../contracts/parser";
import { truncatePreview } from "../parsers/build-source";
import { chainTransforms, createFuzzyKnownMatcher, createNameReplacer, discoverNames, type DiscoveredName, type TextTransform } from "./name-detect";
import { createPseudonymizer, personToken, type KnownPerson } from "./pseudonymize";

export interface PseudonymizeSourceInput {
  /** participant localId → handover-wide ordinal. Must cover every participant. */
  ordinalOf: ReadonlyMap<string, number>;
  /** All known people of the handover (including this source's), with their masked labels. */
  people: readonly KnownPerson[];
}

export class PseudonymizationError extends Error {
  constructor() {
    super("a participant has no placeholder");
    this.name = "PseudonymizationError";
  }
}

/** Applies `transform` to every message body and heading; previews are rebuilt. */
function transformTexts(parsed: ParsedSource, transform: TextTransform): { parsed: ParsedSource; replaced: number } {
  let replaced = 0;
  const apply = (text: string): string => {
    if (transform.isEmpty || text === "") return text;
    const r = transform.apply(text);
    replaced += r.count;
    return r.text;
  };
  const headingCache = new Map<string, string>();
  const messages = parsed.messages.map((m) => {
    const location = m.location === null ? null : { ...m.location };
    if (location && location.heading !== undefined) {
      let h = headingCache.get(location.heading);
      if (h === undefined) {
        h = apply(location.heading);
        headingCache.set(location.heading, h);
      }
      location.heading = h;
    }
    return { ...m, body: apply(m.body), location };
  });

  const firstText = new Map<string, string>();
  for (const m of messages) {
    if (m.conversationLocalId === null || firstText.has(m.conversationLocalId)) continue;
    if (m.kind === "text" && m.body.trim() !== "") firstText.set(m.conversationLocalId, truncatePreview(m.body));
  }
  const conversations = parsed.conversations.map((c) => ({ ...c, preview: firstText.get(c.localId) ?? "" }));
  return { parsed: { ...parsed, messages, conversations }, replaced };
}

export function pseudonymizeParsedSource(parsed: ParsedSource, input: PseudonymizeSourceInput): { parsed: ParsedSource; replaced: number } {
  const participants = parsed.participants.map((p) => {
    const ordinal = input.ordinalOf.get(p.localId);
    if (ordinal === undefined) throw new PseudonymizationError();
    return { ...p, displayLabel: personToken(ordinal) };
  });
  const detector = createPseudonymizer(input.people);
  const known: TextTransform = { isEmpty: detector.isEmpty, apply: (t) => detector.apply(t) };
  const out = transformTexts({ ...parsed, participants }, chainTransforms(known, createFuzzyKnownMatcher(input.people)));
  return out;
}

/** Every text of a (pseudonymised) source that the name discovery reads: message bodies and headings. */
export function sourceTexts(parsed: ParsedSource): string[] {
  const texts: string[] = [];
  const headings = new Set<string>();
  for (const m of parsed.messages) {
    if (m.body !== "") texts.push(m.body);
    const h = m.location?.heading;
    if (h !== undefined && h !== "" && !headings.has(h)) {
      headings.add(h);
      texts.push(h);
    }
  }
  return texts;
}

/** Names in an already pseudonymised source that are not known people (name-detect.ts). */
export function discoverSourceNames(parsed: ParsedSource): DiscoveredName[] {
  return discoverNames(sourceTexts(parsed));
}

/** Replaces each discovered name with its token (a reserved `[PERSON_n]`, or `[PERSON]`). */
export function pseudonymizeMentionedNames(
  parsed: ParsedSource,
  names: ReadonlyArray<{ label: string; token: string; caseSensitive: boolean }>,
): { parsed: ParsedSource; replaced: number } {
  return transformTexts(parsed, createNameReplacer(names));
}
