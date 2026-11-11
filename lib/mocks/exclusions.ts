/**
 * Exclusion rules, identity matches and token listings for the mock (§6.4, §6.8, §6.8.1, §10.3).
 *
 * `rulesForSource` is the mock's stand-in for main's rule builder (M2 in the reconciliation log):
 * which `ExclusionRule[]` a source's preview and final parse receive, and in which `mode`.
 */

import type { AccessTokenSummary, ExclusionSummary, SourceParticipantSummary } from "@/lib/contracts/dto";
import type { AccessTokenStatus } from "@/lib/contracts/enums";
import type { ExclusionRule, ParserResult, SourcePreview } from "@/lib/contracts/parser";

import { mockPreview } from "./fixtures/preview";
import { applyExclusionRules } from "./preview-rules";
import type { MockExclusion, MockParticipant, MockSource, MockStore, MockToken } from "./types";

/**
 * §6.8 / §6.8.1:
 * - Source-scoped rules: always applied to their source.
 * - Handover-wide `phone` rules: applied to every source (strong identity).
 * - Handover-wide `name` rules: applied to a source ONLY where the creator recorded `same_person`
 *   for that source; not passed where they recorded `different_person`; otherwise passed as
 *   `detect`, which drops nothing. No source is exempt, including the one the rule was chosen in:
 *   to leave a name out of that source, the creator records a source-scoped rule there too.
 */
export function rulesForSource(store: MockStore, source: MockSource): ExclusionRule[] {
  const rules: ExclusionRule[] = [];
  for (const e of store.exclusions) {
    if (e.handoverId !== source.handoverId) continue;
    if (e.sourceId !== null && e.sourceId !== source.id) continue;
    if (e.kind === "participant" && e.identityKind && e.identityHash && e.identityPepperVersion) {
      let mode: "apply" | "detect" = "apply";
      if (e.sourceId === null && e.identityKind === "name") {
        const decision = store.identityConfirmations.find((c) => c.sourceId === source.id && c.exclusionId === e.id)?.decision;
        if (decision === "different_person") continue;
        mode = decision === "same_person" ? "apply" : "detect";
      }
      rules.push({ kind: "participant", ruleId: e.id, identityKind: e.identityKind, participantIdentityHash: e.identityHash, identityPepperVersion: e.identityPepperVersion, mode });
    } else if (e.kind === "conversation" && e.conversationLocalId && e.parseContext) {
      rules.push({ kind: "conversation", ruleId: e.id, conversationLocalId: e.conversationLocalId, context: e.parseContext });
    } else if (e.kind === "date_range") {
      rules.push({ kind: "date_range", ruleId: e.id, rangeStart: e.rangeStart ?? undefined, rangeEnd: e.rangeEnd ?? undefined });
    }
  }
  return rules;
}

/** The preview the user may see now: the rule-free parse with the current rules applied (D33). */
export function previewFor(store: MockStore, source: MockSource): ParserResult<SourcePreview> {
  source.basePreview ??= mockPreview(source.kind, source.title, source.sizeBytes, source.timezone);
  return applyExclusionRules(source.basePreview, rulesForSource(store, source));
}

export function toExclusionSummary(e: MockExclusion): ExclusionSummary {
  return {
    id: e.id,
    kind: e.kind,
    scope: e.sourceId === null ? "handover" : "source",
    sourceId: e.sourceId,
    identityKind: e.identityKind,
    conversationLocalId: e.conversationLocalId,
    rangeStart: e.rangeStart,
    rangeEnd: e.rangeEnd,
    reason: e.reason,
    requestedVia: e.requestedVia,
    createdAt: e.createdAt,
  };
}

export function toParticipantSummary(store: MockStore, p: MockParticipant): SourceParticipantSummary {
  const excluded = store.exclusions.some(
    (e) =>
      e.handoverId === p.handoverId &&
      e.kind === "participant" &&
      (e.sourceId === null || e.sourceId === p.sourceId) &&
      e.identityKind === p.identityKind &&
      e.identityHash === p.identityHash &&
      e.identityPepperVersion === p.identityPepperVersion,
  );
  return {
    id: p.id,
    sourceId: p.sourceId,
    sourceTitle: store.sources.find((s) => s.id === p.sourceId)?.title ?? "Removed source",
    localId: p.localId,
    displayLabel: p.displayLabel,
    identityKind: p.identityKind,
    messageCount: p.messageCount,
    excluded,
  };
}

/** Derived for listings only; precedence revoked → expired → exhausted (§11.6). */
export function tokenStatus(t: MockToken, now = Date.now()): AccessTokenStatus {
  if (t.revokedAt) return "revoked";
  if (Date.parse(t.expiresAt) <= now) return "expired";
  if (t.useCount >= t.maxUses) return "exhausted";
  return "active";
}

export function toAccessTokenSummary(t: MockToken, viewerIsCreator: boolean): AccessTokenSummary {
  return {
    id: t.id,
    purpose: t.purpose,
    status: tokenStatus(t),
    grantRole: t.purpose === "member_invite" ? t.grantRole : null,
    recipientEmail: t.purpose === "member_invite" && viewerIsCreator ? t.recipientEmail : null,
    maxAccessLevel: t.maxAccessLevel,
    expiresAt: t.expiresAt,
    maxUses: t.maxUses,
    useCount: t.useCount,
    revokedAt: t.revokedAt,
    createdAt: t.createdAt,
  };
}

/** A pending incoming invitation still counts as a recipient for readiness (§11.6). */
export const isActiveIncomingInvite = (t: MockToken, handoverId: string) =>
  t.handoverId === handoverId && t.purpose === "member_invite" && t.grantRole === "incoming" && tokenStatus(t) === "active";
