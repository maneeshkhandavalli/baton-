/**
 * Canonical Zod schemas (docs/architecture/shared-contracts.md §3.1, §11.3, §11.5).
 *
 * Written for Zod 4 (`z.uuid()`, `z.email()`, `z.iso.date()`, `z.strictObject()`).
 * Input schemas validate shape only. Role, lifecycle and RLS checks happen on the server
 * after parsing (§11.2).
 */

import { z } from "zod";

import {
  ACCESS_LEVELS,
  CONTACT_CHANNELS,
  CREATOR_ROLES,
  DATE_ORDERS,
  DEPENDENCY_TYPES,
  EVIDENCE_STANCES,
  EXCLUSION_SCOPES,
  GAP_ANSWER_DECISIONS,
  GAP_PRIORITIES,
  IDENTITY_KINDS,
  IDENTITY_MATCH_DECISIONS,
  IDENTITY_PEPPER_VERSIONS,
  MEMBER_ROLES,
  POINT_CATEGORIES,
  PRIVACY_REVIEW_DECISIONS,
  PRIVACY_SURFACE_DECISIONS,
  RELATED_PRIVACY_SURFACE_KINDS,
  RISK_LEVELS,
  SOURCE_KINDS,
  SUPPORT_VERDICTS,
} from "./enums";
import { IDENTITY_HASH_PATTERN } from "./identity";

// ── Primitives ───────────────────────────────────────────────────────────────

export const uuidSchema = z.uuid();
export const accessLevelSchema = z.enum(ACCESS_LEVELS);
export const pointCategorySchema = z.enum(POINT_CATEGORIES);

/** 25 MB per file (§11.4, D15). */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Optional free-text attribute: trimmed, `null` when absent. */
const optionalText = z.string().trim().nullable().default(null);
/** Required free-text attribute (bold in the §3.1 table). */
const requiredText = z.string().trim().min(1);

// ── Category attributes (§3.1) ───────────────────────────────────────────────

const PHONE_PATTERN = /^\+?\d[\d\s-]{5,18}\d$/;

/**
 * A real contact detail typed in by a review role (D5). Exactly one phone number or email.
 * This is the only field exempt from masking; it is never produced by extraction.
 */
export const directContactSchema = z.discriminatedUnion("channel", [
  z.strictObject({ channel: z.literal("email"), value: z.email() }),
  z.strictObject({
    channel: z.literal("phone"),
    value: z
      .string()
      .trim()
      .regex(PHONE_PATTERN, "Enter a single phone number")
      .refine((v) => {
        const digits = v.replace(/\D/g, "").length;
        return digits >= 7 && digits <= 15; // E.164 allows at most 15 digits
      }, "Enter a single phone number"),
  }),
]);

const decisionAttributes = z.strictObject({
  decidedAt: optionalText,
  decidedByLabel: optionalText,
  rationale: optionalText,
  alternativesConsidered: z.array(requiredText).default([]),
});

const ownerAttributes = z.strictObject({
  responsibility: requiredText,
  ownerLabel: optionalText,
  since: optionalText,
});

const openTaskAttributes = z.strictObject({
  assigneeLabel: optionalText,
  dueDate: z.iso.date().nullable().default(null),
  progressNote: optionalText,
});

const blockerAttributes = z.strictObject({
  blockingWhat: optionalText,
  unblockCondition: optionalText,
});

const riskAttributes = z.strictObject({
  likelihood: z.enum(RISK_LEVELS).nullable().default(null),
  impact: z.enum(RISK_LEVELS).nullable().default(null),
  mitigation: optionalText,
});

const dependencyAttributes = z.strictObject({
  dependsOnLabel: optionalText,
  dependencyType: z.enum(DEPENDENCY_TYPES).nullable().default(null),
});

const recurringProblemAttributes = z.strictObject({
  frequency: optionalText,
  knownWorkaround: optionalText,
  firstSeenAt: optionalText,
});

const contactAttributes = z.strictObject({
  nameLabel: requiredText,
  organisation: optionalText,
  roleDescription: optionalText,
  preferredChannel: z.enum(CONTACT_CHANNELS).nullable().default(null),
  directContact: directContactSchema.nullable().default(null),
});

const nextActionAttributes = z.strictObject({
  actorLabel: optionalText,
  byWhen: optionalText,
});

/** `account_access` never stores credential values; text is masked on the server (§3.1). */
const accountAccessAttributes = z.strictObject({
  system: requiredText,
  holderLabel: optionalText,
  accessLocation: optionalText,
  recoveryNote: optionalText,
});

/** Attribute schema per category, for points written by review roles (edits, manual points). */
export const pointAttributesSchemas = {
  decision: decisionAttributes,
  owner: ownerAttributes,
  open_task: openTaskAttributes,
  blocker: blockerAttributes,
  risk: riskAttributes,
  dependency: dependencyAttributes,
  recurring_problem: recurringProblemAttributes,
  contact: contactAttributes,
  next_action: nextActionAttributes,
  account_access: accountAccessAttributes,
} as const satisfies Record<(typeof POINT_CATEGORIES)[number], z.ZodType>;

/**
 * Attribute schemas for AI extraction output: identical, except `contact` has no
 * `directContact`. Because the objects are strict, extraction output that contains it fails (§3.1).
 */
export const extractedPointAttributesSchemas = {
  ...pointAttributesSchemas,
  contact: contactAttributes.omit({ directContact: true }),
} as const satisfies Record<(typeof POINT_CATEGORIES)[number], z.ZodType>;

/** Category and attributes together, discriminated by category. */
export const categorizedPointAttributesSchema = z.discriminatedUnion("category", [
  z.object({ category: z.literal("decision"), attributes: decisionAttributes }),
  z.object({ category: z.literal("owner"), attributes: ownerAttributes }),
  z.object({ category: z.literal("open_task"), attributes: openTaskAttributes }),
  z.object({ category: z.literal("blocker"), attributes: blockerAttributes }),
  z.object({ category: z.literal("risk"), attributes: riskAttributes }),
  z.object({ category: z.literal("dependency"), attributes: dependencyAttributes }),
  z.object({ category: z.literal("recurring_problem"), attributes: recurringProblemAttributes }),
  z.object({ category: z.literal("contact"), attributes: contactAttributes }),
  z.object({ category: z.literal("next_action"), attributes: nextActionAttributes }),
  z.object({ category: z.literal("account_access"), attributes: accountAccessAttributes }),
]);

export type DirectContact = z.output<typeof directContactSchema>;
export type CategorizedPointAttributes = z.output<typeof categorizedPointAttributesSchema>;
export type PointAttributesFor<C extends CategorizedPointAttributes["category"]> = Extract<
  CategorizedPointAttributes,
  { category: C }
>["attributes"];
/** Union of every category's attributes (§3.1). */
export type PointAttributes = CategorizedPointAttributes["attributes"];

/**
 * Server-side re-validation of free-form `attributes` (from `edit`, `redact` and manual points)
 * against the point's category (§11.5).
 */
export function parsePointAttributes(category: CategorizedPointAttributes["category"], attributes: unknown) {
  return categorizedPointAttributesSchema.safeParse({ category, attributes });
}

// ── Inputs: handovers (§11.3, §11.5) ─────────────────────────────────────────

export const createHandoverInput = z.object({
  title: z.string().trim().min(3).max(120),
  teamName: z.string().trim().min(2).max(120),
  roleTitle: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  // The creator's own membership role (§6.3, §8.2, D23). Never defaulted: the wizard asks
  // "Are you the person leaving this role?". "reviewer" means someone else is outgoing.
  creatorRole: z.enum(CREATOR_ROLES),
});

/**
 * R3 (draft metadata): edit a DRAFT's details after creation. Same limits as createHandoverInput; the
 * creator role is not editable. `expectedUpdatedAt` is the HandoverSummary.updatedAt the editor last saw:
 * the server refuses with `conflict` if the draft changed since (optimistic concurrency, so a slow autosave
 * can never overwrite a newer edit). Only the creator (or the outgoing member) of a handover in `draft`.
 */
export const updateHandoverDetailsInput = z.object({
  handoverId: uuidSchema,
  title: z.string().trim().min(3).max(120),
  teamName: z.string().trim().min(2).max(120),
  roleTitle: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
});

export const handoverIdInput = z.object({ handoverId: uuidSchema });

export const publishHandoverInput = z.object({
  handoverId: uuidSchema,
  summary: z.string().optional(),
});

export const offerCreatorTransferInput = z.object({
  handoverId: uuidSchema,
  toMemberId: uuidSchema,
});

export const respondToCreatorTransferInput = z.object({
  handoverId: uuidSchema,
  accept: z.boolean(),
});

// ── Inputs: privacy and account (§11.3) ──────────────────────────────────────

export const eraseParticipantInput = z.object({
  handoverId: uuidSchema,
  participantId: uuidSchema,
  confirm: z.literal(true),
});

/** The word the user must type to delete their account (D25). Checked on the server, not only in the UI. */
export const ACCOUNT_DELETION_CONFIRMATION = "DELETE";

/**
 * D25 (accepted): blocked until every created handover is transferred or listed here for an
 * explicitly confirmed immediate purge (§12.9). `confirm` is the exact typed word, case-sensitive.
 */
export const deleteAccountInput = z.object({
  confirm: z.literal(ACCOUNT_DELETION_CONFIRMATION),
  purgeHandoverIds: z
    .array(uuidSchema)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, "Each handover once"),
});

// ── Inputs: sources (§11.5) ──────────────────────────────────────────────────

export const createSourceUploadInput = z.object({
  handoverId: uuidSchema,
  kind: z.enum(SOURCE_KINDS),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(127),
  sizeBytes: z.number().int().positive().max(MAX_SOURCE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const sourceIdInput = z.object({ sourceId: uuidSchema });

export const recordSourceConsentInput = z.object({
  sourceId: uuidSchema,
  consentStatementVersion: z.string().min(1),
  consentConfirmed: z.literal(true),
  accessLevel: accessLevelSchema.default("everyone"),
  timezone: z.string().min(1),
  dateOrder: z.enum(DATE_ORDERS).optional(),
  documentDate: z.iso.date().optional(),
});

/** The context a positional conversation id was chosen in (§10.3, ParseContext in §11.4). */
export const parseContextSchema = z.strictObject({
  timezone: z.string().min(1),
  dateOrder: z.enum(DATE_ORDERS).nullable(),
  parserVersion: z.string().min(1),
});

const exclusionReason = z.string().trim().min(1).max(500).optional();
const isoInstant = z.iso.datetime({ offset: true }); // explicit offset or Z; never server-local time

/**
 * Pre-parse exclusions (§10.3 step 2, §6.8). After a successful final parse a participant opt-out is
 * a participant erasure instead (§12.8). The server derives the handover from the source.
 */
export const addExclusionInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("participant"),
    sourceId: uuidSchema, // the source the participant was seen in
    // "handover" also covers later uploads. A handover-wide `name` rule is only DETECTED in other
    // sources and needs confirmIdentityMatch there (§6.8.1); it is never silently applied.
    scope: z.enum(EXCLUSION_SCOPES),
    identityKind: z.enum(IDENTITY_KINDS),
    participantIdentityHash: z.string().regex(IDENTITY_HASH_PATTERN),
    identityPepperVersion: z.enum(IDENTITY_PEPPER_VERSIONS),
    reason: exclusionReason,
  }),
  z.object({
    kind: z.literal("conversation"),
    sourceId: uuidSchema, // always source-scoped
    conversationLocalId: z.string().regex(/^c_[1-9][0-9]*$/),
    parseContext: parseContextSchema, // SourcePreview.parseContext of the preview it was chosen from
    reason: exclusionReason,
  }),
  z
    .object({
      kind: z.literal("date_range"),
      sourceId: uuidSchema,
      scope: z.enum(EXCLUSION_SCOPES),
      rangeStart: isoInstant,
      rangeEnd: isoInstant,
      reason: exclusionReason,
    })
    .refine((v) => Date.parse(v.rangeStart) <= Date.parse(v.rangeEnd), {
      path: ["rangeEnd"],
      message: "The range must not end before it starts",
    }),
]);

/** Creator decision on a `detect` match between a handover-wide name exclusion and a source (§6.8.1). */
export const confirmIdentityMatchInput = z.object({
  sourceId: uuidSchema,
  exclusionId: uuidSchema,
  decision: z.enum(IDENTITY_MATCH_DECISIONS),
});

// ── Inputs: review (§5, §11.5) ───────────────────────────────────────────────

/** Replacement text for the point surface on a point-level `redact` (§5.5). */
const pointRedactionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  statement: z.string().trim().min(1).max(1000),
  attributes: z.record(z.string(), z.unknown()), // re-validated per category on the server
  inferenceRationale: z.string().trim().max(2000).nullable().optional(),
  conflictResolutionNote: z.string().trim().max(2000).nullable().optional(),
});

/** One decision per related surface in the current review set (§5.5). */
export const privacySurfaceDecisionInput = z
  .object({
    kind: z.enum(RELATED_PRIVACY_SURFACE_KINDS),
    id: uuidSchema,
    decision: z.enum(PRIVACY_SURFACE_DECISIONS),
    // field → replacement, required iff "redact". Text fields are masked on the server.
    // For "revision", `attributes` is an object re-validated for the category.
    replacement: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((s) => (s.decision === "redact") === (s.replacement !== undefined), {
    path: ["replacement"],
    message: "A replacement is required exactly when the decision is redact",
  });

const resolvePrivacyReviewAction = z
  .object({
    action: z.literal("resolve_privacy_review"),
    pointId: uuidSchema,
    expectedRevisionId: uuidSchema,
    surfacesDigest: z.string().min(1), // from PointDetail.privacyReviewDigest; mismatch → conflict
    decision: z.enum(PRIVACY_REVIEW_DECISIONS), // the point surface
    redacted: pointRedactionSchema.optional(), // required iff decision === "redact"
    // Exactly one entry per non-point surface in the current review set (checked on the server).
    surfaces: z.array(privacySurfaceDecisionInput).max(500),
  })
  .refine((v) => (v.decision === "redact") === (v.redacted !== undefined), {
    path: ["redacted"],
    message: "Replacement point text is required exactly when the decision is redact",
  })
  // withdraw tombstones every revision, so every earlier revision must be submitted as "remove"
  .refine((v) => v.decision !== "withdraw" || v.surfaces.every((s) => s.kind !== "revision" || s.decision === "remove"), {
    path: ["surfaces"],
    message: "Withdrawing a point requires every earlier revision to be removed",
  });

export const reviewPointInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    pointId: uuidSchema,
    expectedRevisionId: uuidSchema,
    confirmInferred: z.boolean().optional(),
    resolutionNote: z.string().trim().min(1).max(2000).optional(),
    asKnownGap: z.boolean().optional(),
  }),
  z.object({ action: z.literal("reject"), pointId: uuidSchema, reason: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("reopen"), pointId: uuidSchema, note: z.string().max(2000).optional() }),
  z.object({
    action: z.literal("edit"),
    pointId: uuidSchema,
    expectedRevisionId: uuidSchema,
    title: z.string().trim().min(1).max(120),
    statement: z.string().trim().min(1).max(1000),
    attributes: z.record(z.string(), z.unknown()), // re-validated per category on the server
    editReason: z.string().trim().min(1).max(500),
  }),
  z.object({ action: z.literal("confirm_inferred"), pointId: uuidSchema, note: z.string().max(2000).optional() }),
  z.object({
    action: z.literal("resolve_conflict"),
    pointId: uuidSchema,
    resolutionNote: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("exclude_evidence"),
    pointId: uuidSchema,
    pointEvidenceId: uuidSchema,
    reason: z.string().trim().min(1).max(500),
  }),
  z.object({ action: z.literal("restore_evidence"), pointId: uuidSchema, pointEvidenceId: uuidSchema }),
  z.object({ action: z.literal("change_access"), pointId: uuidSchema, accessOverride: accessLevelSchema.nullable() }),
  resolvePrivacyReviewAction,
]);

/**
 * A point written by a review role (`origin = 'manual'`). Category and attributes are validated
 * together (§3.1). Without testimony or a rationale the point derives `missing` (§4.2).
 */
export const createManualPointInput = z
  .intersection(
    z.object({
      handoverId: uuidSchema,
      title: z.string().trim().min(1).max(120),
      statement: z.string().trim().min(1).max(1000),
      inferenceRationale: z.string().trim().min(1).max(2000).optional(),
      accessOverride: accessLevelSchema.nullable().optional(),
      // The author's own statement, stored as testimony (`stated_by_profile_id`, §6.10, §8.4).
      testimony: z
        .object({
          text: z.string().trim().min(1).max(4000),
          accessLevel: accessLevelSchema.default("everyone"),
        })
        .optional(),
    }),
    categorizedPointAttributesSchema,
  )
  // D5: a typed-in direct contact is stored at leads_only or stricter.
  .refine(
    (v) =>
      v.category !== "contact" ||
      v.attributes.directContact === null ||
      v.accessOverride === "leads_only" ||
      v.accessOverride === "reviewer_only",
    { path: ["accessOverride"], message: "A direct contact needs leads_only or reviewer_only access" },
  );

// ── Inputs: gaps (§11.3, §11.5) ──────────────────────────────────────────────

/** Review roles only. A question about a point takes its category from the point. */
export const createGapQuestionInput = z
  .object({
    handoverId: uuidSchema,
    pointId: uuidSchema.optional(),
    category: pointCategorySchema.optional(),
    question: z.string().trim().min(1).max(500),
    context: z.string().trim().min(1).max(2000).optional(), // masked; must not quote evidence above accessLevel
    priority: z.enum(GAP_PRIORITIES),
    accessLevel: accessLevelSchema.default("everyone"), // the server raises it to the point's level
    assignedMemberId: uuidSchema.optional(),
  })
  .refine((v) => v.pointId === undefined || v.category === undefined, {
    path: ["category"],
    message: "A question about a point takes the point's category",
  });

/** Review roles only. Gap Interview links allow 20 uses (§12.4); that is not an input. */
export const createGapLinkInput = z.object({
  handoverId: uuidSchema,
  questionIds: z
    .array(uuidSchema)
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, "Each question once"),
  maxAccessLevel: accessLevelSchema.default("everyone"),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

/** Creator: any token of the handover. Other review roles: Gap Interview links only (§12.4). */
export const revokeAccessTokenInput = z.object({ tokenId: uuidSchema });

export const submitGapAnswersInput = z
  .object({
    token: z.string().min(32).max(128).optional(), // either a token or a signed-in session
    answererLabel: z.string().trim().min(1).max(80).optional(), // required with a token
    answers: z
      .array(z.object({ gapQuestionId: uuidSchema, answerText: z.string().trim().min(1).max(4000) }))
      .min(1)
      .max(50),
  })
  .refine((v) => v.token === undefined || v.answererLabel !== undefined, {
    path: ["answererLabel"],
    message: "A name is required when answering through a link",
  });

export const reviewGapAnswerInput = z.object({
  answerId: uuidSchema,
  decision: z.enum(GAP_ANSWER_DECISIONS),
  note: z.string().optional(),
});

// ── Inputs: members (§11.3, §11.5) ───────────────────────────────────────────

export const inviteMemberInput = z
  .object({
    handoverId: uuidSchema,
    email: z.email(),
    role: z.enum(MEMBER_ROLES), // "outgoing" invites a separate outgoing member
    clearance: accessLevelSchema.optional(),
    expiresInDays: z.number().int().min(1).max(30).default(7),
  })
  .refine(
    (v) => !(v.role === "outgoing" || v.role === "reviewer") || v.clearance === undefined || v.clearance === "reviewer_only",
    { path: ["clearance"], message: "Outgoing and reviewer members always have reviewer_only clearance" },
  );

/** Creator-only. Applies only to `lead` and `incoming` members; the server rejects review roles (§6.3). */
export const updateMemberClearanceInput = z.object({
  memberId: uuidSchema,
  clearance: accessLevelSchema,
});

export const memberIdInput = z.object({ memberId: uuidSchema });

export const acknowledgePublicationInput = z.object({
  publicationId: uuidSchema,
  statementVersion: z.string().min(1),
});

// ── AI output (§10.6, §10.8, §11.8 rule 2) ────────────────────────────────────
// Model output is untrusted (§12.10). lib/ai parses the provider's `raw` with these schemas; a
// candidate that fails is dropped (after one retry of the call) and only counted, never logged.

/** §10.6 limits. */
export const EXTRACTION_TITLE_MAX = 120;
export const EXTRACTION_STATEMENT_MAX = 1_000;
/** §12.10 rule 3 ("Zod schemas cap lengths"): bounds on untrusted model output. */
export const EXTRACTION_QUOTE_MAX = 1_000;
export const EXTRACTION_CITATIONS_MAX = 20;
export const EXTRACTION_CANDIDATES_MAX = 100;

const extractionCitationSchema = z.strictObject({
  /** source_messages.id the model was shown in this request; anything else is discarded (§10.6). */
  messageId: uuidSchema,
  /** Must be copied verbatim from that message; existence is re-checked deterministically (§10.7). */
  quote: z.string().min(1).max(EXTRACTION_QUOTE_MAX),
  /** The model's claim only; independently re-judged by the support call (§10.8). */
  stance: z.enum(EVIDENCE_STANCES),
});

const candidateFields = {
  title: z.string().trim().min(1).max(EXTRACTION_TITLE_MAX),
  statement: z.string().trim().min(1).max(EXTRACTION_STATEMENT_MAX),
  citations: z.array(extractionCitationSchema).max(EXTRACTION_CITATIONS_MAX),
  inferenceRationale: z.string().trim().min(1).max(EXTRACTION_STATEMENT_MAX).nullable(),
};

function candidateFor<C extends (typeof POINT_CATEGORIES)[number]>(category: C) {
  return z.strictObject({ category: z.literal(category), attributes: extractedPointAttributesSchemas[category], ...candidateFields });
}

/**
 * One extraction candidate (§10.6). Attributes are checked against the candidate's own category with
 * the extraction variants, so `contact.directContact` is rejected (§3.1, D5). `inferenceRationale` is
 * required when there are no citations.
 */
export const extractionCandidateSchema = z
  .discriminatedUnion("category", [
    candidateFor("decision"),
    candidateFor("owner"),
    candidateFor("open_task"),
    candidateFor("blocker"),
    candidateFor("risk"),
    candidateFor("dependency"),
    candidateFor("recurring_problem"),
    candidateFor("contact"),
    candidateFor("next_action"),
    candidateFor("account_access"),
  ])
  .superRefine((candidate, ctx) => {
    if (candidate.citations.length === 0 && candidate.inferenceRationale === null) {
      ctx.addIssue({ code: "custom", path: ["inferenceRationale"], message: "required when there are no citations" });
    }
  });

/** The extract call's envelope. Each element is then parsed on its own with extractionCandidateSchema. */
export const extractionResponseSchema = z.strictObject({ candidates: z.array(z.unknown()).max(EXTRACTION_CANDIDATES_MAX) });

/** The support call's answer for one (current revision, quote) pair (§10.8). Never "unchecked". */
export const supportVerdictResponseSchema = z.strictObject({
  verdict: z.enum(SUPPORT_VERDICTS).exclude(["unchecked"]),
  rationale: z.string().trim().min(1).max(EXTRACTION_STATEMENT_MAX),
});

export type ExtractionCandidate = z.output<typeof extractionCandidateSchema>;
export type ExtractionCitation = z.output<typeof extractionCitationSchema>;
export type SupportVerdictResponse = z.output<typeof supportVerdictResponseSchema>;

// ── Input types ──────────────────────────────────────────────────────────────
// `…Input` is what callers send (z.input); `…Values` is what the server works with after
// parsing, where defaults have been applied (z.output).

export type CreateHandoverInput = z.input<typeof createHandoverInput>;
export type UpdateHandoverDetailsInput = z.input<typeof updateHandoverDetailsInput>;
export type HandoverIdInput = z.input<typeof handoverIdInput>;
export type PublishHandoverInput = z.input<typeof publishHandoverInput>;
export type OfferCreatorTransferInput = z.input<typeof offerCreatorTransferInput>;
export type RespondToCreatorTransferInput = z.input<typeof respondToCreatorTransferInput>;
export type EraseParticipantInput = z.input<typeof eraseParticipantInput>;
export type DeleteAccountInput = z.input<typeof deleteAccountInput>;
export type CreateSourceUploadInput = z.input<typeof createSourceUploadInput>;
export type SourceIdInput = z.input<typeof sourceIdInput>;
export type RecordSourceConsentInput = z.input<typeof recordSourceConsentInput>;
export type RecordSourceConsentValues = z.output<typeof recordSourceConsentInput>;
export type ParseContextInput = z.input<typeof parseContextSchema>;
export type AddExclusionInput = z.input<typeof addExclusionInput>;
export type AddExclusionValues = z.output<typeof addExclusionInput>;
export type ConfirmIdentityMatchInput = z.input<typeof confirmIdentityMatchInput>;
export type CreateManualPointInput = z.input<typeof createManualPointInput>;
export type CreateManualPointValues = z.output<typeof createManualPointInput>;
export type CreateGapQuestionInput = z.input<typeof createGapQuestionInput>;
export type CreateGapQuestionValues = z.output<typeof createGapQuestionInput>;
export type CreateGapLinkInput = z.input<typeof createGapLinkInput>;
export type CreateGapLinkValues = z.output<typeof createGapLinkInput>;
export type RevokeAccessTokenInput = z.input<typeof revokeAccessTokenInput>;
export type PrivacySurfaceDecisionInput = z.input<typeof privacySurfaceDecisionInput>;
export type ReviewPointInput = z.input<typeof reviewPointInput>;
export type SubmitGapAnswersInput = z.input<typeof submitGapAnswersInput>;
export type ReviewGapAnswerInput = z.input<typeof reviewGapAnswerInput>;
export type InviteMemberInput = z.input<typeof inviteMemberInput>;
export type InviteMemberValues = z.output<typeof inviteMemberInput>;
export type UpdateMemberClearanceInput = z.input<typeof updateMemberClearanceInput>;
export type MemberIdInput = z.input<typeof memberIdInput>;
export type AcknowledgePublicationInput = z.input<typeof acknowledgePublicationInput>;
