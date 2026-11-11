/**
 * Compact builders for seed fixtures. Attributes are validated against the canonical
 * category schemas at seed time, so a contract change breaks the mocks loudly.
 */

import type {
  AccessLevel,
  PointCategory,
  PointOrigin,
  QuoteCheck,
  ReviewActionType,
  ReviewState,
  SupportVerdict,
} from "@/lib/contracts/enums";
import { parsePointAttributes, type PointAttributes } from "@/lib/contracts/schemas";

import { NS, seedId } from "../ids";
import type { MockLink, MockPoint, MockSource } from "../types";

export interface SeedEvidence {
  quote: string;
  by: string | null;
  at: string | null;
  source: MockSource | null;
  line?: number;
  page?: number;
  heading?: string;
  verdict: SupportVerdict;
  check?: QuoteCheck;
  why?: string;
  /** Verdict was made against an earlier revision (stale, §4.2). */
  stale?: boolean;
  /** Exclusion reason, if a reviewer excluded this link. */
  excluded?: string;
  /** Testimony (gap answer or reviewer statement) rather than a source quote. */
  testimony?: boolean;
  /** Testimony access level (defaults to everyone). */
  access?: AccessLevel;
}

export interface SeedHistory {
  action: ReviewActionType;
  actor: string | null;
  note?: string;
  at: string;
}

export interface SeedPoint {
  n: number;
  category: PointCategory;
  title: string;
  statement: string;
  attributes: Record<string, unknown>;
  evidence: SeedEvidence[];
  rationale?: string;
  review?: ReviewState;
  confirmedBy?: { profileId: string; at: string };
  resolution?: { note: string; profileId: string; at: string };
  knownGap?: boolean;
  override?: AccessLevel;
  origin?: PointOrigin;
  updatedAt: string;
  history?: SeedHistory[];
  /** Earlier revisions, oldest first. The point's own title/statement is the current revision. */
  earlier?: Array<{ title: string; statement: string; by: string; at: string }>;
  /** Current revision's author and edit reason when `earlier` is set. */
  editedBy?: { label: string; reason: string };
}

export function attrs(category: PointCategory, raw: Record<string, unknown>): PointAttributes {
  const parsed = parsePointAttributes(category, raw);
  if (!parsed.success) {
    throw new Error(`Invalid seed attributes for ${category}: ${parsed.error.message}`);
  }
  return parsed.data.attributes;
}

export function buildPoint(handoverId: string, base: number, seed: SeedPoint): MockPoint {
  const n = base + seed.n;
  const attributes = attrs(seed.category, seed.attributes);
  const earlier = seed.earlier ?? [];
  const revisions = [
    ...earlier.map((r, i) => ({
      id: seedId(NS.revision, n * 10 + i),
      number: i + 1,
      title: r.title,
      statement: r.statement,
      attributes,
      editReason: null,
      authorLabel: i === 0 ? null : r.by,
      createdAt: r.at,
      redaction: null,
    })),
    {
      id: seedId(NS.revision, n * 10 + earlier.length),
      number: earlier.length + 1,
      title: seed.title,
      statement: seed.statement,
      attributes,
      editReason: seed.editedBy?.reason ?? null,
      authorLabel: seed.editedBy?.label ?? null,
      createdAt: seed.updatedAt,
      redaction: null,
    },
  ];
  const current = revisions[revisions.length - 1].id;
  const previous = revisions.length > 1 ? revisions[revisions.length - 2].id : null;

  const links: MockLink[] = seed.evidence.map((e, i) => ({
    pointEvidenceId: seedId(NS.pointEvidence, n * 20 + i),
    evidenceId: seedId(NS.evidence, n * 20 + i),
    kind: e.testimony ? "testimony" : "source_quote",
    quote: e.quote,
    authorLabel: e.by,
    sentAt: e.at,
    sourceId: e.source?.id ?? null,
    location:
      e.line !== undefined
        ? { lineStart: e.line, lineEnd: e.line + Math.max(0, e.quote.split("\n").length - 1), page: e.page, heading: e.heading }
        : null,
    quoteCheck: e.check ?? "exact",
    supportVerdict: e.verdict,
    verdictRationale: e.why ?? null,
    verifiedRevisionId: e.verdict === "unchecked" ? null : e.stale ? previous : current,
    excluded: !!e.excluded,
    exclusionReason: e.excluded ?? null,
    accessLevel: e.source?.accessLevel ?? e.access ?? "everyone",
  }));

  return {
    id: seedId(NS.point, n),
    handoverId,
    category: seed.category,
    origin: seed.origin ?? "extracted",
    revisions,
    links,
    inferenceRationale: seed.rationale ?? null,
    reviewState: seed.review ?? "pending",
    accessOverride: seed.override ?? null,
    inferredConfirmation: seed.confirmedBy ? { by: seed.confirmedBy.profileId, at: seed.confirmedBy.at } : null,
    conflictResolution: seed.resolution
      ? { note: seed.resolution.note, by: seed.resolution.profileId, at: seed.resolution.at }
      : null,
    approvedAsKnownGap: !!seed.knownGap,
    reviewHistory: (seed.history ?? []).map((h) => ({
      action: h.action,
      actorLabel: h.actor,
      note: h.note ?? null,
      createdAt: h.at,
    })),
    privacyReview: "none",
    sortKey: seed.n,
    updatedAt: seed.updatedAt,
    reverifyAt: null,
  };
}
