/**
 * DB mutations (§11.2): typed wrappers over Baton's SQL functions. They throw `DbError`; main's server
 * actions validate input with the contract schemas first, then map errors with `toAppError`.
 *
 * Privilege model (security fix H1, approved by main):
 *   * Every application mutation runs ON THE SERVER with the service-role client (`db`) and a
 *     `VerifiedActor` built from `auth.getUser()` (lib/supabase/auth.ts `requireVerifiedActor`).
 *   * The browser has no EXECUTE on any mutation function, so it cannot call them through PostgREST.
 *   * Each SQL function re-validates the actor (`_require_actor`) and its membership, role, clearance and
 *     lifecycle permissions itself; the actor id is never trusted because it was passed.
 *   * Reads stay user-scoped and RLS-protected (lib/db/queries.ts).
 *
 * Preconditions the caller owns (the database cannot check them):
 *   * Free text (notes, edits, answers, replacements, summaries) is ALREADY MASKED with lib/privacy (§12.1).
 *   * `attributes` were re-validated for the category with `parsePointAttributes` (§11.5).
 *   * The AI provider passed to startProcessing / recordSourceConsent comes from server configuration
 *     (lib/ai/config.ts), never from the request (§11.8 rule 5).
 */

import type { z } from "zod";

import type { AccessLevel, IdentityKind, IdentityPepperVersion, MemberRole, PipelineStage, SourceKind } from "../contracts/enums";
import type {
  AddExclusionValues,
  ConfirmIdentityMatchInput,
  CreateGapLinkValues,
  CreateGapQuestionValues,
  CreateManualPointValues,
  reviewPointInput,
} from "../contracts/schemas";
import { ACCOUNT_DELETION_CONFIRMATION, deleteAccountInput } from "../contracts/schemas";
import type { ErasureReport } from "../contracts/dto";
import type { VerifiedActor } from "./actor-rules";
import { canRedeemInvitation } from "./actor-rules";
import type { DbClient } from "./client";
import { DbError } from "./errors";
import { callRpc } from "./rpc";
import { assertManifestReceipt, type ManifestReceipt } from "./recovery-gate";
import { clientSubject, consumeRateLimits } from "./rate-limit";
import { generateRawToken, hexToBytea, sha256Hex, tokenHashParam } from "./tokens";

type ReviewPointValues = z.output<typeof reviewPointInput>;

const asUuid = (v: unknown): string => {
  if (typeof v !== "string") throw new DbError("internal");
  return v;
};

/** Every actor-scoped call passes the verified actor as p_actor_profile_id. */
function call(db: DbClient, actor: VerifiedActor, fn: string, args: Record<string, unknown> = {}) {
  if (!actor || typeof actor.profileId !== "string") throw new DbError("unauthenticated");
  return callRpc(db, fn, { p_actor_profile_id: actor.profileId, ...args });
}

// ── Handovers and lifecycle (§9) ─────────────────────────────────────────────

export async function createHandover(
  db: DbClient,
  actor: VerifiedActor,
  input: { title: string; teamName: string; roleTitle?: string; description?: string; creatorRole: "outgoing" | "reviewer" },
): Promise<string> {
  return asUuid(await call(db, actor, "create_handover", {
    p_title: input.title,
    p_team_name: input.teamName,
    p_role_title: input.roleTitle ?? null,
    p_description: input.description ?? null,
    p_creator_role: input.creatorRole,
  }));
}

/**
 * R3 C1: edit a DRAFT's details (creator or outgoing member; checked in SQL). Free text is ALREADY MASKED.
 * `expectedUpdatedAt` is the HandoverSummary.updatedAt the editor last saw (compared at millisecond
 * precision); a stale value is `conflict` unless the values are already stored (an idempotent retry).
 * Optional fields: `undefined` keeps the stored value, an empty string clears it. Returns the new updatedAt.
 */
export async function updateHandoverDetails(
  db: DbClient,
  actor: VerifiedActor,
  input: { handoverId: string; title: string; teamName: string; roleTitle?: string; description?: string; expectedUpdatedAt: string },
): Promise<string> {
  const updatedAt = await call(db, actor, "update_handover_details", {
    p_handover_id: input.handoverId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_title: input.title,
    p_team_name: input.teamName,
    p_role_title: input.roleTitle ?? null,
    p_description: input.description ?? null,
  });
  if (typeof updatedAt !== "string") throw new DbError("internal");
  return updatedAt;
}

/** `aiConfig` is the server's AiRunConfig snapshot (§11.8); its `provider` must match every source's consent. */
export async function startProcessing(
  db: DbClient,
  actor: VerifiedActor,
  input: {
    handoverId: string;
    pipelineVersion: string;
    aiConfig: { provider: string } & Record<string, unknown>;
    jobs: Array<{ stage: PipelineStage; sourceId: string | null; inputHashHex: string }>;
  },
): Promise<{ runId: string }> {
  const runId = asUuid(await call(db, actor, "start_processing", {
    p_handover_id: input.handoverId,
    p_pipeline_version: input.pipelineVersion,
    p_ai_config: input.aiConfig,
    p_jobs: input.jobs.map((j) => ({ stage: j.stage, sourceId: j.sourceId, inputHash: j.inputHashHex })),
  }));
  return { runId };
}

export const cancelProcessing = async (db: DbClient, actor: VerifiedActor, handoverId: string) =>
  void (await call(db, actor, "cancel_processing", { p_handover_id: handoverId }));

export async function publishHandover(db: DbClient, actor: VerifiedActor, input: { handoverId: string; summary?: string }): Promise<string> {
  return asUuid(await call(db, actor, "publish_handover", { p_handover_id: input.handoverId, p_summary: input.summary ?? null }));
}

export const startRevision = async (db: DbClient, actor: VerifiedActor, handoverId: string) =>
  void (await call(db, actor, "start_revision", { p_handover_id: handoverId }));

export const deleteHandover = async (db: DbClient, actor: VerifiedActor, handoverId: string) =>
  void (await call(db, actor, "delete_handover", { p_handover_id: handoverId }));

export const acknowledgePublication = async (
  db: DbClient,
  actor: VerifiedActor,
  input: { publicationId: string; statementVersion: string },
) =>
  void (await call(db, actor, "acknowledge_publication", {
    p_publication_id: input.publicationId,
    p_statement_version: input.statementVersion,
  }));

export const offerCreatorTransfer = async (db: DbClient, actor: VerifiedActor, input: { handoverId: string; toMemberId: string }) =>
  void (await call(db, actor, "offer_creator_transfer", { p_handover_id: input.handoverId, p_to_member_id: input.toMemberId }));

export const respondToCreatorTransfer = async (db: DbClient, actor: VerifiedActor, input: { handoverId: string; accept: boolean }) =>
  void (await call(db, actor, "respond_to_creator_transfer", { p_handover_id: input.handoverId, p_accept: input.accept }));

// ── Review (§5) ──────────────────────────────────────────────────────────────

const RETRYABLE_ATTEMPTS = 3; // first try + 2 retries (§5.5 item 7)

async function withLockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof DbError) || !error.retryable || attempt >= RETRYABLE_ATTEMPTS) throw error;
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 200 * attempt));
    }
  }
}

/** Dispatches a validated `reviewPoint` input (§11.3). */
export async function reviewPoint(db: DbClient, actor: VerifiedActor, input: ReviewPointValues): Promise<void> {
  switch (input.action) {
    case "approve":
      await call(db, actor, "approve_point", {
        p_point_id: input.pointId,
        p_expected_revision_id: input.expectedRevisionId,
        p_confirm_inferred: input.confirmInferred ?? false,
        p_resolution_note: input.resolutionNote ?? null,
        p_as_known_gap: input.asKnownGap ?? false,
      });
      return;
    case "reject":
      await call(db, actor, "reject_point", { p_point_id: input.pointId, p_reason: input.reason });
      return;
    case "reopen":
      await call(db, actor, "reopen_point", { p_point_id: input.pointId, p_note: input.note ?? null });
      return;
    case "edit":
      await call(db, actor, "edit_point", {
        p_point_id: input.pointId,
        p_expected_revision_id: input.expectedRevisionId,
        p_title: input.title,
        p_statement: input.statement,
        p_attributes: input.attributes,
        p_edit_reason: input.editReason,
      });
      return;
    case "confirm_inferred":
      await call(db, actor, "confirm_inferred", { p_point_id: input.pointId, p_note: input.note ?? null });
      return;
    case "resolve_conflict":
      await call(db, actor, "resolve_conflict", { p_point_id: input.pointId, p_resolution_note: input.resolutionNote });
      return;
    case "exclude_evidence":
      await call(db, actor, "exclude_evidence", {
        p_point_id: input.pointId,
        p_point_evidence_id: input.pointEvidenceId,
        p_reason: input.reason,
      });
      return;
    case "restore_evidence":
      await call(db, actor, "restore_evidence", { p_point_id: input.pointId, p_point_evidence_id: input.pointEvidenceId });
      return;
    case "change_access":
      await call(db, actor, "change_point_access", { p_point_id: input.pointId, p_access_override: input.accessOverride });
      return;
    case "resolve_privacy_review":
      // Same model: service role + verified actor, re-checked inside the function (§5.5 "Function").
      await withLockRetry(() =>
        callRpc(db, "resolve_privacy_review", {
          p_point_id: input.pointId,
          p_decisions: {
            expectedRevisionId: input.expectedRevisionId,
            decision: input.decision,
            redacted: input.redacted ?? null,
            surfaces: input.surfaces,
          },
          p_surfaces_digest: input.surfacesDigest,
          p_actor_profile_id: actor.profileId,
        }));
      return;
  }
}

/** createManualPointInput (schemas.ts, R8), already validated and masked by the action. */
export async function createManualPoint(db: DbClient, actor: VerifiedActor, input: CreateManualPointValues): Promise<string> {
  return asUuid(await call(db, actor, "create_manual_point", {
    p_handover_id: input.handoverId,
    p_category: input.category,
    p_title: input.title,
    p_statement: input.statement,
    p_attributes: input.attributes,
    p_inference_rationale: input.inferenceRationale ?? null,
    p_access_override: input.accessOverride ?? null,
    p_testimony_text: input.testimony?.text ?? null,
    p_testimony_access_level: input.testimony?.accessLevel ?? "everyone",
  }));
}

// ── Gaps (§6.15, §6.16, §12.3) ───────────────────────────────────────────────

/**
 * createGapQuestionInput (schemas.ts, R8). A question about a point takes the point's category: sending
 * both is refused here and again by the database (S10); the server raises accessLevel to the point's.
 */
export async function createGapQuestion(db: DbClient, actor: VerifiedActor, input: CreateGapQuestionValues): Promise<string> {
  if (input.pointId !== undefined && input.category !== undefined) throw new DbError("validation_failed");
  return asUuid(await call(db, actor, "create_gap_question", {
    p_handover_id: input.handoverId,
    p_point_id: input.pointId ?? null,
    p_category: input.category ?? null,
    p_question: input.question,
    p_context: input.context ?? null,
    p_priority: input.priority,
    p_access_level: input.accessLevel ?? "everyone",
    p_assigned_member_id: input.assignedMemberId ?? null,
  }));
}

/**
 * Returns the raw token ONCE (§12.4); main builds CreatedLink with routes.token.gaps(rawToken).
 * createGapLinkInput (R8, S11): uses are not an input; the database fixes them at 20.
 */
export async function createGapInterviewLink(
  db: DbClient,
  actor: VerifiedActor,
  input: CreateGapLinkValues,
): Promise<{ rawToken: string; tokenId: string; expiresAt: string }> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
  const tokenId = asUuid(await call(db, actor, "create_gap_interview_link", {
    p_handover_id: input.handoverId,
    p_token_hash: await tokenHashParam(rawToken),
    p_question_ids: input.questionIds,
    p_max_access_level: input.maxAccessLevel,
    p_expires_at: expiresAt,
  }));
  return { rawToken, tokenId, expiresAt };
}

/** Session path (§11.3 submitGapAnswers without a token). */
export async function submitGapAnswers(
  db: DbClient,
  actor: VerifiedActor,
  answers: Array<{ gapQuestionId: string; answerText: string }>,
): Promise<number> {
  return Number(await call(db, actor, "submit_gap_answers", { p_answers: answers }));
}

/**
 * Token path: no account (D8); a held, unknown or out-of-scope question fails as not_found (§5.5).
 * M6: per-client and per-token submission limits are consumed first; the link itself allows ≤ 20 uses.
 */
export async function submitGapAnswersWithToken(
  db: DbClient,
  input: {
    rawToken: string;
    answererLabel: string;
    answers: Array<{ gapQuestionId: string; answerText: string }>;
    clientIp: string | null;
  },
): Promise<number> {
  const tokenHashHex = await sha256Hex(input.rawToken);
  await consumeRateLimits(db, "gap_interview_submit", { client: await clientSubject(input.clientIp), tokenHashHex });
  return Number(await callRpc(db, "submit_gap_answers_with_token", {
    p_token_hash: hexToBytea(tokenHashHex),
    p_answerer_label: input.answererLabel,
    p_answers: input.answers,
  }));
}

export const reviewGapAnswer = async (
  db: DbClient,
  actor: VerifiedActor,
  input: { answerId: string; decision: "accept" | "reject"; note?: string },
) =>
  void (await call(db, actor, "review_gap_answer", {
    p_answer_id: input.answerId,
    p_decision: input.decision,
    p_note: input.note ?? null,
  }));

/** Creator: any token of the handover. Other review roles: Gap Interview links only (§11.3). */
export const revokeAccessToken = async (db: DbClient, actor: VerifiedActor, tokenId: string) =>
  void (await call(db, actor, "revoke_access_token", { p_token_id: tokenId }));

// ── Members (§6.3, §12.3) ────────────────────────────────────────────────────

/** Creator only. Returns the raw invite token ONCE; build the URL with routes.token.handover(rawToken). */
export async function inviteMember(
  db: DbClient,
  actor: VerifiedActor,
  input: { handoverId: string; email: string; role: MemberRole; clearance?: AccessLevel; expiresInDays: number },
): Promise<{ rawToken: string; tokenId: string; expiresAt: string }> {
  const rawToken = generateRawToken();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
  const tokenId = asUuid(await call(db, actor, "invite_member", {
    p_handover_id: input.handoverId,
    p_email: input.email,
    p_role: input.role,
    p_clearance: input.clearance ?? null,
    p_token_hash: await tokenHashParam(rawToken),
    p_expires_at: expiresAt,
  }));
  return { rawToken, tokenId, expiresAt };
}

export const updateMemberClearance = async (db: DbClient, actor: VerifiedActor, input: { memberId: string; clearance: AccessLevel }) =>
  void (await call(db, actor, "update_member_clearance", { p_member_id: input.memberId, p_clearance: input.clearance }));

export const removeMember = async (db: DbClient, actor: VerifiedActor, memberId: string) =>
  void (await call(db, actor, "remove_member", { p_member_id: memberId }));

// ── Sources (§6.5, §10.3) ────────────────────────────────────────────────────

export async function createSource(
  db: DbClient,
  actor: VerifiedActor,
  input: { handoverId: string; kind: SourceKind; fileName: string; mimeType: string; sizeBytes: number; sha256: string },
): Promise<string> {
  return asUuid(await call(db, actor, "create_source", {
    p_handover_id: input.handoverId,
    p_kind: input.kind,
    p_file_name: input.fileName,
    p_mime_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
    p_sha256_hex: input.sha256,
  }));
}

/** `aiProvider` is the server-configured provider named in the consent statement (§11.8 rule 5). */
export const recordSourceConsent = async (
  db: DbClient,
  actor: VerifiedActor,
  input: {
    sourceId: string;
    consentStatementVersion: string;
    aiProvider: string;
    accessLevel: AccessLevel;
    timezone: string;
    dateOrder?: "dmy" | "mdy" | "ymd";
    documentDate?: string;
  },
) =>
  void (await call(db, actor, "record_source_consent", {
    p_source_id: input.sourceId,
    p_statement_version: input.consentStatementVersion,
    p_ai_provider: input.aiProvider,
    p_access_level: input.accessLevel,
    p_timezone: input.timezone,
    p_date_order: input.dateOrder ?? null,
    p_document_date: input.documentDate ?? null,
  }));

/**
 * addExclusionInput (schemas.ts, R8). Pre-parse only (§10.3); parsed sources take eraseParticipant. The
 * database derives the handover from the source (S12). A handover-wide NAME exclusion is only detected in
 * other sources and needs confirmIdentityMatch there (§6.8.1, D29).
 */
export async function addExclusion(db: DbClient, actor: VerifiedActor, input: AddExclusionValues): Promise<{ exclusionId: string }> {
  const base = { p_source_id: input.sourceId, p_kind: input.kind, p_reason: input.reason ?? null };
  let args: Record<string, unknown>;
  switch (input.kind) {
    case "participant":
      args = {
        ...base,
        p_scope: input.scope,
        p_identity_kind: input.identityKind,
        p_participant_identity_hash_hex: input.participantIdentityHash,
        p_pepper_version: input.identityPepperVersion,
      };
      break;
    case "conversation":
      args = {
        ...base,
        p_scope: "source",
        p_conversation_local_id: input.conversationLocalId,
        p_parse_timezone: input.parseContext.timezone,
        p_parse_date_order: input.parseContext.dateOrder,
        p_parser_version: input.parseContext.parserVersion,
      };
      break;
    case "date_range":
      args = { ...base, p_scope: input.scope, p_range_start: input.rangeStart, p_range_end: input.rangeEnd };
      break;
  }
  return { exclusionId: asUuid(await call(db, actor, "add_exclusion", args)) };
}

/** confirmIdentityMatchInput (R8, §6.8.1). Creator only; before the source is parsed and outside a run. */
export const confirmIdentityMatch = async (db: DbClient, actor: VerifiedActor, input: ConfirmIdentityMatchInput) =>
  void (await call(db, actor, "confirm_identity_match", {
    p_source_id: input.sourceId,
    p_exclusion_id: input.exclusionId,
    p_decision: input.decision,
  }));

/** Soft delete. Returns the raw storage path (or null) for the caller to delete AFTER this commits. */
export async function removeSource(db: DbClient, actor: VerifiedActor, sourceId: string): Promise<string | null> {
  const path = await call(db, actor, "remove_source", { p_source_id: sourceId });
  return typeof path === "string" ? path : null;
}

// ── Privacy, account and purge ───────────────────────────────────────────────

/** What an erasure of one participant row covers (§12.8, R8); written into the manifest first. */
export interface ErasureTarget {
  handoverId: string;
  identityKind: IdentityKind;
  identityHashHex: string;
  pepperVersion: IdentityPepperVersion;
  /** The one source a NAME erasure is limited to; null for phone (handover-wide). */
  scopeSourceId: string | null;
}

/**
 * Creator only (server-only). Resolves eraseParticipant's participantId to the identity and scope that the
 * manifest entry, the receipt and erase_participant must all name. The hash stays on the server.
 */
export async function getErasureTarget(db: DbClient, actor: VerifiedActor, participantId: string): Promise<ErasureTarget> {
  const r = (await call(db, actor, "erasure_target", { p_participant_id: participantId })) as Record<string, unknown> | null;
  const kind = r?.identityKind;
  const scope = r?.scopeSourceId ?? null;
  if (
    !r ||
    (kind !== "phone" && kind !== "name") ||
    typeof r.identityHashHex !== "string" ||
    !/^[0-9a-f]{64}$/.test(r.identityHashHex) ||
    r.pepperVersion !== "p1" ||
    (kind === "name") !== (typeof scope === "string")
  ) {
    throw new DbError("internal");
  }
  return {
    handoverId: asUuid(r.handoverId),
    identityKind: kind,
    identityHashHex: r.identityHashHex,
    pepperVersion: "p1",
    scopeSourceId: scope === null ? null : asUuid(scope),
  };
}

/**
 * §12.8 (security fixes H2, N4; R8 S7). Rejected unless the receipt is a manifest receipt that lib/recovery's
 * registered verifier accepts for exactly this erasure: event, handover, identity kind, hash, pepper version
 * and scope source (see recovery-gate.ts). Until lib/recovery exists this always throws
 * precondition_failed, and the database grants the function to no application role (D27 open).
 * A NAME erasure is limited to scopeSourceId; same-name participants elsewhere are only counted.
 */
export async function eraseParticipant(
  db: DbClient,
  actor: VerifiedActor,
  input: ErasureTarget & { erasureId: string; receipt: ManifestReceipt },
): Promise<ErasureReport & { alreadyApplied: boolean }> {
  if ((input.identityKind === "name") !== (input.scopeSourceId !== null)) throw new DbError("validation_failed");
  await assertManifestReceipt(input.receipt, {
    kind: "participant_erasure",
    eventId: input.erasureId,
    handoverId: input.handoverId,
    identityKind: input.identityKind,
    identityHashHex: input.identityHashHex, // N4: the receipt must name exactly this identity ...
    pepperVersion: input.pepperVersion, // ... pepper version ...
    scopeSourceId: input.scopeSourceId, // ... and scope source (R8)
  });
  return (await withLockRetry(() =>
    callRpc(db, "erase_participant", {
      p_erasure_id: input.erasureId,
      p_handover_id: input.handoverId,
      p_identity_kind: input.identityKind,
      p_identity_hash: hexToBytea(input.identityHashHex),
      p_identity_pepper_version: input.pepperVersion,
      p_scope_source_id: input.scopeSourceId,
      p_actor_profile_id: actor.profileId,
    }))) as ErasureReport & { alreadyApplied: boolean };
}

/**
 * §12.6 (security fix H2). Same manifest gate as eraseParticipant. `actor` is the creator confirming an
 * immediate purge during account deletion, or null for the retention sweep.
 */
export async function purgeHandover(
  db: DbClient,
  input: { eventId: string; handoverId: string; actor: VerifiedActor | null; receipt: ManifestReceipt },
): Promise<boolean> {
  await assertManifestReceipt(input.receipt, { kind: "handover_purge", eventId: input.eventId, handoverId: input.handoverId });
  return Boolean(await callRpc(db, "purge_handover", {
    p_event_id: input.eventId,
    p_handover_id: input.handoverId,
    p_actor_profile_id: input.actor?.profileId ?? null,
  }));
}

/**
 * D25 (§12.9 item 3): checks a deleteAccount request on the SERVER before any manifest write, purge or
 * deletion, independently of the UI. The input is untrusted: it is parsed with the canonical
 * deleteAccountInput (confirm must be exactly "DELETE"; each purge id once), then the database checks the
 * same rules again plus ownership: every listed id is a handover the actor created (else not_found) and
 * every handover the actor still created is listed (else precondition_failed). Returns the ids to purge.
 */
export async function checkAccountDeletion(db: DbClient, actor: VerifiedActor, input: unknown): Promise<string[]> {
  const parsed = deleteAccountInput.safeParse(input);
  if (!parsed.success) throw new DbError("validation_failed");
  const r = (await call(db, actor, "check_account_deletion", {
    p_confirmation: parsed.data.confirm,
    p_purge_handover_ids: parsed.data.purgeHandoverIds.map((id) => id.toLowerCase()),
  })) as { purgeHandoverIds?: unknown } | null;
  if (!r || !Array.isArray(r.purgeHandoverIds)) throw new DbError("internal");
  return r.purgeHandoverIds.map(asUuid);
}

/**
 * §12.9 database part, for the verified actor deleting their own account. The typed confirmation is
 * required here too (D25) and checked again by the database. Afterwards the caller soft-deletes the auth
 * user (Admin API deleteUser(id, true)) — UNVERIFIED on Supabase (assumption 9).
 */
export async function deleteAccountData(
  db: DbClient,
  actor: VerifiedActor,
  input: { confirm: string },
): Promise<Record<string, number>> {
  if (input?.confirm !== ACCOUNT_DELETION_CONFIRMATION) throw new DbError("validation_failed");
  return (await callRpc(db, "delete_account_data", {
    p_profile_id: actor.profileId,
    p_confirmation: input.confirm,
  })) as Record<string, number>;
}

/** Read (user-scoped client): the caller's own created handovers. */
export async function getAccountDeletionBlockers(userDb: DbClient) {
  return (await callRpc(userDb, "get_account_deletion_blockers")) as Array<{ id: string; title: string; deleted: boolean }>;
}

// ── Invitations (§12.3) ──────────────────────────────────────────────────────

/**
 * Before sending an invitation magic link: the address it must go to. Server-only: never send it to the
 * browser. M6: per-client and per-token magic-link limits are consumed first (committed even if the token
 * turns out to be invalid).
 */
export async function peekMemberInvite(
  db: DbClient,
  rawToken: string,
  clientIp: string | null,
): Promise<{ recipientEmail: string; handoverId: string }> {
  const tokenHashHex = await sha256Hex(rawToken);
  await consumeRateLimits(db, "invite_magic_link", { client: await clientSubject(clientIp), tokenHashHex });
  const data = (await callRpc(db, "peek_member_invite", { p_token_hash: hexToBytea(tokenHashHex) })) as {
    recipient_email: string;
    handover_id: string;
  };
  return { recipientEmail: data.recipient_email, handoverId: data.handover_id };
}

/**
 * Security fix H3: the database reads the address and its confirmation state from auth.users; the caller
 * supplies only the verified actor. An actor without a confirmed address is refused before any call, with
 * the same token_invalid the database would return (never say which check failed, §3.2).
 */
export async function redeemMemberInvite(
  db: DbClient,
  actor: VerifiedActor,
  rawToken: string,
  clientIp: string | null,
): Promise<{ handoverId: string; role: MemberRole; memberId: string }> {
  const tokenHashHex = await sha256Hex(rawToken);
  await consumeRateLimits(db, "invite_redeem", { client: await clientSubject(clientIp), tokenHashHex }); // M6
  if (!canRedeemInvitation(actor)) throw new DbError("token_invalid");
  const data = (await callRpc(db, "redeem_member_invite", {
    p_token_hash: hexToBytea(tokenHashHex),
    p_profile_id: actor.profileId,
  })) as { handover_id: string; role: MemberRole; member_id: string };
  return { handoverId: data.handover_id, role: data.role, memberId: data.member_id };
}
