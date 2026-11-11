/**
 * Mock stand-in for how the parser applies `ExclusionRule[]` (§11.4, D31–D33). Pure: a rule-free
 * preview plus rules in, the preview the user is allowed to see out.
 *
 * - `participant` + `apply`: the person disappears (labels, conversation membership, counts), and
 *   mentions of them in kept text become `[EXCLUDED_PARTICIPANT]`.
 * - `participant` + `detect`: nothing is dropped; an `IdentityMatch` is reported for a human decision.
 * - `conversation`: dropped, but only if the rule was chosen in the same `ParseContext`; otherwise
 *   the whole call fails with `exclusion_context_mismatch` (D32).
 * - `date_range`: conversations entirely inside the range are dropped.
 */

import { sameIdentity } from "@/lib/contracts/identity";
import {
  EXCLUDED_PARTICIPANT_TOKEN,
  PARSER_INPUT_ERROR_APP_CODES,
  type ExclusionRule,
  type ParseContext,
  type ParserResult,
  type SourcePreview,
} from "@/lib/contracts/parser";

const sameContext = (a: ParseContext, b: ParseContext) => a.timezone === b.timezone && a.dateOrder === b.dateOrder && a.parserVersion === b.parserVersion;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function applyExclusionRules(base: SourcePreview, rules: readonly ExclusionRule[]): ParserResult<SourcePreview> {
  // Validate every conversation rule first: a mismatch fails the whole preview, as the parser does.
  for (const [i, rule] of rules.entries()) {
    if (rule.kind === "conversation" && !sameContext(rule.context, base.parseContext)) {
      return {
        ok: false,
        error: {
          code: PARSER_INPUT_ERROR_APP_CODES.exclusion_context_mismatch,
          message: "A conversation exclusion was chosen on a different preview. Confirm it again.",
          retryable: false,
          details: { inputCode: "exclusion_context_mismatch", field: `exclusions[${i}]`, ...(rule.ruleId ? { ruleId: rule.ruleId } : {}) },
        },
      };
    }
  }

  const participantRules = rules.filter((r) => r.kind === "participant");
  const applied = new Set<string>();
  const identityMatches: SourcePreview["identityMatches"] = [];
  for (const p of base.participants) {
    const matching = participantRules.filter((r) =>
      sameIdentity(p, { identityKind: r.identityKind, identityHash: r.participantIdentityHash, identityPepperVersion: r.identityPepperVersion }),
    );
    if (matching.some((r) => r.mode === "apply")) applied.add(p.localId);
    else for (const r of matching) identityMatches.push({ ruleId: r.ruleId ?? null, participantLocalId: p.localId, identityKind: p.identityKind });
  }

  const excludedConversations = new Set(rules.flatMap((r) => (r.kind === "conversation" ? [r.conversationLocalId] : [])));
  const ranges = rules.flatMap((r) => (r.kind === "date_range" ? [r] : []));
  const insideRange = (startedAt: string | null, endedAt: string | null) =>
    !!startedAt &&
    !!endedAt &&
    ranges.some(
      (r) =>
        (!r.rangeStart || Date.parse(startedAt) >= Date.parse(r.rangeStart)) && (!r.rangeEnd || Date.parse(endedAt) <= Date.parse(r.rangeEnd)),
    );

  const removedPeople = base.participants.filter((p) => applied.has(p.localId));
  let mentionsRedacted = 0;
  let dropped = 0;

  const conversations = base.conversations.flatMap((c) => {
    if (excludedConversations.has(c.localId) || insideRange(c.startedAt, c.endedAt)) {
      dropped += c.messageCount;
      return [];
    }
    const gone = removedPeople.filter((p) => c.participantLocalIds.includes(p.localId));
    const lost = gone.reduce((n, p) => n + Math.round(p.messageCount / Math.max(1, base.conversations.filter((x) => x.participantLocalIds.includes(p.localId)).length)), 0);
    let preview = c.preview;
    for (const p of removedPeople) {
      const re = new RegExp(`\\b${escapeRegExp(p.displayLabel)}\\b`, "g");
      const replaced = preview.replace(re, EXCLUDED_PARTICIPANT_TOKEN);
      if (replaced !== preview) mentionsRedacted += 1;
      preview = replaced;
    }
    dropped += Math.min(lost, c.messageCount);
    const messageCount = Math.max(0, c.messageCount - lost);
    if (messageCount === 0) return []; // conversations with no retained message are omitted
    return [{ ...c, messageCount, preview, participantLocalIds: c.participantLocalIds.filter((id) => !applied.has(id)) }];
  });

  const warnings = [...base.warnings];
  if (mentionsRedacted > 0) {
    warnings.push({ code: "excluded_mentions_redacted", message: "Mentions of people who were left out were removed from kept messages." });
  }

  return {
    ok: true,
    data: {
      ...base,
      participants: base.participants.filter((p) => !applied.has(p.localId)),
      conversations,
      identityMatches,
      stats: {
        ...base.stats,
        messagesKept: Math.max(0, base.stats.messagesKept - dropped),
        messagesExcluded: base.stats.messagesExcluded + dropped,
      },
      warnings,
    },
  };
}
