/**
 * Exclusion rules (§10.3, §11.4, §12.2). Applied in memory, before masking, so excluded content never
 * reaches masking, the output, or the AI.
 *
 * - `participant`: matches only when identity kind, hash AND pepper version all agree (§12.11 point 6).
 *   `apply` drops the participant; `detect` drops nothing and is reported as an `IdentityMatch`.
 * - `conversation`: matched by `conversationLocalId`, and only if `rule.context` equals the parse's
 *   own `ParseContext` (timezone, effective date order, parser version). Otherwise the whole call fails
 *   with `exclusion_context_mismatch`; a stale positional `c_N` is never applied silently (D32).
 * - `date_range`: inclusive on both ends (`rangeStart <= sentAt <= rangeEnd`); an open end is allowed
 *   if the other is present. Messages without a timestamp are never matched by a range.
 *
 * Malformed rules fail with `exclusion_invalid` (never skipped: ignoring an exclusion would leak
 * content). Failures name the input path ("exclusions[2]") and the rule's `ruleId`, never a value.
 */

import { DATE_ORDERS, EXCLUSION_RULE_MODES, IDENTITY_KINDS, IDENTITY_PEPPER_VERSIONS } from "../contracts/enums";
import type { IdentityKind, IdentityPepperVersion } from "../contracts/enums";
import { IDENTITY_HASH_PATTERN } from "../contracts/identity";
import type { ExclusionRule, ParseContext } from "../contracts/parser";
import { ParserInputError } from "../parsers/errors";

/** A participant rule, compiled. */
export interface ParticipantMatcher {
  /** Index in the input rule list (for deterministic ordering). */
  index: number;
  ruleId: string | null;
  mode: "apply" | "detect";
}

export interface CompiledExclusions {
  /** `identityKey(kind, hash, version)` → the participant rules for that identity. */
  participants: Map<string, ParticipantMatcher[]>;
  /** Number of participant rules with `mode: "apply"`. */
  applyCount: number;
  conversations: Array<{ index: number; ruleId: string | undefined; localId: string; context: ParseContext }>;
  ranges: Array<{ start: number; end: number }>;
  isEmpty: boolean;
}

/** Map key for an identity: all three parts must agree for a match. Hash in lower case. */
export function identityKey(kind: IdentityKind, hash: string, version: IdentityPepperVersion): string {
  return `${kind}|${version}|${hash.toLowerCase()}`;
}

const isIn = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

function parseInstant(value: unknown, field: string, ruleId: string | undefined): number {
  // Require an explicit offset or Z, so a range is never interpreted in server-local time.
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw new ParserInputError("exclusion_invalid", field, `${field} must be an ISO 8601 timestamp with an offset`, ruleId);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new ParserInputError("exclusion_invalid", field, `${field} is not a valid timestamp`, ruleId);
  return ms;
}

function validContext(context: unknown): context is ParseContext {
  if (!context || typeof context !== "object") return false;
  const c = context as Record<string, unknown>;
  return (
    typeof c.timezone === "string" &&
    c.timezone !== "" &&
    (c.dateOrder === null || isIn(DATE_ORDERS, c.dateOrder)) &&
    typeof c.parserVersion === "string" &&
    c.parserVersion !== ""
  );
}

/** Validates and compiles the rule list. Throws `ParserInputError` (`input_invalid` / `exclusion_invalid`). */
export function compileExclusions(rules: unknown): CompiledExclusions {
  if (!Array.isArray(rules)) {
    throw new ParserInputError("input_invalid", "exclusions", "exclusions must be an array");
  }
  const compiled: CompiledExclusions = {
    participants: new Map(),
    applyCount: 0,
    conversations: [],
    ranges: [],
    isEmpty: true,
  };
  (rules as unknown[]).forEach((value, index) => {
    const at = `exclusions[${index}]`;
    if (!value || typeof value !== "object") {
      throw new ParserInputError("exclusion_invalid", at, `${at} must be an object`);
    }
    const rule = value as ExclusionRule & Record<string, unknown>;
    if (rule.ruleId !== undefined && typeof rule.ruleId !== "string") {
      throw new ParserInputError("exclusion_invalid", `${at}.ruleId`, `${at}.ruleId must be a string`);
    }
    const ruleId = rule.ruleId;
    const invalid = (field: string, why: string) =>
      new ParserInputError("exclusion_invalid", `${at}.${field}`, `${at}.${field} ${why}`, ruleId);

    if (rule.kind === "participant") {
      if (!isIn(IDENTITY_KINDS, rule.identityKind)) throw invalid("identityKind", "must be phone or name");
      const h = rule.participantIdentityHash;
      if (typeof h !== "string" || !IDENTITY_HASH_PATTERN.test(h.toLowerCase())) {
        throw invalid("participantIdentityHash", "must be a 64-character hex HMAC-SHA256");
      }
      if (!isIn(IDENTITY_PEPPER_VERSIONS, rule.identityPepperVersion)) {
        throw invalid("identityPepperVersion", "is not a supported pepper version");
      }
      if (!isIn(EXCLUSION_RULE_MODES, rule.mode)) throw invalid("mode", "must be apply or detect");
      const key = identityKey(rule.identityKind, h, rule.identityPepperVersion);
      const list = compiled.participants.get(key) ?? [];
      list.push({ index, ruleId: ruleId ?? null, mode: rule.mode });
      compiled.participants.set(key, list);
      if (rule.mode === "apply") compiled.applyCount++;
    } else if (rule.kind === "conversation") {
      const id = rule.conversationLocalId;
      if (typeof id !== "string" || !/^c_[1-9]\d*$/.test(id)) {
        throw invalid("conversationLocalId", 'must look like "c_1"');
      }
      if (!validContext(rule.context)) throw invalid("context", "must be a complete ParseContext");
      const { timezone, dateOrder, parserVersion } = rule.context;
      compiled.conversations.push({ index, ruleId, localId: id, context: { timezone, dateOrder, parserVersion } });
    } else if (rule.kind === "date_range") {
      if (rule.rangeStart === undefined && rule.rangeEnd === undefined) {
        throw new ParserInputError("exclusion_invalid", at, `${at} needs rangeStart, rangeEnd or both`, ruleId);
      }
      const start = rule.rangeStart === undefined ? -Infinity : parseInstant(rule.rangeStart, `${at}.rangeStart`, ruleId);
      const end = rule.rangeEnd === undefined ? Infinity : parseInstant(rule.rangeEnd, `${at}.rangeEnd`, ruleId);
      if (start > end) throw new ParserInputError("exclusion_invalid", at, `${at}.rangeStart is after rangeEnd`, ruleId);
      compiled.ranges.push({ start, end });
    } else {
      throw invalid("kind", "is not a valid exclusion kind");
    }
    compiled.isEmpty = false;
  });
  return compiled;
}

export function sameParseContext(a: ParseContext, b: ParseContext): boolean {
  return a.timezone === b.timezone && a.dateOrder === b.dateOrder && a.parserVersion === b.parserVersion;
}

/**
 * Checks every conversation rule against the parse's own context and returns the conversation ids
 * to drop. Throws `exclusion_context_mismatch` for the first rule chosen under another context.
 */
export function conversationIdsFor(compiled: CompiledExclusions, context: ParseContext): Set<string> {
  const ids = new Set<string>();
  for (const rule of compiled.conversations) {
    if (!sameParseContext(rule.context, context)) {
      throw new ParserInputError(
        "exclusion_context_mismatch",
        `exclusions[${rule.index}]`,
        `exclusions[${rule.index}] was chosen with a different timezone, date order or parser version`,
        rule.ruleId,
      );
    }
    ids.add(rule.localId);
  }
  return ids;
}

/** The participant rules matching an identity (kind, hash and version must all agree). */
export function participantRulesFor(
  compiled: CompiledExclusions,
  kind: IdentityKind,
  hash: string,
  version: IdentityPepperVersion,
): readonly ParticipantMatcher[] {
  return compiled.participants.get(identityKey(kind, hash, version)) ?? [];
}

export function inExcludedRange(compiled: CompiledExclusions, sentAtMs: number | null): boolean {
  if (sentAtMs === null) return false;
  return compiled.ranges.some((r) => sentAtMs >= r.start && sentAtMs <= r.end);
}
