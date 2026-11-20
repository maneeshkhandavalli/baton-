/**
 * Review flags (R3 Task 03, VER-2 and VER-3). Pure: builds the flags the `analyze` job stores.
 *
 * - possible_contradiction: a LATER message that shares people, dates, amounts or topic words with a point
 *   and may change it (lib/signals/contradictions.ts). Only pending, unredacted points with citations.
 * - attribution_inferred / attribution_unresolved: a person field the MODEL wrote that is not backed by the
 *   cited evidence (lib/signals/attribution.ts). Only extracted points whose wording is still the
 *   extractor's (a reviewer's edit is a human attribution and is not second-guessed).
 *
 * Flags never change a point's status, evidence or verdicts: they are pointers for a reviewer.
 */

import type { NewPointFlag, PipelinePoint } from "../db/pipeline";
import { checkAttribution } from "../signals/attribution";
import { findContradictionCandidates, type RetrievalMessage } from "../signals/contradictions";

export function buildReviewFlags(points: readonly PipelinePoint[], messages: readonly RetrievalMessage[]): NewPointFlag[] {
  const live = points.filter((p) => p.reviewState === "pending" && !p.redacted && p.statement !== null && p.privacyReview !== "required");
  const byId = new Map(messages.map((m) => [m.id, m]));
  const participants = new Set(messages.map((m) => m.authorLabel).filter((a): a is string => !!a));
  const flags: NewPointFlag[] = [];

  const candidates = findContradictionCandidates(
    live.map((p) => ({ pointId: p.pointId, category: p.category, title: p.title, statement: p.statement, attributes: p.attributes, citedMessageIds: p.citedMessageIds ?? [] })),
    messages,
  );
  const revision = new Map(live.map((p) => [p.pointId, p.currentRevisionId]));
  for (const c of candidates) {
    flags.push({
      pointId: c.pointId,
      revisionId: revision.get(c.pointId) as string,
      kind: "possible_contradiction",
      messageId: c.messageId,
      detail: { reasons: c.reasons, score: c.score },
      dedupeKey: c.messageId,
    });
  }

  for (const p of live) {
    if (p.origin !== "extracted") continue;
    if (p.originalStatement !== undefined && p.originalStatement !== null && p.originalStatement !== p.statement) continue; // human-edited
    const cited = (p.citedMessageIds ?? []).map((id) => byId.get(id)).filter((m): m is RetrievalMessage => m !== undefined);
    for (const check of checkAttribution({ category: p.category, attributes: p.attributes, cited, participants })) {
      if (check.resolution === "verified") continue;
      flags.push({
        pointId: p.pointId,
        revisionId: p.currentRevisionId,
        kind: check.resolution === "inferred" ? "attribution_inferred" : "attribution_unresolved",
        messageId: null,
        detail: { field: check.field, status: check.status },
        dedupeKey: check.field,
      });
    }
  }
  return flags;
}
