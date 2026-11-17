/**
 * Applies participant pseudonymisation to a parser result before it is persisted (Round 3 Task 02, PRIV-1).
 * Pure. Runs AFTER the parser (exclusions, excluded-mention redaction and masking are already applied), so
 * excluded people stay `[EXCLUDED_PARTICIPANT]` and are never registered as people.
 *
 * - Every participant's label becomes its handover-wide placeholder `[PERSON_n]`.
 * - Message bodies and document headings: mentions of every known person of the handover are replaced
 *   (pseudonymize.ts).
 * - Conversation previews are rebuilt from the pseudonymised messages (the parser's previews are cut from the
 *   unpseudonymised text and could end in half a name).
 */

import type { ParsedSource } from "../contracts/parser";
import { truncatePreview } from "../parsers/build-source";
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

export function pseudonymizeParsedSource(parsed: ParsedSource, input: PseudonymizeSourceInput): { parsed: ParsedSource; replaced: number } {
  const detector = createPseudonymizer(input.people);
  let replaced = 0;
  const apply = (text: string): string => {
    if (detector.isEmpty || text === "") return text;
    const r = detector.apply(text);
    replaced += r.count;
    return r.text;
  };

  const participants = parsed.participants.map((p) => {
    const ordinal = input.ordinalOf.get(p.localId);
    if (ordinal === undefined) throw new PseudonymizationError();
    return { ...p, displayLabel: personToken(ordinal) };
  });

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

  return { parsed: { ...parsed, participants, messages, conversations }, replaced };
}
