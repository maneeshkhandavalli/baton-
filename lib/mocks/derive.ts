/**
 * Derivations that the real system does in SQL (status, access floor, readiness, publication
 * snapshots). The mock uses the canonical reference implementation from lib/contracts/status.ts
 * so mock statuses always agree with §4.2.
 */

import type {
  EvidenceItem,
  GapQuestionSummary,
  PointDetail,
  PointSummary,
  PublishedEvidenceItem,
  PublishedPointContent,
  ReadinessReport,
  SourceSummary,
} from "@/lib/contracts/dto";
import {
  ACCESS_LEVELS,
  EVIDENCE_STATUSES,
  REVIEW_STATES,
  type AccessLevel,
  type EvidenceStatus,
  type MemberRole,
  type ReviewState,
} from "@/lib/contracts/enums";
import type { PointAttributes } from "@/lib/contracts/schemas";
import { deriveEvidenceStatus, derivePotentiallyOutdated } from "@/lib/contracts/status";

import { isActiveIncomingInvite } from "./exclusions";
import type {
  MockGapQuestion,
  MockHandover,
  MockLink,
  MockMember,
  MockPoint,
  MockPublicationPoint,
  MockSource,
  MockStore,
} from "./types";

// ── Access (§8.1, §8.4) ──────────────────────────────────────────────────────

export const accessRank = (level: AccessLevel) => ACCESS_LEVELS.indexOf(level);

export const maxAccess = (...levels: AccessLevel[]): AccessLevel =>
  levels.reduce<AccessLevel>((acc, l) => (accessRank(l) > accessRank(acc) ? l : acc), "everyone");

export const canSee = (item: AccessLevel, clearance: AccessLevel) => accessRank(item) <= accessRank(clearance);

export const REVIEW_ROLES: readonly MemberRole[] = ["outgoing", "reviewer"];
export const isReviewRole = (role: MemberRole) => REVIEW_ROLES.includes(role);

/** Excluded links still count towards the floor (§8.4). */
export function pointAccessFloor(p: MockPoint): AccessLevel {
  return maxAccess(...p.links.map((l) => l.accessLevel));
}

export function pointAccessLevel(p: MockPoint): AccessLevel {
  return maxAccess(pointAccessFloor(p), p.accessOverride ?? "everyone");
}

/**
 * A gap question is at least as strict as its linked point's CURRENT level (§6.15, §8.4: kept by
 * triggers on insert and on point access change). The stored level is what was asked for; the
 * effective level re-derives the point's side every time, so a later `change_access` raises it.
 */
export function gapQuestionAccessLevel(store: MockStore, q: MockGapQuestion): AccessLevel {
  const point = q.pointId ? store.points.find((p) => p.id === q.pointId) : undefined;
  return point ? maxAccess(q.accessLevel, pointAccessLevel(point)) : q.accessLevel;
}

// ── Status (§4.2, §4.4) ─────────────────────────────────────────────────────

export function currentRevision(p: MockPoint) {
  return p.revisions[p.revisions.length - 1];
}

/** Simulated async re-verification after an edit (D16): verdicts move to the new revision. */
export function settleReverification(p: MockPoint, now = Date.now()) {
  if (p.reverifyAt === null || now < p.reverifyAt) return;
  const rev = currentRevision(p).id;
  for (const l of p.links) {
    if (!l.excluded && l.quoteCheck !== "not_found" && l.supportVerdict !== "irrelevant") {
      l.verifiedRevisionId = rev;
    }
  }
  p.reverifyAt = null;
}

export function pointStatus(p: MockPoint): EvidenceStatus {
  return deriveEvidenceStatus({
    currentRevisionId: currentRevision(p).id,
    inferenceRationale: p.inferenceRationale,
    links: p.links,
  });
}

const isVerifiedSupport = (l: MockLink, rev: string) =>
  !l.excluded &&
  (l.quoteCheck === "exact" || l.quoteCheck === "normalized") &&
  l.verifiedRevisionId === rev &&
  l.supportVerdict === "supports";

export function lastSupportedAt(p: MockPoint): string | null {
  const rev = currentRevision(p).id;
  const dates = p.links
    .filter((l) => isVerifiedSupport(l, rev) && l.sentAt)
    .map((l) => l.sentAt as string)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export function isOutdated(p: MockPoint, h: MockHandover): boolean {
  return derivePotentiallyOutdated({
    evidenceStatus: pointStatus(p),
    lastSupportedAt: lastSupportedAt(p),
    evidenceAsOf: h.evidenceAsOf,
  });
}

// ── DTO mapping (§11.6) ──────────────────────────────────────────────────────

export function profileLabel(store: MockStore, profileId: string): string {
  return store.profiles.find((p) => p.id === profileId)?.displayName ?? "Former member";
}

function sourceTitle(store: MockStore, sourceId: string | null) {
  if (!sourceId) return null;
  return store.sources.find((s) => s.id === sourceId)?.title ?? null;
}

export function toEvidenceItem(store: MockStore, p: MockPoint, l: MockLink): EvidenceItem {
  return {
    pointEvidenceId: l.pointEvidenceId,
    evidenceId: l.evidenceId,
    kind: l.kind,
    quote: l.quote,
    authorLabel: l.authorLabel,
    sentAt: l.sentAt,
    sourceTitle: sourceTitle(store, l.sourceId),
    location: l.location,
    quoteCheck: l.quoteCheck,
    supportVerdict: l.supportVerdict,
    verdictRationale: l.verdictRationale,
    // PI-11: only while the stored verdict is still the guard's `irrelevant` (a later reset clears it).
    guarded: l.guarded === true && l.supportVerdict === "irrelevant",
    modelVerdict: l.guarded === true && l.supportVerdict === "irrelevant" ? (l.modelVerdict ?? null) : null,
    isCurrentRevisionVerdict: l.verifiedRevisionId === currentRevision(p).id,
    excluded: l.excluded,
    exclusionReason: l.exclusionReason,
    accessLevel: l.accessLevel,
  };
}

const byNewest = (a: { sentAt: string | null }, b: { sentAt: string | null }) => {
  if (a.sentAt === b.sentAt) return 0;
  if (a.sentAt === null) return 1;
  if (b.sentAt === null) return -1;
  return a.sentAt < b.sentAt ? 1 : -1;
};

export function toPointSummary(store: MockStore, p: MockPoint, clearance: AccessLevel): PointSummary {
  const h = store.handovers.find((x) => x.id === p.handoverId)!;
  const rev = currentRevision(p);
  return {
    id: p.id,
    category: p.category,
    title: rev.title,
    statement: rev.statement,
    evidenceStatus: pointStatus(p),
    reviewState: p.reviewState,
    accessLevel: pointAccessLevel(p),
    isPotentiallyOutdated: isOutdated(p, h),
    origin: p.origin,
    evidenceCount: p.links.filter((l) => canSee(l.accessLevel, clearance)).length,
    privacyReview: p.privacyReview,
    lastSupportedAt: lastSupportedAt(p),
    updatedAt: p.updatedAt,
  };
}

export function toPointDetail(store: MockStore, p: MockPoint, clearance: AccessLevel): PointDetail {
  const rev = currentRevision(p);
  return {
    ...toPointSummary(store, p, clearance),
    currentRevisionId: rev.id,
    revisionNumber: rev.number,
    attributes: rev.attributes as PointAttributes,
    inferenceRationale: p.inferenceRationale,
    privacyReviewFlaggedAt: null,
    privacyReviewReason: null,
    privacySurfaces: null,
    privacyReviewDigest: null,
    inferredConfirmation: p.inferredConfirmation
      ? { by: profileLabel(store, p.inferredConfirmation.by), at: p.inferredConfirmation.at }
      : null,
    conflictResolution: p.conflictResolution
      ? { ...p.conflictResolution, by: profileLabel(store, p.conflictResolution.by) }
      : null,
    evidence: p.links
      .filter((l) => canSee(l.accessLevel, clearance))
      .map((l) => toEvidenceItem(store, p, l))
      .sort(byNewest),
    revisions: [...p.revisions].reverse(),
    reviewHistory: [...p.reviewHistory].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  };
}

export function toSourceSummary(s: MockSource): SourceSummary {
  return {
    id: s.id,
    handoverId: s.handoverId,
    kind: s.kind,
    title: s.title,
    state: s.state,
    accessLevel: s.accessLevel,
    sizeBytes: s.sizeBytes,
    consentRecordedAt: s.consentRecordedAt,
    rawDeletedAt: s.rawDeletedAt,
    firstMessageAt: s.firstMessageAt,
    lastMessageAt: s.lastMessageAt,
    messageCount: s.messageCount,
    maskingCounts: s.maskingCounts,
    errorCode: s.errorCode,
  };
}

export function toGapQuestionSummary(
  q: MockGapQuestion,
  viewer: { profileId: string; reviewRole: boolean },
): GapQuestionSummary {
  return {
    id: q.id,
    pointId: q.pointId,
    category: q.category,
    question: q.question,
    context: q.context,
    priority: q.priority,
    status: q.status,
    privacyHeld: false,
    answers: q.answers
      .filter((a) => viewer.reviewRole || a.answeredByProfileId === viewer.profileId)
      .map((a) => ({
        id: a.id,
        answererLabel: a.answererLabel,
        text: a.text,
        status: a.status,
        privacyHeld: a.privacyHeld,
        createdAt: a.createdAt,
      })),
  };
}

// ── Readiness (§11.6) ────────────────────────────────────────────────────────

export function computeReadiness(
  store: MockStore,
  handoverId: string,
  clearance: AccessLevel,
): ReadinessReport {
  const h = store.handovers.find((x) => x.id === handoverId)!;
  const points = store.points.filter(
    (p) => p.handoverId === handoverId && canSee(pointAccessLevel(p), clearance),
  );
  points.forEach((p) => settleReverification(p));

  const byStatus = Object.fromEntries(EVIDENCE_STATUSES.map((s) => [s, 0])) as Record<EvidenceStatus, number>;
  const byReviewState = Object.fromEntries(REVIEW_STATES.map((s) => [s, 0])) as Record<ReviewState, number>;
  let outdated = 0;
  for (const p of points) {
    byStatus[pointStatus(p)] += 1;
    byReviewState[p.reviewState] += 1;
    if (isOutdated(p, h)) outdated += 1;
  }

  const live = points.filter((p) => p.reviewState !== "rejected");
  const blockers: ReadinessReport["blockers"] = [];
  const add = (kind: ReadinessReport["blockers"][number]["kind"], ids: string[], count = ids.length) => {
    if (count > 0) blockers.push({ kind, count, pointIds: ids });
  };

  const sources = store.sources.filter((s) => s.handoverId === handoverId && !s.removedAt);
  const processingIncomplete = h.state === "processing" || h.state === "draft" || sources.some((s) => s.state !== "parsed" && s.state !== "failed");
  add("processing_incomplete", [], processingIncomplete ? 1 : 0);
  add("pending_points", live.filter((p) => p.reviewState === "pending").map((p) => p.id));
  add(
    "unconfirmed_inferred",
    live.filter((p) => pointStatus(p) === "inferred" && !p.inferredConfirmation).map((p) => p.id),
  );
  add(
    "unresolved_conflicts",
    live.filter((p) => pointStatus(p) === "conflicting" && !p.conflictResolution).map((p) => p.id),
  );
  const openRequired = store.gapQuestions.filter(
    (q) => q.handoverId === handoverId && q.status === "open" && q.priority === "required" && canSee(gapQuestionAccessLevel(store, q), clearance),
  );
  add("open_required_gaps", openRequired.map((q) => q.pointId).filter((x): x is string => !!x), openRequired.length);
  const hasIncoming =
    store.members.some((m) => m.handoverId === handoverId && m.role === "incoming" && !m.removedAt) ||
    store.tokens.some((t) => isActiveIncomingInvite(t, handoverId));
  add("no_incoming_recipient", [], hasIncoming ? 0 : 1);
  const approved = live.filter((p) => p.reviewState === "approved");
  add("no_approved_points", [], approved.length === 0 ? 1 : 0);
  add("privacy_review_required", live.filter((p) => p.privacyReview === "required").map((p) => p.id));

  const total = points.length;
  const decided = points.filter((p) => p.reviewState !== "pending").length;
  const score = total === 0 ? 0 : Math.round((decided / total) * 100);

  return {
    canPublish: blockers.length === 0,
    blockers,
    counts: { byStatus, byReviewState, outdated },
    score,
  };
}

// ── Publication snapshot (§6.18) ─────────────────────────────────────────────

export function snapshotPoint(
  store: MockStore,
  p: MockPoint,
  labelFor: (profileId: string) => string,
): MockPublicationPoint {
  const h = store.handovers.find((x) => x.id === p.handoverId)!;
  const rev = currentRevision(p);
  const status = pointStatus(p);
  const evidence: PublishedEvidenceItem[] = p.links
    .filter(
      (l) =>
        !l.excluded &&
        l.quoteCheck !== "not_found" &&
        (l.supportVerdict === "supports" || l.supportVerdict === "contradicts" || l.supportVerdict === "partial"),
    )
    .sort(byNewest)
    .map((l) => ({
      evidenceId: l.evidenceId,
      redacted: false as const,
      kind: l.kind,
      quote: l.quote,
      authorLabel: l.authorLabel,
      sentAt: l.sentAt,
      sourceTitle: sourceTitle(store, l.sourceId),
      stance: l.supportVerdict === "contradicts" ? ("contradicts" as const) : ("supports" as const),
      authorProfileId: null,
    }));

  const content: PublishedPointContent = {
    title: rev.title,
    statement: rev.statement,
    attributes: rev.attributes as PointAttributes,
    evidenceStatus: status,
    isPotentiallyOutdated: isOutdated(p, h),
    isKnownGap: p.approvedAsKnownGap,
    inferredConfirmation: p.inferredConfirmation
      ? { byLabel: labelFor(p.inferredConfirmation.by), byProfileId: p.inferredConfirmation.by, at: p.inferredConfirmation.at }
      : null,
    conflictResolution: p.conflictResolution
      ? {
          note: p.conflictResolution.note,
          byLabel: labelFor(p.conflictResolution.by),
          byProfileId: p.conflictResolution.by,
          at: p.conflictResolution.at,
        }
      : null,
    evidence,
    evidenceRedacted: false,
  };
  return { id: p.id, category: p.category, accessLevel: pointAccessLevel(p), sortKey: p.sortKey, content };
}

export function activeMember(store: MockStore, handoverId: string, profileId: string): MockMember | undefined {
  return store.members.find((m) => m.handoverId === handoverId && m.profileId === profileId && !m.removedAt);
}
