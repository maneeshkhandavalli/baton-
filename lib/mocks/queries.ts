/**
 * Mock implementation of the canonical `BatonQueries` read facade (lib/contracts/queries.ts).
 *
 * It emulates RLS (§8.4) for a given viewer: hidden rows are simply absent, and fetching one by id
 * returns `not_found` (§8.5). `lib/data` (main) will switch the app from this to `lib/db`.
 */

import { connection } from "next/server";

import type { AppError, Result } from "@/lib/contracts/api";
import type { CreatorTransferOffer, HandoverSummary, MemberSummary, PublishedHandover, SourceMessageContext } from "@/lib/contracts/dto";
import { POINT_CATEGORIES } from "@/lib/contracts/enums";
import { MESSAGE_CONTEXT_DEFAULT, MESSAGE_CONTEXT_MAX, type BatonQueries, type PointListFilter } from "@/lib/contracts/queries";
import { uuidSchema } from "@/lib/contracts/schemas";

import {
  activeMember,
  canSee,
  computeReadiness,
  gapQuestionAccessLevel,
  isReviewRole,
  pointAccessLevel,
  pointStatus,
  profileLabel,
  settleReverification,
  toGapQuestionSummary,
  toPointDetail,
  toPointSummary,
  toSourceSummary,
} from "./derive";
import { toAccessTokenSummary, toExclusionSummary, toParticipantSummary, tokenStatus } from "./exclusions";
import { getStore, runStages, tickRuns } from "./store";
import type { MockHandover, MockStore } from "./types";

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (code: AppError["code"], message: string, extra: Partial<AppError> = {}): { ok: false; error: AppError } => ({
  ok: false,
  error: { code, message, retryable: false, ...extra },
});

const NOT_FOUND = () => fail("not_found", "We couldn't find that.");

/** Request-time read: the mock is in-memory, so tell Next not to prerender it (README, Cache Components). */
async function requestTime() {
  await connection();
}

function visibleHandover(store: MockStore, id: string, profileId: string) {
  if (!uuidSchema.safeParse(id).success) return null;
  const h = store.handovers.find((x) => x.id === id && !x.deletedAt);
  if (!h) return null;
  const member = activeMember(store, id, profileId);
  if (!member) return null;
  return { h, member };
}

const OFFER_LIFETIME_MS = 14 * 86_400_000; // §12.9: an offer lapses after 14 days

/** The open creatorship offer, if it is still valid: not lapsed, and both members still active (§12.9). */
export function openCreatorOffer(store: MockStore, h: MockHandover, now = Date.now()) {
  const o = h.pendingCreatorTransfer;
  if (!o || Date.parse(o.offeredAt) + OFFER_LIFETIME_MS <= now) return null;
  const to = store.members.find((m) => m.id === o.toMemberId && m.handoverId === h.id && !m.removedAt);
  if (!to || !activeMember(store, h.id, h.createdBy)) return null;
  return { ...o, toProfileId: to.profileId };
}

export function toHandoverSummary(store: MockStore, h: MockHandover, profileId: string): HandoverSummary {
  const member = activeMember(store, h.id, profileId)!;
  const offer = openCreatorOffer(store, h);
  // Visible to the creator and to the offered member only (§11.6).
  const showOffer = offer && (h.createdBy === profileId || offer.toProfileId === profileId);
  return {
    id: h.id,
    title: h.title,
    teamName: h.teamName,
    roleTitle: h.roleTitle,
    state: h.state,
    viewerRole: member.role,
    viewerIsCreator: h.createdBy === profileId,
    viewerClearance: member.clearance,
    currentPublicationId: h.currentPublicationId,
    pendingCreatorTransfer: showOffer ? { toMemberId: offer.toMemberId, offeredAt: offer.offeredAt } : null,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

export function createMockQueries(profileId: string): BatonQueries {
  return {
    async listMyHandovers() {
      await requestTime();
      const store = getStore();
      const mine = store.handovers.filter((h) => !h.deletedAt && activeMember(store, h.id, profileId));
      mine.forEach((h) => tickRuns(store, h.id));
      return ok(
        mine
          .map((h) => toHandoverSummary(store, h, profileId))
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
      );
    },

    async getHandover(id) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, id, profileId);
      if (!v) return NOT_FOUND();
      tickRuns(store, id);
      return ok(toHandoverSummary(store, v.h, profileId));
    },

    async listMembers(handoverId) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v) return NOT_FOUND();
      const isCreator = v.h.createdBy === profileId;
      const members: MemberSummary[] = store.members
        .filter((m) => m.handoverId === handoverId && !m.removedAt)
        .map((m) => ({
          id: m.id,
          displayName: m.displayName,
          role: m.role,
          clearance: isCreator ? m.clearance : null,
          ackRequired: m.ackRequired,
          isCreator: m.profileId === v.h.createdBy,
          isViewer: m.id === v.member.id,
        }));
      return ok(members);
    },

    async listSources(handoverId) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v) return NOT_FOUND();
      if (!isReviewRole(v.member.role)) return ok([]);
      tickRuns(store, handoverId);
      return ok(
        store.sources
          .filter((s) => s.handoverId === handoverId && !s.removedAt && canSee(s.accessLevel, v.member.clearance))
          .map(toSourceSummary),
      );
    },

    async listParticipants(handoverId, sourceId) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v || !isReviewRole(v.member.role)) return NOT_FOUND();
      if (sourceId !== undefined && !uuidSchema.safeParse(sourceId).success) return NOT_FOUND();
      const visibleSources = store.sources.filter(
        (s) => s.handoverId === handoverId && !s.removedAt && canSee(s.accessLevel, v.member.clearance) && (sourceId === undefined || s.id === sourceId),
      );
      if (sourceId !== undefined && visibleSources.length === 0) return NOT_FOUND();
      const ids = new Set(visibleSources.map((s) => s.id));
      return ok(
        store.participants
          .filter((p) => p.handoverId === handoverId && ids.has(p.sourceId))
          .map((p) => toParticipantSummary(store, p))
          .sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle) || b.messageCount - a.messageCount),
      );
    },

    async listExclusions(handoverId) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v || !isReviewRole(v.member.role)) return NOT_FOUND();
      const hiddenSource = (id: string | null) => {
        if (id === null) return false;
        const s = store.sources.find((x) => x.id === id);
        return !s || !canSee(s.accessLevel, v.member.clearance);
      };
      return ok(
        store.exclusions
          .filter((e) => e.handoverId === handoverId && !hiddenSource(e.sourceId))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map(toExclusionSummary),
      );
    },

    async getProcessingStatus(handoverId) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v || !isReviewRole(v.member.role)) return NOT_FOUND();
      tickRuns(store, handoverId);
      const run = store.runs
        .filter((r) => r.handoverId === handoverId)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
      return ok({
        handoverState: v.h.state,
        run: run
          ? {
              id: run.id,
              status: run.status,
              startedAt: run.startedAt,
              finishedAt: run.finishedAt,
              stages: runStages(store, run),
              error: run.error,
            }
          : null,
        sources: store.sources
          .filter((s) => s.handoverId === handoverId && !s.removedAt && canSee(s.accessLevel, v.member.clearance))
          .map(toSourceSummary),
      });
    },

    async listPoints(handoverId, filter?: PointListFilter) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v) return NOT_FOUND();
      if (!isReviewRole(v.member.role)) return ok([]);
      const points = store.points.filter((p) => p.handoverId === handoverId && canSee(pointAccessLevel(p), v.member.clearance));
      points.forEach((p) => settleReverification(p));
      const order = { conflicting: 0, inferred: 1, missing: 2, sourced: 3 } as const;
      return ok(
        points
          .filter((p) => !filter?.category || p.category === filter.category)
          .filter((p) => !filter?.status || pointStatus(p) === filter.status)
          .filter((p) => !filter?.reviewState || p.reviewState === filter.reviewState)
          .sort((a, b) => order[pointStatus(a)] - order[pointStatus(b)] || a.sortKey - b.sortKey)
          .map((p) => toPointSummary(store, p, v.member.clearance)),
      );
    },

    async getPoint(pointId) {
      await requestTime();
      const store = getStore();
      const p = store.points.find((x) => x.id === pointId);
      if (!p) return NOT_FOUND();
      const v = visibleHandover(store, p.handoverId, profileId);
      if (!v || !isReviewRole(v.member.role) || !canSee(pointAccessLevel(p), v.member.clearance)) return NOT_FOUND();
      settleReverification(p);
      return ok(toPointDetail(store, p, v.member.clearance));
    },

    async getSourceMessageContext(pointEvidenceId, window) {
      await requestTime();
      const store = getStore();
      if (!uuidSchema.safeParse(pointEvidenceId).success) return NOT_FOUND();
      const point = store.points.find((p) => p.links.some((l) => l.pointEvidenceId === pointEvidenceId));
      const link = point?.links.find((l) => l.pointEvidenceId === pointEvidenceId);
      if (!point || !link || link.kind === "testimony" || !link.sourceId) return NOT_FOUND();
      const v = visibleHandover(store, point.handoverId, profileId);
      if (!v || !isReviewRole(v.member.role)) return NOT_FOUND();
      if (!canSee(pointAccessLevel(point), v.member.clearance) || !canSee(link.accessLevel, v.member.clearance)) return NOT_FOUND();
      const source = store.sources.find((s) => s.id === link.sourceId);
      if (!source || !canSee(source.accessLevel, v.member.clearance)) return NOT_FOUND();
      const clamp = (n: number | undefined) => Math.max(0, Math.min(MESSAGE_CONTEXT_MAX, Math.trunc(n ?? MESSAGE_CONTEXT_DEFAULT)));
      const before = clamp(window?.before);
      const after = clamp(window?.after);
      const base: SourceMessageContext = {
        pointEvidenceId,
        sourceId: source.id,
        sourceTitle: source.title,
        available: false,
        messages: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
      };
      if (source.removedAt || !link.location) return ok(base);
      // The mock keeps no message table: its "source" is every quoted message from it, in line order.
      const seen = new Set<number>();
      const messages = store.points
        .flatMap((p) => p.links)
        .filter((l) => l.sourceId === source.id && l.kind === "source_quote" && l.location !== null && canSee(l.accessLevel, v.member.clearance))
        .filter((l) => {
          const line = l.location!.lineStart;
          if (seen.has(line)) return false;
          seen.add(line);
          return true;
        })
        .sort((a, b) => a.location!.lineStart - b.location!.lineStart);
      const at = messages.findIndex((l) => l.location!.lineStart === link.location!.lineStart);
      if (at < 0) return ok(base);
      const slice = messages.slice(Math.max(0, at - before), at + after + 1);
      return ok({
        ...base,
        available: true,
        messages: slice.map((l) => ({
          seq: l.location!.lineStart,
          sentAt: l.sentAt,
          authorLabel: l.authorLabel,
          kind: source.kind === "whatsapp_export" ? ("text" as const) : ("document_block" as const),
          body: l.quote,
          location: l.location,
          isQuoted: l.location!.lineStart === link.location!.lineStart,
        })),
        hasMoreBefore: at - before > 0,
        hasMoreAfter: at + after + 1 < messages.length,
      });
    },

    async listGapQuestions(handoverId) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v) return NOT_FOUND();
      const review = isReviewRole(v.member.role);
      return ok(
        store.gapQuestions
          .filter((q) => q.handoverId === handoverId && canSee(gapQuestionAccessLevel(store, q), v.member.clearance))
          .filter((q) => review || q.status === "open")
          .map((q) => toGapQuestionSummary(q, { profileId, reviewRole: review })),
      );
    },

    async getReadiness(handoverId) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v) return NOT_FOUND();
      if (!isReviewRole(v.member.role)) return fail("forbidden", "Readiness is only available to reviewers.");
      tickRuns(store, handoverId);
      return ok(computeReadiness(store, handoverId, v.member.clearance));
    },

    async getPublishedHandover(handoverId) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v || !v.h.currentPublicationId) return NOT_FOUND();
      const pub = store.publications.find((p) => p.id === v.h.currentPublicationId);
      if (!pub) return NOT_FOUND();
      const visible = pub.points.filter((p) => canSee(p.accessLevel, v.member.clearance)).sort((a, b) => a.sortKey - b.sortKey);
      const sections: PublishedHandover["sections"] = POINT_CATEGORIES.map((category) => ({
        category,
        points: visible.filter((p) => p.category === category).map((p) => ({ id: p.id, content: p.content })),
      })).filter((s) => s.points.length > 0);
      return ok({
        handoverId,
        title: v.h.title,
        teamName: v.h.teamName,
        roleTitle: v.h.roleTitle,
        publicationId: pub.id,
        version: pub.version,
        publishedAt: pub.publishedAt,
        publishedByLabel: profileLabel(store, pub.publishedBy),
        summary: pub.summary,
        sections,
        viewerAcknowledgedAt: pub.acknowledgements.find((a) => a.profileId === profileId)?.at ?? null,
      });
    },

    async listAccessTokens(handoverId, filter) {
      await requestTime();
      const store = getStore();
      const v = visibleHandover(store, handoverId, profileId);
      if (!v) return NOT_FOUND();
      if (!isReviewRole(v.member.role)) return ok([]);
      const isCreator = v.h.createdBy === profileId;
      return ok(
        store.tokens
          .filter((t) => t.handoverId === handoverId)
          // Review roles see Gap Interview links; only the creator also sees member invitations (§12.4).
          .filter((t) => t.purpose === "gap_interview" || isCreator)
          .filter((t) => !filter?.purpose || t.purpose === filter.purpose)
          .filter((t) => !filter?.activeOnly || tokenStatus(t) === "active")
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map((t) => toAccessTokenSummary(t, isCreator)),
      );
    },

    async listMyCreatorTransferOffers() {
      await requestTime();
      const store = getStore();
      const offers: CreatorTransferOffer[] = [];
      for (const h of store.handovers) {
        if (h.deletedAt) continue;
        const offer = openCreatorOffer(store, h);
        if (!offer || offer.toProfileId !== profileId) continue;
        offers.push({ handoverId: h.id, handoverTitle: h.title, offeredByLabel: profileLabel(store, offer.offeredBy), offeredAt: offer.offeredAt });
      }
      return ok(offers.sort((a, b) => (a.offeredAt < b.offeredAt ? 1 : -1)));
    },

    async getGapInterview(token) {
      await requestTime();
      const store = getStore();
      const t = store.tokens.find((x) => x.token === token && x.purpose === "gap_interview");
      if (!t || tokenStatus(t) !== "active") return fail("token_invalid", "This link is no longer valid.");
      const h = store.handovers.find((x) => x.id === t.handoverId && !x.deletedAt);
      if (!h) return fail("token_invalid", "This link is no longer valid.");
      const questions = store.gapQuestions
        .filter((q) => t.questionIds.includes(q.id) && q.status === "open" && canSee(gapQuestionAccessLevel(store, q), t.maxAccessLevel))
        .map((q) => ({ id: q.id, question: q.question, context: q.context, priority: q.priority, category: q.category }));
      return ok({ handoverTitle: h.title, questions });
    },
  };
}

/** The workspace viewer's queries (mock session). */
export function getMockQueries(): BatonQueries {
  return createMockQueries(getStore().viewerId);
}

/**
 * Mock stand-in for `/h/[token]` invite redemption plus the resulting session (§12.3).
 * Returns the handover and the profile the page should read as, or null for an invalid token.
 */
export async function mockRedeemHandoverLink(token: string): Promise<{ handoverId: string; queries: BatonQueries; viewerLabel: string } | null> {
  await requestTime();
  const store = getStore();
  const t = store.tokens.find((x) => x.token === token && x.purpose === "member_invite");
  if (!t || t.revokedAt || !t.sessionProfileId) return null;
  store.readerSessionId = t.sessionProfileId;
  return {
    handoverId: t.handoverId,
    queries: createMockQueries(t.sessionProfileId),
    viewerLabel: profileLabel(store, t.sessionProfileId),
  };
}

/**
 * A `/h/[token]` link for the published view of a handover: the viewer's own redeemed invite, or,
 * for review roles, the incoming member's (a mock "preview as incoming"). There is no in-workspace
 * route for the published view yet (see the handover report).
 */
export async function mockReaderLinkFor(handoverId: string): Promise<string | null> {
  await requestTime();
  const store = getStore();
  const invites = store.tokens.filter((x) => x.handoverId === handoverId && x.purpose === "member_invite" && x.sessionProfileId && !x.revokedAt);
  const own = invites.find((x) => x.sessionProfileId === store.viewerId);
  if (own) return own.token;
  const me = activeMember(store, handoverId, store.viewerId);
  if (!me || !isReviewRole(me.role)) return null;
  return invites.find((x) => x.grantRole === "incoming")?.token ?? null;
}
