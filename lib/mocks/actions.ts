"use server";

/**
 * Mock server actions (§11.3, §13.1: "the UI calls mock action stubs in lib/mocks/actions.ts").
 *
 * Signatures follow §11.3 and inputs are validated with the canonical Zod schemas. Permission and
 * lifecycle checks mirror §8.2 and §9.1 so the UI meets the same errors it will meet in production.
 * Every action returns `Result<T>` and never throws across the client boundary.
 */

import { refresh } from "next/cache";
import { z } from "zod";

import type { AppError, Result } from "@/lib/contracts/api";
import type {
  AccountDeletionBlockers,
  CreatedLink,
  ErasureReport,
  GapQuestionSummary,
  HandoverSummary,
  PointDetail,
  PublicationSummary,
  SourceSummary,
  SourceUploadTicket,
} from "@/lib/contracts/dto";
import type { SourcePreview } from "@/lib/contracts/parser";
import {
  MAX_SOURCE_BYTES,
  acknowledgePublicationInput,
  addExclusionInput,
  confirmIdentityMatchInput,
  createGapLinkInput,
  createGapQuestionInput,
  createHandoverInput,
  createSourceUploadInput,
  deleteAccountInput,
  eraseParticipantInput,
  handoverIdInput,
  inviteMemberInput,
  memberIdInput,
  offerCreatorTransferInput,
  parsePointAttributes,
  publishHandoverInput,
  recordSourceConsentInput,
  respondToCreatorTransferInput,
  reviewGapAnswerInput,
  reviewPointInput,
  revokeAccessTokenInput,
  sourceIdInput,
  submitGapAnswersInput,
  updateMemberClearanceInput,
} from "@/lib/contracts/schemas";
import type {
  AcknowledgePublicationInput,
  AddExclusionInput,
  ConfirmIdentityMatchInput,
  CreateGapLinkInput,
  CreateGapQuestionInput,
  CreateHandoverInput,
  CreateSourceUploadInput,
  DeleteAccountInput,
  EraseParticipantInput,
  InviteMemberInput,
  OfferCreatorTransferInput,
  PublishHandoverInput,
  RecordSourceConsentInput,
  RespondToCreatorTransferInput,
  ReviewGapAnswerInput,
  ReviewPointInput,
  RevokeAccessTokenInput,
  SubmitGapAnswersInput,
  UpdateMemberClearanceInput,
} from "@/lib/contracts/schemas";
import type { AccessLevel } from "@/lib/contracts/enums";
import { routes } from "@/lib/routes";

import { isActiveIncomingInvite, previewFor, tokenStatus } from "./exclusions";
import {
  accessRank,
  activeMember,
  computeReadiness,
  currentRevision,
  gapQuestionAccessLevel,
  isReviewRole,
  maxAccess,
  pointAccessFloor,
  pointAccessLevel,
  pointStatus,
  profileLabel,
  settleReverification,
  snapshotPoint,
  toGapQuestionSummary,
  toPointDetail,
  toSourceSummary,
} from "./derive";
import { NS, newId, newToken, seedId } from "./ids";
import { mockMaskText } from "./mask";
import { openCreatorOffer, toHandoverSummary } from "./queries";
import { getStore } from "./store";
import type { MockLink, MockPoint, MockStore, MockToken } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

type Fail = { ok: false; error: AppError };
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (code: AppError["code"], message: string, extra: Partial<AppError> = {}): Fail => ({
  ok: false,
  error: { code, message, retryable: false, ...extra },
});
const notFound = () => fail("not_found", "We couldn't find that.");
const forbidden = (message = "You don't have permission to do that.") => fail("forbidden", message);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function parse<S extends z.ZodType>(schema: S, input: unknown): { ok: true; data: z.output<S> } | Fail {
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  const flat = z.flattenError(r.error);
  return fail("validation_failed", "Some fields need attention.", {
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  });
}

function context(store: MockStore, handoverId: string) {
  const h = store.handovers.find((x) => x.id === handoverId && !x.deletedAt);
  if (!h) return null;
  const member = activeMember(store, handoverId, store.viewerId);
  if (!member) return null;
  const isCreator = h.createdBy === store.viewerId;
  return { h, member, isCreator, review: isReviewRole(member.role) };
}

function touch(store: MockStore, handoverId: string) {
  const h = store.handovers.find((x) => x.id === handoverId);
  if (h) h.updatedAt = nowIso();
}

function done<T>(r: Result<T>): Result<T> {
  if (r.ok) refresh();
  return r;
}

const viewerLabel = (store: MockStore) => profileLabel(store, store.viewerId);
/** `item` is visible at `clearance` (§8.1). */
const accessAllows = (item: Parameters<typeof accessRank>[0], clearance: Parameters<typeof accessRank>[0]) => accessRank(item) <= accessRank(clearance);

// ── Handovers ────────────────────────────────────────────────────────────────

export async function createHandover(input: CreateHandoverInput): Promise<Result<HandoverSummary>> {
  await sleep(350);
  const v = parse(createHandoverInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const me = store.profiles.find((p) => p.id === store.viewerId);
  if (!me) return fail("unauthenticated", "Sign in to start a handover.");
  const id = newId();
  const at = nowIso();
  store.handovers.push({
    id,
    title: v.data.title,
    teamName: v.data.teamName,
    roleTitle: v.data.roleTitle ?? null,
    description: v.data.description ?? null,
    state: "draft",
    createdBy: me.id,
    currentPublicationId: null,
    createdAt: at,
    updatedAt: at,
    evidenceAsOf: null,
    lastError: null,
    deletedAt: null,
    hadSuccessfulRun: false,
    pendingCreatorTransfer: null,
    purgedAt: null,
  });
  store.members.push({
    id: newId(),
    handoverId: id,
    profileId: me.id,
    displayName: me.displayName,
    email: me.email,
    role: v.data.creatorRole,
    clearance: "reviewer_only",
    ackRequired: false,
    removedAt: null,
  });
  return done(ok(toHandoverSummary(store, store.handovers.at(-1)!, me.id)));
}

export async function startProcessing(input: { handoverId: string }): Promise<Result<{ runId: string }>> {
  await sleep(400);
  const v = parse(handoverIdInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.isCreator && c.member.role !== "outgoing") return forbidden("Only the creator or the outgoing member can start processing.");
  if (c.h.state !== "draft" && c.h.state !== "in_review") return fail("invalid_transition", "Processing can't start from the current state.");
  if (store.runs.some((r) => r.handoverId === c.h.id && (r.status === "queued" || r.status === "running"))) {
    return fail("conflict", "A processing run is already in progress.");
  }
  const sources = store.sources.filter((s) => s.handoverId === c.h.id && !s.removedAt);
  if (sources.length === 0) return fail("precondition_failed", "Add at least one source first.");
  const missingConsent = sources.filter((s) => !s.consentRecordedAt);
  if (missingConsent.length > 0) {
    return fail("precondition_failed", `Record consent for ${missingConsent.length === 1 ? "1 source" : `${missingConsent.length} sources`} before processing.`);
  }
  // §10.3 step 3: a source with an unanswered identity match, or an exclusion chosen on another
  // preview, would fail its parse before anything is persisted. The mock refuses up front.
  for (const s of sources.filter((x) => x.state !== "parsed")) {
    const r = previewFor(store, s);
    if (!r.ok) {
      s.errorCode = "exclusion_context_mismatch";
      return fail("precondition_failed", `Confirm the excluded conversations in ${s.title} again on a fresh preview.`, { details: { sourceId: s.id, errorCode: "exclusion_context_mismatch" } });
    }
    if (r.data.identityMatches.length > 0) {
      s.errorCode = "identity_confirmation_required";
      return fail("precondition_failed", `Confirm whether the people matched in ${s.title} are the ones who asked to be left out.`, { details: { sourceId: s.id, errorCode: "identity_confirmation_required" } });
    }
    s.errorCode = null;
  }
  const runId = newId();
  store.runs.push({ id: runId, handoverId: c.h.id, status: "queued", startedAt: nowIso(), durationMs: 24_000, finishedAt: null, error: null });
  c.h.state = "processing";
  c.h.lastError = null;
  touch(store, c.h.id);
  return done(ok({ runId }));
}

export async function cancelProcessing(input: { handoverId: string }): Promise<Result<null>> {
  await sleep(250);
  const v = parse(handoverIdInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.isCreator) return forbidden("Only the creator can cancel processing.");
  const run = store.runs.find((r) => r.handoverId === c.h.id && (r.status === "queued" || r.status === "running"));
  if (!run) return fail("invalid_transition", "Nothing is processing.");
  run.status = "cancelled";
  run.finishedAt = nowIso();
  c.h.state = c.h.hadSuccessfulRun ? "in_review" : "draft";
  touch(store, c.h.id);
  return done(ok(null));
}

export async function publishHandover(input: PublishHandoverInput): Promise<Result<PublicationSummary>> {
  await sleep(500);
  const v = parse(publishHandoverInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.isCreator) return forbidden("Only the creator can publish (D1).");
  if (c.h.state !== "in_review") return fail("invalid_transition", "Only a handover in review can be published.");
  const readiness = computeReadiness(store, c.h.id, c.member.clearance);
  if (!readiness.canPublish) {
    return fail("precondition_failed", "Resolve the readiness blockers before publishing.", {
      details: { blockers: readiness.blockers.length },
    });
  }
  const points = store.points.filter(
    (p) => p.handoverId === c.h.id && p.reviewState === "approved" && (pointStatus(p) !== "missing" || p.approvedAsKnownGap),
  );
  const version = store.publications.filter((p) => p.handoverId === c.h.id).reduce((n, p) => Math.max(n, p.version), 0) + 1;
  const id = newId();
  const publishedAt = nowIso();
  store.publications.push({
    id,
    handoverId: c.h.id,
    version,
    publishedAt,
    publishedBy: store.viewerId,
    summary: v.data.summary?.trim() ? mockMaskText(v.data.summary.trim()) : null,
    points: points.map((p) => snapshotPoint(store, p, (pid) => profileLabel(store, pid))),
    acknowledgements: [],
  });
  c.h.currentPublicationId = id;
  c.h.state = "approved";
  touch(store, c.h.id);
  return done(ok({ publicationId: id, handoverId: c.h.id, version, publishedAt, handoverState: c.h.state }));
}

export async function startRevision(input: { handoverId: string }): Promise<Result<HandoverSummary>> {
  await sleep(300);
  const v = parse(handoverIdInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.isCreator) return forbidden("Only the creator can start a revision.");
  if (c.h.state !== "approved" && c.h.state !== "acknowledged") return fail("invalid_transition", "Only a published handover can be revised.");
  c.h.state = "in_review";
  touch(store, c.h.id);
  return done(ok(toHandoverSummary(store, c.h, store.viewerId)));
}

export async function deleteHandover(input: { handoverId: string }): Promise<Result<null>> {
  await sleep(400);
  const v = parse(handoverIdInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.isCreator) return forbidden("Only the creator can delete a handover.");
  // Soft delete: hidden from everyone now, hard-purged after the 30-day grace period (§6.2, D17).
  c.h.deletedAt = nowIso();
  c.h.pendingCreatorTransfer = null;
  for (const t of store.tokens.filter((t) => t.handoverId === c.h.id)) t.revokedAt ??= nowIso();
  return done(ok(null));
}

export async function offerCreatorTransfer(input: OfferCreatorTransferInput): Promise<Result<null>> {
  await sleep(300);
  const v = parse(offerCreatorTransferInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.isCreator) return forbidden("Only the creator can offer creatorship.");
  const target = store.members.find((m) => m.id === v.data.toMemberId && m.handoverId === c.h.id && !m.removedAt);
  if (!target) return notFound();
  // §12.9: a self-target is rejected on the server with validation_failed, not only hidden in the UI.
  if (target.profileId === c.h.createdBy) {
    return fail("validation_failed", "You can't transfer creatorship to yourself.", { fieldErrors: { toMemberId: ["Choose another member"] } });
  }
  if (!isReviewRole(target.role)) return fail("invalid_transition", "Creatorship can only go to an outgoing or reviewer member.");
  // At most one open offer per handover: a new offer replaces the previous one.
  c.h.pendingCreatorTransfer = { toMemberId: target.id, offeredAt: nowIso(), offeredBy: store.viewerId };
  touch(store, c.h.id);
  return done(ok(null));
}

/** The offered member accepts or declines (§12.9). Creatorship is never assigned without consent. */
export async function respondToCreatorTransfer(input: RespondToCreatorTransferInput): Promise<Result<null>> {
  await sleep(350);
  const v = parse(respondToCreatorTransferInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  const offer = openCreatorOffer(store, c.h);
  // Anyone but the offered member gets the same not_found: the offer is not theirs to see (§8.5).
  if (!offer || offer.toMemberId !== c.member.id) return notFound();
  // transfer_creator re-checks every invariant (§12.9).
  if (c.h.createdBy === store.viewerId || !isReviewRole(c.member.role)) return fail("invalid_transition", "This offer can no longer be accepted.");
  if (v.data.accept) c.h.createdBy = store.viewerId;
  c.h.pendingCreatorTransfer = null;
  touch(store, c.h.id);
  return done(ok(null));
}

// ── Sources ──────────────────────────────────────────────────────────────────

const MAX_SOURCES_PER_HANDOVER = 10; // D15

export async function createSourceUpload(input: CreateSourceUploadInput): Promise<Result<SourceUploadTicket>> {
  await sleep(200);
  const v = parse(createSourceUploadInput, input);
  if (!v.ok) {
    if (typeof input?.sizeBytes === "number" && input.sizeBytes > MAX_SOURCE_BYTES) {
      return fail("payload_too_large", "Files can be up to 25 MB.");
    }
    return v;
  }
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.isCreator && c.member.role !== "outgoing") return forbidden("Only the creator or the outgoing member can add sources.");
  if (store.sources.filter((s) => s.handoverId === c.h.id && !s.removedAt).length >= MAX_SOURCES_PER_HANDOVER) {
    return fail("precondition_failed", "A handover can have up to 10 sources.");
  }
  const id = newId();
  store.sources.push({
    id,
    handoverId: c.h.id,
    kind: v.data.kind,
    title: v.data.fileName,
    state: "pending_upload",
    accessLevel: "everyone",
    sizeBytes: v.data.sizeBytes,
    sha256: v.data.sha256,
    consentRecordedAt: null,
    rawDeletedAt: null,
    firstMessageAt: null,
    lastMessageAt: null,
    messageCount: null,
    maskingCounts: null,
    errorCode: null,
    timezone: "Asia/Kolkata",
    documentDate: null,
    basePreview: null,
    removedAt: null,
  });
  return ok({
    sourceId: id,
    signedUploadUrl: `mock://storage/raw/${c.h.id}/${id}`,
    token: newToken(),
    expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  });
}

function ownSource(store: MockStore, sourceId: string) {
  const s = store.sources.find((x) => x.id === sourceId && !x.removedAt);
  if (!s) return null;
  const c = context(store, s.handoverId);
  if (!c || (!c.isCreator && c.member.role !== "outgoing")) return null;
  // The acting profile from the (mock) session, as `auth.getUser()` would give it (D35).
  return { s, c, actorId: store.viewerId };
}

export async function confirmSourceUploaded(input: { sourceId: string }): Promise<Result<SourceSummary>> {
  await sleep(250);
  const v = parse(sourceIdInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const o = ownSource(store, v.data.sourceId);
  if (!o) return notFound();
  o.s.state = "uploaded";
  touch(store, o.s.handoverId);
  return done(ok(toSourceSummary(o.s)));
}

/** Read-only (§10.3 step 1): applies the same rules as the final parse (D33) and persists nothing. */
export async function previewSource(input: { sourceId: string }): Promise<Result<SourcePreview>> {
  await sleep(600);
  const v = parse(sourceIdInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const o = ownSource(store, v.data.sourceId);
  if (!o) return notFound();
  if (o.s.rawDeletedAt) return fail("precondition_failed", "The raw upload has already been processed and deleted.");
  const r = previewFor(store, o.s);
  if (!r.ok) return { ok: false, error: { code: r.error.code, message: r.error.message, retryable: r.error.retryable } };
  return ok(r.data);
}

export async function recordSourceConsent(input: RecordSourceConsentInput): Promise<Result<SourceSummary>> {
  await sleep(200);
  const v = parse(recordSourceConsentInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const o = ownSource(store, v.data.sourceId);
  if (!o) return notFound();
  o.s.consentRecordedAt = nowIso();
  o.s.accessLevel = v.data.accessLevel;
  o.s.timezone = v.data.timezone;
  o.s.documentDate = v.data.documentDate ?? null;
  touch(store, o.s.handoverId);
  return done(ok(toSourceSummary(o.s)));
}

/** Pre-parse only (§10.3 step 2). The server derives the handover from the source. Append-only. */
export async function addExclusion(input: AddExclusionInput): Promise<Result<{ exclusionId: string }>> {
  await sleep(150);
  const v = parse(addExclusionInput, input);
  if (!v.ok) return v;
  const e = v.data;
  const store = getStore();
  const o = ownSource(store, e.sourceId);
  if (!o) return notFound();
  if (o.s.state === "parsed" || o.s.rawDeletedAt) {
    return fail("invalid_transition", "This source is already processed. A late opt-out is a participant erasure.");
  }
  const handoverWide = e.kind !== "conversation" && e.scope === "handover";
  if (
    e.kind === "participant" &&
    handoverWide &&
    store.exclusions.some(
      (x) =>
        x.handoverId === o.s.handoverId &&
        x.kind === "participant" &&
        x.sourceId === null &&
        x.identityKind === e.identityKind &&
        x.identityHash === e.participantIdentityHash &&
        x.identityPepperVersion === e.identityPepperVersion,
    )
  ) {
    return fail("conflict", "This person is already left out of the handover.");
  }
  const id = newId();
  store.exclusions.push({
    id,
    handoverId: o.s.handoverId,
    sourceId: handoverWide ? null : o.s.id,
    kind: e.kind,
    identityKind: e.kind === "participant" ? e.identityKind : null,
    identityHash: e.kind === "participant" ? e.participantIdentityHash.toLowerCase() : null,
    identityPepperVersion: e.kind === "participant" ? e.identityPepperVersion : null,
    conversationLocalId: e.kind === "conversation" ? e.conversationLocalId : null,
    parseContext: e.kind === "conversation" ? e.parseContext : null,
    rangeStart: e.kind === "date_range" ? e.rangeStart : null,
    rangeEnd: e.kind === "date_range" ? e.rangeEnd : null,
    reason: e.reason ? mockMaskText(e.reason) : null,
    // Attribution is derived from the session, never from the input (addExclusionInput has no
    // requester field). Only a source manager reaches this point (ownSource: creator or outgoing),
    // i.e. the uploader; `participant_request` rows come from the erasure path (§12.8).
    requestedVia: "uploader",
    requestedBy: o.actorId,
    createdAt: nowIso(),
  });
  touch(store, o.s.handoverId);
  return ok({ exclusionId: id });
}

/** Creator decision on a `detect` match: is this the person who asked to be left out (§6.8.1)? */
export async function confirmIdentityMatch(input: ConfirmIdentityMatchInput): Promise<Result<null>> {
  await sleep(200);
  const v = parse(confirmIdentityMatchInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const o = ownSource(store, v.data.sourceId);
  if (!o) return notFound();
  if (!o.c.isCreator) return forbidden("Only the creator can confirm who someone is.");
  if (o.s.state === "parsed" || o.s.rawDeletedAt) return fail("invalid_transition", "This source is already processed.");
  const ex = store.exclusions.find((x) => x.id === v.data.exclusionId && x.handoverId === o.s.handoverId);
  if (!ex) return notFound();
  if (ex.kind !== "participant" || ex.identityKind !== "name" || ex.sourceId !== null) {
    return fail("validation_failed", "Only a handover-wide name exclusion needs a confirmation.");
  }
  // One decision per (source, exclusion); changing it before the final parse replaces it.
  store.identityConfirmations = store.identityConfirmations.filter((x) => !(x.sourceId === o.s.id && x.exclusionId === ex.id));
  store.identityConfirmations.push({ sourceId: o.s.id, exclusionId: ex.id, decision: v.data.decision, decidedBy: store.viewerId, decidedAt: nowIso() });
  touch(store, o.s.handoverId);
  return ok(null);
}

export async function removeSource(input: { sourceId: string }): Promise<Result<null>> {
  await sleep(200);
  const v = parse(sourceIdInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const o = ownSource(store, v.data.sourceId);
  if (!o) return notFound();
  o.s.removedAt = nowIso();
  o.s.state = "removed";
  touch(store, o.s.handoverId);
  return done(ok(null));
}

// ── Review ───────────────────────────────────────────────────────────────────

function reviewContext(store: MockStore, pointId: string) {
  const p = store.points.find((x) => x.id === pointId);
  if (!p) return null;
  const c = context(store, p.handoverId);
  if (!c || !c.review || accessRank(pointAccessLevel(p)) > accessRank(c.member.clearance)) return null;
  return { p, c };
}

function history(store: MockStore, p: MockPoint, action: PointDetail["reviewHistory"][number]["action"], note: string | null = null, actor: string | null = viewerLabel(store)) {
  p.reviewHistory.push({ action, actorLabel: actor, note, createdAt: nowIso() });
}

/** §4.3: if an approved point's status changes, it goes back to pending (auto_reopen). */
function withAutoReopen(store: MockStore, p: MockPoint, mutate: () => void) {
  const before = pointStatus(p);
  mutate();
  if (p.reviewState === "approved" && pointStatus(p) !== before) {
    p.reviewState = "pending";
    history(store, p, "auto_reopen", `Evidence status changed from ${before} to ${pointStatus(p)}.`, null);
  }
}

export async function reviewPoint(input: ReviewPointInput): Promise<Result<PointDetail>> {
  await sleep(300);
  const v = parse(reviewPointInput, input);
  if (!v.ok) return v;
  const a = v.data;
  const store = getStore();
  const rc = reviewContext(store, a.pointId);
  if (!rc) return notFound();
  const { p, c } = rc;
  settleReverification(p);
  if (p.privacyReview === "required" && a.action !== "resolve_privacy_review" && a.action !== "change_access") {
    return fail("invalid_transition", "Resolve the privacy review first.");
  }
  const rev = currentRevision(p);
  const status = pointStatus(p);
  const me = store.viewerId;
  const at = nowIso();

  switch (a.action) {
    case "approve": {
      if (a.expectedRevisionId !== rev.id) return fail("conflict", "This point changed since you opened it. Review the latest version.");
      if (p.reviewState === "approved") return fail("invalid_transition", "Already approved.");
      if (status === "inferred" && !p.inferredConfirmation && !a.confirmInferred) {
        return fail("validation_failed", "Confirm the inferred point before approving.", { fieldErrors: { confirmInferred: ["Required for inferred points"] } });
      }
      if (status === "conflicting" && !p.conflictResolution && !a.resolutionNote) {
        return fail("validation_failed", "Add a resolution note before approving.", { fieldErrors: { resolutionNote: ["Required for conflicting points"] } });
      }
      if (status === "missing" && !a.asKnownGap) {
        return fail("validation_failed", "Missing points can only be approved as a known gap.", { fieldErrors: { asKnownGap: ["Required for missing points"] } });
      }
      if (status === "inferred" && a.confirmInferred && !p.inferredConfirmation) p.inferredConfirmation = { by: me, at };
      if (status === "conflicting" && a.resolutionNote) p.conflictResolution = { note: mockMaskText(a.resolutionNote), by: me, at };
      p.approvedAsKnownGap = status === "missing";
      p.reviewState = "approved";
      history(store, p, "approve", a.resolutionNote ? mockMaskText(a.resolutionNote) : status === "missing" ? "Approved as a known gap." : null);
      break;
    }
    case "reject":
      p.reviewState = "rejected";
      history(store, p, "reject", mockMaskText(a.reason));
      break;
    case "reopen":
      if (p.reviewState === "pending") return fail("invalid_transition", "This point is already pending.");
      p.reviewState = "pending";
      history(store, p, "reopen", a.note ? mockMaskText(a.note) : null);
      break;
    case "edit": {
      if (a.expectedRevisionId !== rev.id) return fail("conflict", "Someone else edited this point. Reload to see their changes.");
      const attrs = parsePointAttributes(p.category, a.attributes);
      if (!attrs.success) return fail("validation_failed", "Some details are invalid.", { fieldErrors: { attributes: [attrs.error.issues[0]?.message ?? "Invalid"] } });
      p.revisions.push({
        id: newId(),
        number: rev.number + 1,
        title: mockMaskText(a.title),
        statement: mockMaskText(a.statement),
        attributes: attrs.data.attributes,
        editReason: mockMaskText(a.editReason),
        authorLabel: viewerLabel(store),
        createdAt: at,
        redaction: null,
      });
      // D5: a typed-in direct contact raises the point to at least leads_only.
      if (attrs.data.category === "contact" && attrs.data.attributes.directContact) {
        p.accessOverride = maxAccess(p.accessOverride ?? "everyone", "leads_only");
      }
      p.reviewState = "pending";
      p.reverifyAt = Date.now() + 6_000; // D16: async re-verification
      history(store, p, "edit", mockMaskText(a.editReason));
      break;
    }
    case "confirm_inferred":
      if (status !== "inferred") return fail("invalid_transition", "Only inferred points can be confirmed.");
      p.inferredConfirmation = { by: me, at };
      history(store, p, "confirm_inferred", a.note ? mockMaskText(a.note) : null);
      break;
    case "resolve_conflict":
      if (status !== "conflicting") return fail("invalid_transition", "This point has no conflict to resolve.");
      p.conflictResolution = { note: mockMaskText(a.resolutionNote), by: me, at };
      history(store, p, "resolve_conflict", mockMaskText(a.resolutionNote));
      break;
    case "exclude_evidence": {
      const link = p.links.find((l) => l.pointEvidenceId === a.pointEvidenceId);
      if (!link) return notFound();
      if (link.excluded) return fail("invalid_transition", "Already excluded.");
      withAutoReopen(store, p, () => {
        link.excluded = true;
        link.exclusionReason = mockMaskText(a.reason);
      });
      history(store, p, "exclude_evidence", mockMaskText(a.reason));
      break;
    }
    case "restore_evidence": {
      const link = p.links.find((l) => l.pointEvidenceId === a.pointEvidenceId);
      if (!link) return notFound();
      if (!link.excluded) return fail("invalid_transition", "This evidence isn't excluded.");
      withAutoReopen(store, p, () => {
        link.excluded = false;
        link.exclusionReason = null;
      });
      history(store, p, "restore_evidence");
      break;
    }
    case "change_access": {
      const floor = pointAccessFloor(p);
      if (a.accessOverride && accessRank(a.accessOverride) < accessRank(floor)) {
        return fail("invalid_transition", `This point can't be less restricted than its evidence (${floor.replace("_", " ")}).`);
      }
      const rev2 = currentRevision(p);
      const hasDirect = p.category === "contact" && (rev2.attributes as { directContact?: unknown }).directContact;
      if (hasDirect && accessRank(a.accessOverride ?? floor) < accessRank("leads_only")) {
        return fail("invalid_transition", "Points with a direct contact must stay at leads only or stricter.");
      }
      if (a.accessOverride && accessRank(a.accessOverride) > accessRank(c.member.clearance)) return forbidden();
      p.accessOverride = a.accessOverride;
      history(store, p, "change_access", `Access set to ${(a.accessOverride ?? floor).replace("_", " ")}.`);
      break;
    }
    case "resolve_privacy_review":
      return fail("invalid_transition", "This point has no privacy review.");
  }

  p.updatedAt = at;
  touch(store, p.handoverId);
  return done(ok(toPointDetail(store, p, c.member.clearance)));
}

// ── Gaps ─────────────────────────────────────────────────────────────────────

export async function createGapQuestion(input: CreateGapQuestionInput): Promise<Result<GapQuestionSummary>> {
  await sleep(250);
  const v = parse(createGapQuestionInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.review) return forbidden();
  const point = v.data.pointId ? store.points.find((p) => p.id === v.data.pointId && p.handoverId === c.h.id) : undefined;
  if (v.data.pointId && (!point || !accessAllows(pointAccessLevel(point), c.member.clearance))) return notFound();
  if (v.data.assignedMemberId && !store.members.some((m) => m.id === v.data.assignedMemberId && m.handoverId === c.h.id && !m.removedAt)) return notFound();
  const q = {
    id: newId(),
    handoverId: c.h.id,
    pointId: point?.id ?? null,
    // A question about a point takes the point's category (§11.5).
    category: point?.category ?? v.data.category ?? null,
    question: mockMaskText(v.data.question),
    context: v.data.context ? mockMaskText(v.data.context) : null,
    priority: v.data.priority,
    status: "open" as const,
    // The server raises the requested level to the point's level (§8.4, §11.5).
    accessLevel: point ? maxAccess(pointAccessLevel(point), v.data.accessLevel) : v.data.accessLevel,
    answers: [],
    createdAt: nowIso(),
  };
  store.gapQuestions.push(q);
  touch(store, c.h.id);
  return done(ok(toGapQuestionSummary(q, { profileId: store.viewerId, reviewRole: true })));
}

const GAP_LINK_MAX_USES = 20; // §12.4; not an input

/**
 * The mock has no BATON_SITE_URL, so links are returned as same-origin paths; the UI resolves them
 * against the page origin. The real action builds an absolute URL from BATON_SITE_URL (§12.3).
 */
function issueToken(store: MockStore, t: Omit<MockToken, "id" | "token" | "useCount" | "createdAt" | "createdBy" | "revokedAt" | "redeemedAt" | "sessionProfileId">): MockToken {
  const row: MockToken = { ...t, id: newId(), token: newToken(), useCount: 0, createdAt: nowIso(), createdBy: store.viewerId, revokedAt: null, redeemedAt: null, sessionProfileId: null };
  store.tokens.push(row);
  return row;
}

export async function createGapInterviewLink(input: CreateGapLinkInput): Promise<Result<CreatedLink>> {
  await sleep(300);
  const v = parse(createGapLinkInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.review) return forbidden();
  const questions = store.gapQuestions.filter((q) => q.handoverId === c.h.id && v.data.questionIds.includes(q.id) && accessAllows(gapQuestionAccessLevel(store, q), c.member.clearance));
  if (questions.length !== v.data.questionIds.length) return notFound();
  // §6.0 trigger: a token's questions are at or below its max_access_level.
  if (questions.some((q) => !accessAllows(gapQuestionAccessLevel(store, q), v.data.maxAccessLevel))) {
    return fail("validation_failed", "Some questions are more restricted than this link allows.", { fieldErrors: { maxAccessLevel: ["Raise the link's access level or remove the restricted questions"] } });
  }
  const t = issueToken(store, {
    purpose: "gap_interview",
    handoverId: c.h.id,
    questionIds: v.data.questionIds,
    maxAccessLevel: v.data.maxAccessLevel,
    grantRole: null,
    recipientEmail: null,
    expiresAt: new Date(Date.now() + v.data.expiresInDays * 86_400_000).toISOString(),
    maxUses: GAP_LINK_MAX_USES,
  });
  touch(store, c.h.id);
  return done(ok({ tokenId: t.id, url: routes.token.gaps(t.token), expiresAt: t.expiresAt }));
}

/** Creator: any token of the handover. Other review roles: Gap Interview links only (§12.4). */
export async function revokeAccessToken(input: RevokeAccessTokenInput): Promise<Result<null>> {
  await sleep(250);
  const v = parse(revokeAccessTokenInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const t = store.tokens.find((x) => x.id === v.data.tokenId);
  if (!t) return notFound();
  const c = context(store, t.handoverId);
  if (!c || !c.review) return notFound();
  if (t.purpose === "member_invite" && !c.isCreator) return notFound(); // invitations are not listed to them either
  if (t.revokedAt) return fail("invalid_transition", "This link is already revoked.");
  t.revokedAt = nowIso();
  touch(store, c.h.id);
  return done(ok(null));
}

export async function submitGapAnswers(input: SubmitGapAnswersInput): Promise<Result<{ submitted: number }>> {
  await sleep(500);
  const v = parse(submitGapAnswersInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const at = nowIso();

  let scope: { questionIds: string[] | null; maxAccessLevel: AccessLevel | null; label: string; profileId: string | null; token: string | null };
  if (v.data.token) {
    const t = store.tokens.find((x) => x.token === v.data.token && x.purpose === "gap_interview");
    if (!t || tokenStatus(t) !== "active") return fail("token_invalid", "This link is no longer valid.");
    scope = { questionIds: t.questionIds, maxAccessLevel: t.maxAccessLevel, label: mockMaskText(v.data.answererLabel!), profileId: null, token: t.token };
  } else {
    scope = { questionIds: null, maxAccessLevel: null, label: viewerLabel(store), profileId: store.viewerId, token: null };
  }

  const targets = v.data.answers.map((a) => ({ a, q: store.gapQuestions.find((q) => q.id === a.gapQuestionId) }));
  for (const { q } of targets) {
    // §8.5: anything out of scope, closed or unknown is the same not_found.
    if (!q || q.status !== "open" || (scope.questionIds && !scope.questionIds.includes(q.id))) return notFound();
    if (scope.maxAccessLevel && !accessAllows(gapQuestionAccessLevel(store, q), scope.maxAccessLevel)) return notFound();
    if (!scope.questionIds && !context(store, q.handoverId)) return notFound();
  }
  for (const { a, q } of targets) {
    q!.answers.push({
      id: newId(),
      answererLabel: scope.label,
      text: mockMaskText(a.answerText),
      status: "submitted",
      privacyHeld: false,
      createdAt: at,
      answeredByProfileId: scope.profileId,
      viaToken: scope.token,
    });
    q!.status = "answered";
    touch(store, q!.handoverId);
  }
  const used = scope.token ? store.tokens.find((x) => x.token === scope.token) : undefined;
  if (used) {
    used.useCount += 1;
    used.redeemedAt ??= at;
  }
  return done(ok({ submitted: targets.length }));
}

export async function reviewGapAnswer(input: ReviewGapAnswerInput): Promise<Result<null>> {
  await sleep(300);
  const v = parse(reviewGapAnswerInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const q = store.gapQuestions.find((x) => x.answers.some((a) => a.id === v.data.answerId));
  if (!q) return notFound();
  const c = context(store, q.handoverId);
  if (!c || !c.review) return notFound();
  const answer = q.answers.find((a) => a.id === v.data.answerId)!;
  if (answer.status !== "submitted") return fail("invalid_transition", "This answer was already reviewed.");

  if (v.data.decision === "accept") {
    answer.status = "accepted";
    const p = q.pointId ? store.points.find((x) => x.id === q.pointId) : undefined;
    if (p) {
      // Testimony evidence; the mock "support check" (§10.8) returns supports straight away.
      const link: MockLink = {
        pointEvidenceId: newId(),
        evidenceId: newId(),
        kind: "testimony",
        quote: answer.text,
        authorLabel: answer.answererLabel,
        sentAt: answer.createdAt,
        sourceId: null,
        location: null,
        quoteCheck: "exact",
        supportVerdict: "supports",
        verdictRationale: "Gap Interview answer accepted by a reviewer.",
        verifiedRevisionId: currentRevision(p).id,
        excluded: false,
        exclusionReason: null,
        accessLevel: gapQuestionAccessLevel(store, q), // testimony matches its question (§6.0)
      };
      withAutoReopen(store, p, () => p.links.push(link));
      p.updatedAt = nowIso();
    }
  } else {
    answer.status = "rejected";
    if (!q.answers.some((a) => a.status !== "rejected")) q.status = "open";
  }
  touch(store, q.handoverId);
  return done(ok(null));
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function inviteMember(input: InviteMemberInput): Promise<Result<CreatedLink>> {
  await sleep(300);
  const v = parse(inviteMemberInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.isCreator) return forbidden("Only the creator can invite members.");
  const email = v.data.email.toLowerCase();
  if (store.members.some((m) => m.handoverId === c.h.id && !m.removedAt && m.email.toLowerCase() === email)) {
    return fail("conflict", "That person is already a member.");
  }
  if (store.tokens.some((t) => t.handoverId === c.h.id && t.purpose === "member_invite" && t.recipientEmail === email && tokenStatus(t) === "active")) {
    return fail("conflict", "That person already has a pending invitation. Turn it off first to send a new one.");
  }
  const clearance =
    v.data.role === "outgoing" || v.data.role === "reviewer" ? "reviewer_only" : v.data.clearance ?? (v.data.role === "lead" ? "leads_only" : "everyone");
  const t = issueToken(store, {
    purpose: "member_invite",
    handoverId: c.h.id,
    questionIds: [],
    maxAccessLevel: clearance,
    grantRole: v.data.role,
    recipientEmail: email,
    expiresAt: new Date(Date.now() + v.data.expiresInDays * 86_400_000).toISOString(),
    maxUses: 1, // invites are single-use (§12.4)
  });
  touch(store, c.h.id);
  return done(ok({ tokenId: t.id, url: routes.token.handover(t.token), expiresAt: t.expiresAt }));
}

export async function updateMemberClearance(input: UpdateMemberClearanceInput): Promise<Result<null>> {
  await sleep(250);
  const v = parse(updateMemberClearanceInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const m = store.members.find((x) => x.id === v.data.memberId && !x.removedAt);
  if (!m) return notFound();
  const c = context(store, m.handoverId);
  if (!c) return notFound();
  if (!c.isCreator) return forbidden("Only the creator can change clearance.");
  if (isReviewRole(m.role)) return fail("invalid_transition", "Outgoing and reviewer members always have reviewer-only clearance.");
  m.clearance = v.data.clearance;
  return done(ok(null));
}

export async function removeMember(input: { memberId: string }): Promise<Result<null>> {
  await sleep(250);
  const v = parse(memberIdInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const m = store.members.find((x) => x.id === v.data.memberId && !x.removedAt);
  if (!m) return notFound();
  const c = context(store, m.handoverId);
  if (!c) return notFound();
  if (!c.isCreator) return forbidden("Only the creator can remove members.");
  if (m.profileId === c.h.createdBy) return fail("invalid_transition", "The creator's membership can't be removed.");
  m.removedAt = nowIso();
  if (c.h.pendingCreatorTransfer?.toMemberId === m.id) c.h.pendingCreatorTransfer = null; // the offer lapses (§12.9)
  return done(ok(null));
}

export async function acknowledgePublication(input: AcknowledgePublicationInput): Promise<Result<null>> {
  await sleep(450);
  const v = parse(acknowledgePublicationInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const pub = store.publications.find((p) => p.id === v.data.publicationId);
  if (!pub) return notFound();
  const h = store.handovers.find((x) => x.id === pub.handoverId && !x.deletedAt);
  if (!h) return notFound();
  // Mock session: the workspace viewer if they are incoming here, otherwise the last /h/[token] reader.
  const candidates = [store.viewerId, store.readerSessionId].filter((x): x is string => !!x);
  const member = candidates.map((pid) => activeMember(store, h.id, pid)).find((m) => m?.role === "incoming");
  if (!member) return forbidden("Only incoming members acknowledge a handover.");
  if (h.currentPublicationId !== pub.id) return fail("conflict", "A newer version of this handover was published.");
  if (pub.acknowledgements.some((a) => a.profileId === member.profileId)) return fail("invalid_transition", "Already acknowledged.");
  pub.acknowledgements.push({ profileId: member.profileId!, at: nowIso() });

  const required = store.members.filter((m) => m.handoverId === h.id && m.ackRequired && !m.removedAt);
  const allAcked = required.every((m) => pub.acknowledgements.some((a) => a.profileId === m.profileId));
  const pendingIncomingInvite = store.tokens.some((t) => isActiveIncomingInvite(t, h.id));
  if (h.state === "approved" && allAcked && !pendingIncomingInvite) h.state = "acknowledged";
  h.updatedAt = nowIso();
  return done(ok(null));
}

// ── Account (§12.9) ──────────────────────────────────────────────────────────

// ── Privacy (§12.8) ──────────────────────────────────────────────────────────

/**
 * Creator only. The real action writes a recovery-manifest entry first and fails with
 * `precondition_failed` without a verified receipt (§12.8, D35). `lib/recovery` (M5) and the manifest
 * store (D27) don't exist yet, so no environment can produce that receipt: the mock checks the input
 * and permissions, then fails the same way instead of pretending to erase anything.
 */
export async function eraseParticipant(input: EraseParticipantInput): Promise<Result<ErasureReport>> {
  await sleep(400);
  const v = parse(eraseParticipantInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const c = context(store, v.data.handoverId);
  if (!c) return notFound();
  if (!c.isCreator) return forbidden("Only the creator can erase a participant.");
  const p = store.participants.find((x) => x.id === v.data.participantId && x.handoverId === c.h.id);
  if (!p) return notFound();
  return fail("precondition_failed", "Erasure isn't available yet: Baton can't record the recovery receipt it needs before deleting anything. Nothing was changed.", {
    details: { reason: "recovery_receipt_unavailable" },
  });
}

// ── Account (§12.9) ──────────────────────────────────────────────────────────

/** Every handover the viewer created that hasn't been purged, including soft-deleted ones in their grace period. */
const createdUnpurged = (store: MockStore) => store.handovers.filter((h) => h.createdBy === store.viewerId && !h.purgedAt);

export async function getAccountDeletionBlockers(): Promise<Result<AccountDeletionBlockers>> {
  await sleep(150);
  const store = getStore();
  return ok({
    createdHandovers: createdUnpurged(store).map((h) => ({ id: h.id, title: h.title, deleted: h.deletedAt !== null })),
  });
}

/**
 * Blocked until every created handover is deleted, or listed in `purgeHandoverIds` for an
 * explicitly confirmed purge (D25). Mock: purges those handovers, anonymises the profile as
 * "Former member" (D26) and signs the mock session out by switching to a profile with no memberships.
 */
export async function deleteAccount(input: DeleteAccountInput): Promise<Result<null>> {
  await sleep(600);
  // D25: `confirm` must be exactly the typed word "DELETE" (case-sensitive). Checked here, whatever the UI did.
  const v = parse(deleteAccountInput, input);
  if (!v.ok) return v;
  const store = getStore();
  const created = createdUnpurged(store);
  const purge = new Set(v.data.purgeHandoverIds.map((id) => id.toLowerCase()));
  if ([...purge].some((id) => !created.some((h) => h.id === id))) return notFound();
  const unresolved = created.filter((h) => !purge.has(h.id));
  if (unresolved.length > 0) {
    return fail("precondition_failed", `Transfer or delete ${unresolved.length === 1 ? "1 handover" : `${unresolved.length} handovers`} you created first.`, {
      details: { blocking: unresolved.length },
    });
  }
  const at = nowIso();
  for (const h of created) {
    // Explicitly confirmed immediate purge (§12.9 point 3).
    h.deletedAt ??= at;
    h.purgedAt = at;
    h.pendingCreatorTransfer = null;
    for (const t of store.tokens.filter((t) => t.handoverId === h.id)) t.revokedAt ??= at;
  }
  // Tokens the user created are revoked; open offers to them are cancelled (§12.9 point 4).
  for (const t of store.tokens.filter((t) => t.createdBy === store.viewerId)) t.revokedAt ??= at;
  const myMemberIds = new Set(store.members.filter((m) => m.profileId === store.viewerId).map((m) => m.id));
  for (const h of store.handovers) if (h.pendingCreatorTransfer && myMemberIds.has(h.pendingCreatorTransfer.toMemberId)) h.pendingCreatorTransfer = null;
  const profile = store.profiles.find((p) => p.id === store.viewerId);
  if (profile) {
    profile.displayName = "Former member";
    profile.email = "";
  }
  for (const m of store.members.filter((m) => m.profileId === store.viewerId)) {
    m.removedAt = at;
    m.displayName = "Former member";
  }
  store.viewerId = seedId(NS.profile, 999);
  return done(ok(null));
}
