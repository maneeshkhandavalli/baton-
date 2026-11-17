/**
 * Finds how EXCLUDED people are written in free text, using only their identity hashes (Round 3 Task 02,
 * PRIV-3: exclusion parity for documents).
 *
 * An exclusion rule stores no name, only HMAC(pepper, normalized identity). Chat sources learn an excluded
 * person's name from the sender field; documents have no senders, so their names used to survive. Here
 * every run of one to four consecutive words in the text (separated by spaces, or by a single "-", "'" or
 * ".") is normalized exactly like a sender (NFKC, invisible characters removed, whitespace collapsed,
 * lower case) and hashed with the same pepper. A hash equal to an `apply` participant rule (kind "name",
 * pepper version p1) reveals the surface form, which then feeds the existing mention redactor
 * (excluded-mentions.ts), so the same variations are removed in every source type: the whole name in any
 * case or spacing, "@Name" mentions, and the strict check for labels.
 *
 * Limits: a name is found only when written exactly as the excluded identity (any case or spacing). A
 * first name alone, nickname, misspelling or another script is not found, and single-word names are then
 * removed only as @mentions (same rule as chats). Phone numbers are not discovered here: every phone number
 * in a document is masked anyway.
 */

import { IDENTITY_PEPPER_VERSION, computeIdentityHash } from "./identity";
import { identityKey, type CompiledExclusions } from "./exclusions";

export const MAX_NAME_WORDS = 4;

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const GAP = /^(?:[\s  ]+|[-'’.])$/;

/** The `apply` participant rules for NAME identities, as identity keys. */
function excludedNameKeys(exclusions: CompiledExclusions): Set<string> {
  const keys = new Set<string>();
  for (const [k, matchers] of exclusions.participants) {
    if (k.startsWith("name|") && matchers.some((m) => m.mode === "apply")) keys.add(k);
  }
  return keys;
}

export function hasExcludedNameRules(exclusions: CompiledExclusions): boolean {
  return excludedNameKeys(exclusions).size > 0;
}

/**
 * Surface forms of excluded people found in `texts` (deduplicated, in first-seen order). Pure; the pepper
 * is passed in. Cost: at most four hashes per word, each distinct candidate hashed once.
 */
export function discoverExcludedNames(texts: Iterable<string>, exclusions: CompiledExclusions, pepper: string): string[] {
  const keys = excludedNameKeys(exclusions);
  if (keys.size === 0) return [];
  const seen = new Map<string, boolean>();
  const found: string[] = [];
  const foundSet = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const words = Array.from(text.matchAll(WORD), (m) => ({ start: m.index!, end: m.index! + m[0].length }));
    for (let i = 0; i < words.length; i++) {
      if (!/\p{L}/u.test(text.slice(words[i].start, words[i].end))) continue;
      for (let n = 1; n <= MAX_NAME_WORDS && i + n <= words.length; n++) {
        const last = words[i + n - 1];
        if (n > 1 && !GAP.test(text.slice(words[i + n - 2].end, last.start))) break;
        const surface = text.slice(words[i].start, last.end);
        const norm = surface.normalize("NFKC").toLowerCase();
        let hit = seen.get(norm);
        if (hit === undefined) {
          hit = keys.has(identityKey("name", computeIdentityHash(surface, pepper), IDENTITY_PEPPER_VERSION));
          seen.set(norm, hit);
        }
        if (hit && !foundSet.has(norm)) {
          foundSet.add(norm);
          found.push(surface);
        }
      }
    }
  }
  return found;
}
