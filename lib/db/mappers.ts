/**
 * Row → DTO mapping (§2 "DTO casing", §11.6). The read API (supabase/migrations/…_read_api.sql) returns
 * snake_case JSON; these functions validate it against the canonical enums and produce exactly the DTO
 * shapes in lib/contracts/dto.ts. Anything unexpected is rejected (internal error) rather than passed on,
 * so raw database rows never reach UI code.
 */

import { z } from "zod";

import type {
  AccessTokenSummary,
  CreatorTransferOffer,
  ExclusionSummary,
  GapInterview,
  GapQuestionSummary,
  HandoverSummary,
  MemberSummary,
  PointDetail,
  PointSummary,
  PrivacySurface,
  ProcessingStatus,
  PublishedHandover,
  PublishedPointContent,
  ReadinessReport,
  SourceMessageContext,
  SourceParticipantSummary,
  SourceSummary,
} from "../contracts/dto";
import { READINESS_BLOCKERS } from "../contracts/dto";
import {
  ACCESS_LEVELS,
  ACCESS_TOKEN_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_STATUSES,
  EXCLUSION_KINDS,
  EXCLUSION_REQUESTED_VIA,
  EXCLUSION_SCOPES,
  GAP_ANSWER_STATUSES,
  GAP_PRIORITIES,
  GAP_QUESTION_STATUSES,
  HANDOVER_STATES,
  IDENTITY_KINDS,
  MASK_KINDS,
  MEMBER_ROLES,
  MESSAGE_KINDS,
  PIPELINE_STAGES,
  POINT_CATEGORIES,
  POINT_ORIGINS,
  PRIVACY_HOLD_REASONS,
  PRIVACY_REVIEW_STATES,
  PRIVACY_SURFACE_KINDS,
  QUOTE_CHECKS,
  REDACTION_KINDS,
  REVIEW_ACTION_TYPES,
  REVIEW_STATES,
  RUN_STATUSES,
  SOURCE_KINDS,
  SOURCE_STATES,
  SUPPORT_VERDICTS,
  TOKEN_PURPOSES,
} from "../contracts/enums";
import type { PointAttributes } from "../contracts/schemas";
import { parsePointAttributes } from "../contracts/schemas";
import { DbError } from "./errors";

// ── Primitives ───────────────────────────────────────────────────────────────

/** Postgres timestamptz JSON ("2026-11-11T10:00:00.123456+00:00") → ISO-8601 UTC. */
const timestamp = z.string().transform((v, ctx) => {
  const t = Date.parse(v);
  if (Number.isNaN(t)) {
    ctx.addIssue({ code: "custom", message: "invalid timestamp" });
    return z.NEVER;
  }
  return new Date(t).toISOString();
});
const nullableTimestamp = timestamp.nullable();
const id = z.string().uuid();
const text = z.string();
const nullableText = z.string().nullable();
const count = z.coerce.number().int().nonnegative();

const location = z
  .object({
    page: z.number().optional(),
    heading: z.string().optional(),
    lineStart: z.number(),
    lineEnd: z.number(),
  })
  .nullable();

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DbError("internal"); // never forward the row or the Zod issue text
  }
  return result.data;
}

function attributesFor(category: (typeof POINT_CATEGORIES)[number], raw: unknown): PointAttributes {
  const result = parsePointAttributes(category, raw);
  if (!result.success) throw new DbError("internal");
  return result.data.attributes;
}

// ── Handovers and members ────────────────────────────────────────────────────

const handoverRow = z.object({
  id,
  title: text,
  team_name: text,
  role_title: nullableText,
  // R3 (migration 20261113100400): absent from older rows/fixtures → null
  description: nullableText.optional(),
  state: z.enum(HANDOVER_STATES),
  viewer_role: z.enum(MEMBER_ROLES),
  viewer_is_creator: z.boolean(),
  viewer_clearance: z.enum(ACCESS_LEVELS),
  current_publication_id: id.nullable(),
  // R8: only the creator and the offered member receive it; absent or null otherwise
  pending_creator_transfer: z.object({ to_member_id: id, offered_at: timestamp }).nullable().optional(),
  created_at: timestamp,
  updated_at: timestamp,
});

export function mapHandoverSummary(raw: unknown): HandoverSummary {
  const r = parse(handoverRow, raw);
  return {
    id: r.id,
    title: r.title,
    teamName: r.team_name,
    roleTitle: r.role_title,
    description: r.description ?? null,
    state: r.state,
    viewerRole: r.viewer_role,
    viewerIsCreator: r.viewer_is_creator,
    viewerClearance: r.viewer_clearance,
    currentPublicationId: r.current_publication_id,
    pendingCreatorTransfer: r.pending_creator_transfer
      ? { toMemberId: r.pending_creator_transfer.to_member_id, offeredAt: r.pending_creator_transfer.offered_at }
      : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const memberRow = z.object({
  id,
  display_name: text,
  role: z.enum(MEMBER_ROLES),
  clearance: z.enum(ACCESS_LEVELS).nullable(),
  ack_required: z.boolean(),
  is_creator: z.boolean(),
  is_viewer: z.boolean(),
});

export function mapMemberSummary(raw: unknown): MemberSummary {
  const r = parse(memberRow, raw);
  return {
    id: r.id,
    displayName: r.display_name,
    role: r.role,
    clearance: r.clearance,
    ackRequired: r.ack_required,
    isCreator: r.is_creator,
    isViewer: r.is_viewer,
  };
}

/** R8: exactly one row may be the viewer's own (MemberSummary.isViewer). */
export function mapMemberList(raw: unknown[]): MemberSummary[] {
  const members = raw.map(mapMemberSummary);
  if (members.filter((m) => m.isViewer).length > 1) throw new DbError("internal");
  return members;
}

const creatorOfferRow = z.object({
  handover_id: id,
  handover_title: text,
  offered_by_label: text,
  offered_at: timestamp,
});

export function mapCreatorTransferOffer(raw: unknown): CreatorTransferOffer {
  const r = parse(creatorOfferRow, raw);
  return { handoverId: r.handover_id, handoverTitle: r.handover_title, offeredByLabel: r.offered_by_label, offeredAt: r.offered_at };
}

// ── Access tokens (§12.4, AccessTokenSummary) ────────────────────────────────

const accessTokenRow = z.strictObject({
  id,
  purpose: z.enum(TOKEN_PURPOSES),
  status: z.enum(ACCESS_TOKEN_STATUSES),
  grant_role: z.enum(MEMBER_ROLES).nullable(),
  recipient_email: nullableText,
  max_access_level: z.enum(ACCESS_LEVELS),
  expires_at: timestamp,
  max_uses: count,
  use_count: count,
  revoked_at: nullableTimestamp,
  created_at: timestamp,
});

export function mapAccessTokenSummary(raw: unknown): AccessTokenSummary {
  const r = parse(accessTokenRow, raw);
  return {
    id: r.id,
    purpose: r.purpose,
    status: r.status,
    grantRole: r.purpose === "member_invite" ? r.grant_role : null,
    recipientEmail: r.purpose === "member_invite" ? r.recipient_email : null,
    maxAccessLevel: r.max_access_level,
    expiresAt: r.expires_at,
    maxUses: r.max_uses,
    useCount: r.use_count,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
  };
}

// ── Participants, exclusions and message context (R8) ────────────────────────

// strictObject: an identity hash (or any other unexpected column) is rejected, never passed on.
const participantRow = z.strictObject({
  id,
  source_id: id,
  source_title: text,
  local_id: text,
  display_label: text,
  identity_kind: z.enum(IDENTITY_KINDS),
  message_count: count,
  excluded: z.boolean(),
});

export function mapSourceParticipant(raw: unknown): SourceParticipantSummary {
  const r = parse(participantRow, raw);
  return {
    id: r.id,
    sourceId: r.source_id,
    sourceTitle: r.source_title,
    localId: r.local_id,
    displayLabel: r.display_label,
    identityKind: r.identity_kind,
    messageCount: r.message_count,
    excluded: r.excluded,
  };
}

const exclusionRow = z.strictObject({
  id,
  kind: z.enum(EXCLUSION_KINDS),
  scope: z.enum(EXCLUSION_SCOPES),
  source_id: id.nullable(),
  identity_kind: z.enum(IDENTITY_KINDS).nullable(),
  conversation_local_id: nullableText,
  range_start: nullableTimestamp,
  range_end: nullableTimestamp,
  reason: nullableText,
  requested_via: z.enum(EXCLUSION_REQUESTED_VIA),
  created_at: timestamp,
});

export function mapExclusionSummary(raw: unknown): ExclusionSummary {
  const r = parse(exclusionRow, raw);
  if ((r.scope === "handover") !== (r.source_id === null)) throw new DbError("internal");
  return {
    id: r.id,
    kind: r.kind,
    scope: r.scope,
    sourceId: r.source_id,
    identityKind: r.identity_kind,
    conversationLocalId: r.conversation_local_id,
    rangeStart: r.range_start,
    rangeEnd: r.range_end,
    reason: r.reason,
    requestedVia: r.requested_via,
    createdAt: r.created_at,
  };
}

const contextMessage = z.object({
  seq: z.number().int().nonnegative(),
  sent_at: nullableTimestamp,
  author_label: nullableText,
  kind: z.enum(MESSAGE_KINDS),
  body: text,
  location,
  is_quoted: z.boolean(),
});

const messageContextRow = z.object({
  point_evidence_id: id,
  source_id: id,
  source_title: text,
  available: z.boolean(),
  messages: z.array(contextMessage),
  has_more_before: z.boolean(),
  has_more_after: z.boolean(),
});

export function mapSourceMessageContext(raw: unknown): SourceMessageContext {
  const r = parse(messageContextRow, raw);
  if (!r.available && r.messages.length > 0) throw new DbError("internal");
  if (r.available && r.messages.filter((m) => m.is_quoted).length !== 1) throw new DbError("internal");
  return {
    pointEvidenceId: r.point_evidence_id,
    sourceId: r.source_id,
    sourceTitle: r.source_title,
    available: r.available,
    messages: r.messages.map((m) => ({
      seq: m.seq,
      sentAt: m.sent_at,
      authorLabel: m.author_label,
      kind: m.kind,
      body: m.body,
      location: m.location,
      isQuoted: m.is_quoted,
    })),
    hasMoreBefore: r.has_more_before,
    hasMoreAfter: r.has_more_after,
  };
}

// ── Sources and processing ───────────────────────────────────────────────────

const sourceRow = z.object({
  id,
  handover_id: id,
  kind: z.enum(SOURCE_KINDS),
  title: text,
  state: z.enum(SOURCE_STATES),
  access_level: z.enum(ACCESS_LEVELS),
  size_bytes: z.coerce.number(),
  consent_recorded_at: nullableTimestamp,
  raw_deleted_at: nullableTimestamp,
  first_message_at: nullableTimestamp,
  last_message_at: nullableTimestamp,
  message_count: z.number().int().nullable(),
  masking_counts: z.record(z.enum(MASK_KINDS), z.number()).nullable(),
  error_code: nullableText,
});

export function mapSourceSummary(raw: unknown): SourceSummary {
  const r = parse(sourceRow, raw);
  return {
    id: r.id,
    handoverId: r.handover_id,
    kind: r.kind,
    title: r.title,
    state: r.state,
    accessLevel: r.access_level,
    sizeBytes: r.size_bytes,
    consentRecordedAt: r.consent_recorded_at,
    rawDeletedAt: r.raw_deleted_at,
    firstMessageAt: r.first_message_at,
    lastMessageAt: r.last_message_at,
    messageCount: r.message_count,
    maskingCounts: r.masking_counts,
    errorCode: r.error_code,
  };
}

const processingRow = z.object({
  handover_state: z.enum(HANDOVER_STATES),
  run: z
    .object({
      id,
      status: z.enum(RUN_STATUSES),
      started_at: nullableTimestamp,
      finished_at: nullableTimestamp,
      error: z.object({ code: text, message: text }).nullable(),
      stages: z.array(
        z.object({ stage: z.enum(PIPELINE_STAGES), status: z.enum([...RUN_STATUSES, "partial"]), done: count, total: count }),
      ),
    })
    .nullable(),
  sources: z.array(z.unknown()).nullable(),
});

export function mapProcessingStatus(raw: unknown): ProcessingStatus {
  const r = parse(processingRow, raw);
  return {
    handoverState: r.handover_state,
    run: r.run && {
      id: r.run.id,
      status: r.run.status,
      startedAt: r.run.started_at,
      finishedAt: r.run.finished_at,
      stages: r.run.stages,
      error: r.run.error,
    },
    sources: (r.sources ?? []).map(mapSourceSummary),
  };
}

// ── Points ───────────────────────────────────────────────────────────────────

const pointSummaryShape = {
  id,
  category: z.enum(POINT_CATEGORIES),
  title: text,
  statement: text,
  evidence_status: z.enum(EVIDENCE_STATUSES),
  review_state: z.enum(REVIEW_STATES),
  access_level: z.enum(ACCESS_LEVELS),
  is_potentially_outdated: z.boolean(),
  origin: z.enum(POINT_ORIGINS),
  evidence_count: count,
  privacy_review: z.enum(PRIVACY_REVIEW_STATES),
  last_supported_at: nullableTimestamp,
  updated_at: timestamp,
};
const pointSummaryRow = z.object(pointSummaryShape);

function toPointSummary(r: z.output<typeof pointSummaryRow>): PointSummary {
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    statement: r.statement,
    evidenceStatus: r.evidence_status,
    reviewState: r.review_state,
    accessLevel: r.access_level,
    isPotentiallyOutdated: r.is_potentially_outdated,
    origin: r.origin,
    evidenceCount: r.evidence_count,
    privacyReview: r.privacy_review,
    lastSupportedAt: r.last_supported_at,
    updatedAt: r.updated_at,
  };
}

export function mapPointSummary(raw: unknown): PointSummary {
  return toPointSummary(parse(pointSummaryRow, raw));
}

const pointDetailRow = z.object({
  ...pointSummaryShape,
  current_revision_id: id,
  revision_number: z.number().int(),
  attributes: z.unknown(),
  inference_rationale: nullableText,
  privacy_review_flagged_at: nullableTimestamp,
  privacy_review_reason: z.enum(PRIVACY_HOLD_REASONS).nullable(),
  privacy_review_set: z
    .object({
      digest: text,
      surfaces: z.array(
        z.object({
          kind: z.enum(PRIVACY_SURFACE_KINDS),
          id,
          revision_number: z.number().int().nullable(),
          fields: z.record(z.string(), z.string().nullable()),
          shared_with_point_ids: z.array(id),
        }),
      ),
    })
    .nullable(),
  inferred_confirmation: z.object({ by: text, at: timestamp }).nullable(),
  conflict_resolution: z.object({ note: text, by: text, at: timestamp }).nullable(),
  evidence: z.array(
    z.object({
      point_evidence_id: id,
      evidence_id: id,
      kind: z.enum(EVIDENCE_KINDS),
      quote: text,
      author_label: nullableText,
      sent_at: nullableTimestamp,
      source_title: nullableText,
      location,
      quote_check: z.enum(QUOTE_CHECKS),
      support_verdict: z.enum(SUPPORT_VERDICTS),
      verdict_rationale: nullableText,
      // PI-11 (migration 20261113300900): optional so a database without that migration still parses.
      guarded: z.boolean().optional(),
      model_verdict: z.enum(["supports", "partial"]).nullable().optional(),
      is_current_revision_verdict: z.boolean(),
      excluded: z.boolean(),
      exclusion_reason: nullableText,
      access_level: z.enum(ACCESS_LEVELS),
    }),
  ),
  revisions: z.array(
    z.object({
      id,
      number: z.number().int(),
      title: text,
      statement: text,
      attributes: z.unknown(),
      edit_reason: nullableText,
      author_label: nullableText,
      created_at: timestamp,
      redaction: z.enum(REDACTION_KINDS).nullable(),
    }),
  ),
  review_history: z.array(
    z.object({ action: z.enum(REVIEW_ACTION_TYPES), actor_label: nullableText, note: nullableText, created_at: timestamp }),
  ),
});

export function mapPointDetail(raw: unknown): PointDetail {
  const r = parse(pointDetailRow, raw);
  const surfaces: PrivacySurface[] | null =
    r.privacy_review_set?.surfaces.map((s) => ({
      kind: s.kind,
      id: s.id,
      ...(s.revision_number !== null ? { revisionNumber: s.revision_number } : {}),
      fields: s.fields,
      sharedWithPointIds: s.shared_with_point_ids,
    })) ?? null;

  return {
    ...toPointSummary(r),
    currentRevisionId: r.current_revision_id,
    revisionNumber: r.revision_number,
    attributes: attributesFor(r.category, r.attributes),
    inferenceRationale: r.inference_rationale,
    privacyReviewFlaggedAt: r.privacy_review_flagged_at,
    privacyReviewReason: r.privacy_review_reason,
    privacySurfaces: surfaces,
    privacyReviewDigest: r.privacy_review_set?.digest ?? null,
    inferredConfirmation: r.inferred_confirmation,
    conflictResolution: r.conflict_resolution,
    evidence: r.evidence.map((e) => ({
      pointEvidenceId: e.point_evidence_id,
      evidenceId: e.evidence_id,
      kind: e.kind,
      quote: e.quote,
      authorLabel: e.author_label,
      sentAt: e.sent_at,
      sourceTitle: e.source_title,
      location: e.location,
      quoteCheck: e.quote_check,
      supportVerdict: e.support_verdict,
      verdictRationale: e.verdict_rationale,
      guarded: e.guarded === true,
      modelVerdict: e.guarded === true ? (e.model_verdict ?? null) : null,
      isCurrentRevisionVerdict: e.is_current_revision_verdict,
      excluded: e.excluded,
      exclusionReason: e.exclusion_reason,
      accessLevel: e.access_level,
    })),
    revisions: r.revisions.map((v) => {
      let attributes: PointAttributes | Record<string, never> = {};
      if (v.redaction !== "tombstone") {
        const parsed = parsePointAttributes(r.category, v.attributes);
        // An older revision may predate a schema default; its stored text is still what it is.
        attributes = parsed.success ? parsed.data.attributes : ((v.attributes ?? {}) as PointAttributes);
      }
      return {
        id: v.id,
        number: v.number,
        title: v.title,
        statement: v.statement,
        attributes,
        editReason: v.edit_reason,
        authorLabel: v.author_label,
        createdAt: v.created_at,
        redaction: v.redaction,
      };
    }),
    reviewHistory: r.review_history.map((h) => ({
      action: h.action,
      actorLabel: h.actor_label,
      note: h.note,
      createdAt: h.created_at,
    })),
  };
}

// ── Gaps ─────────────────────────────────────────────────────────────────────

const gapQuestionRow = z.object({
  id,
  point_id: id.nullable(),
  category: z.enum(POINT_CATEGORIES).nullable(),
  question: text,
  context: nullableText,
  priority: z.enum(GAP_PRIORITIES),
  status: z.enum(GAP_QUESTION_STATUSES),
  privacy_held: z.boolean(),
  answers: z.array(
    z.object({
      id,
      answerer_label: text,
      text,
      status: z.enum(GAP_ANSWER_STATUSES),
      privacy_held: z.boolean(),
      created_at: timestamp,
    }),
  ),
});

export function mapGapQuestion(raw: unknown): GapQuestionSummary {
  const r = parse(gapQuestionRow, raw);
  return {
    id: r.id,
    pointId: r.point_id,
    category: r.category,
    question: r.question,
    context: r.context,
    priority: r.priority,
    status: r.status,
    privacyHeld: r.privacy_held,
    answers: r.answers.map((a) => ({
      id: a.id,
      answererLabel: a.answerer_label,
      text: a.text,
      status: a.status,
      privacyHeld: a.privacy_held,
      createdAt: a.created_at,
    })),
  };
}

const gapInterviewRow = z.object({
  handover_title: text,
  questions: z.array(
    z.object({
      id,
      question: text,
      context: nullableText,
      priority: z.enum(GAP_PRIORITIES),
      category: z.enum(POINT_CATEGORIES).nullable(),
    }),
  ),
});

export function mapGapInterview(raw: unknown): GapInterview {
  const r = parse(gapInterviewRow, raw);
  return { handoverTitle: r.handover_title, questions: r.questions };
}

// ── Readiness (already camelCase: computed in SQL in the DTO shape) ──────────

const statusCounts = z.object({ sourced: count, inferred: count, conflicting: count, missing: count });
const reviewCounts = z.object({ pending: count, approved: count, rejected: count });
const readinessRow = z.object({
  canPublish: z.boolean(),
  blockers: z.array(z.object({ kind: z.enum(READINESS_BLOCKERS), count, pointIds: z.array(id) })),
  counts: z.object({ byStatus: statusCounts, byReviewState: reviewCounts, outdated: count }),
  score: z.number().min(0).max(100),
});

export function mapReadiness(raw: unknown): ReadinessReport {
  return parse(readinessRow, raw);
}

// ── Published handover ───────────────────────────────────────────────────────

const publishedEvidence = z.union([
  z.object({ evidenceId: id, redacted: z.literal(true) }).strict(),
  z.object({
    evidenceId: id,
    redacted: z.literal(false),
    kind: z.enum(EVIDENCE_KINDS),
    quote: text,
    authorLabel: nullableText,
    sentAt: nullableTimestamp,
    sourceTitle: nullableText,
    stance: z.enum(["supports", "contradicts"]),
    authorProfileId: id.nullable(),
  }),
]);

const publishedContent = z.object({
  title: text,
  statement: text,
  attributes: z.record(z.string(), z.unknown()),
  evidenceStatus: z.enum(EVIDENCE_STATUSES),
  isPotentiallyOutdated: z.boolean(),
  isKnownGap: z.boolean(),
  textRedacted: z.boolean().optional(),
  inferredConfirmation: z.object({ byLabel: text, byProfileId: id, at: timestamp }).nullable(),
  conflictResolution: z.object({ note: text, byLabel: text, byProfileId: id, at: timestamp }).nullable(),
  evidence: z.array(publishedEvidence),
  evidenceRedacted: z.boolean(),
});

const publishedRow = z.object({
  handover_id: id,
  title: text,
  team_name: text,
  role_title: nullableText,
  publication_id: id,
  version: z.number().int(),
  published_at: timestamp,
  published_by_label: text,
  summary: nullableText,
  sections: z.array(
    z.object({
      category: z.enum(POINT_CATEGORIES),
      points: z.array(z.object({ id, content: publishedContent })),
    }),
  ),
  viewer_acknowledged_at: nullableTimestamp,
});

export function mapPublishedHandover(raw: unknown): PublishedHandover {
  const r = parse(publishedRow, raw);
  return {
    handoverId: r.handover_id,
    title: r.title,
    teamName: r.team_name,
    roleTitle: r.role_title,
    publicationId: r.publication_id,
    version: r.version,
    publishedAt: r.published_at,
    publishedByLabel: r.published_by_label,
    summary: r.summary,
    sections: r.sections
      .filter((s) => s.points.length > 0) // empty sections are omitted (§8.5)
      .map((s) => ({
        category: s.category,
        points: s.points.map((p) => ({
          id: p.id,
          // The snapshot was validated per category when it was published; attributes keep their stored shape.
          content: p.content as unknown as PublishedPointContent,
        })),
      })),
    viewerAcknowledgedAt: r.viewer_acknowledged_at,
  };
}
