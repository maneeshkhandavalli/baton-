/**
 * Real `BatonQueries` (docs/architecture/shared-contracts.md §11.2, §11.6).
 *
 * Every read goes through a SECURITY INVOKER SQL function with the caller's session, so RLS decides
 * what is visible (§8.3, §8.5). A NULL result, an id the caller may not see, and a malformed id all
 * become the same `not_found`. Only `getGapInterview` uses the service role, through token redemption.
 */

import type { ErrorCode, Result } from "../contracts/api";
import type { AccessTokenFilter, BatonQueries, MessageContextWindow, PointListFilter } from "../contracts/queries";
import { MESSAGE_CONTEXT_DEFAULT, MESSAGE_CONTEXT_MAX } from "../contracts/queries";
import { EVIDENCE_STATUSES, POINT_CATEGORIES, REVIEW_STATES, TOKEN_PURPOSES } from "../contracts/enums";
import type { DbClientFactories } from "./client";
import { DbError, fail, ok, toAppError } from "./errors";
import {
  mapAccessTokenSummary,
  mapCreatorTransferOffer,
  mapExclusionSummary,
  mapGapInterview,
  mapGapQuestion,
  mapHandoverSummary,
  mapMemberList,
  mapPointDetail,
  mapPointSummary,
  mapProcessingStatus,
  mapPublishedHandover,
  mapReadiness,
  mapSourceMessageContext,
  mapSourceParticipant,
  mapSourceSummary,
} from "./mappers";
import { clientSubject, consumeRateLimits } from "./rate-limit";
import { callRpc } from "./rpc";
import { hexToBytea, isWellFormedToken, sha256Hex } from "./tokens";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { callRpc } from "./rpc";

async function run<T>(work: () => Promise<T>, onError?: (code: ErrorCode) => ErrorCode): Promise<Result<T>> {
  try {
    return ok(await work());
  } catch (error) {
    const appError = toAppError(error);
    if (onError) {
      const code = onError(appError.code);
      if (code !== appError.code) return fail(code);
    }
    return { ok: false, error: appError };
  }
}

/** Read errors visible to readers are only not_found / unauthenticated / internal (§11.2). */
function readError(code: ErrorCode): ErrorCode {
  return code === "unauthenticated" || code === "internal" ? code : "not_found";
}

function requireFound(data: unknown): unknown {
  if (data === null || data === undefined) throw new DbError("not_found");
  return data;
}

/** MessageContextWindow: each side clamped to 0–MESSAGE_CONTEXT_MAX, default MESSAGE_CONTEXT_DEFAULT. */
export function clampWindow(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MESSAGE_CONTEXT_DEFAULT;
  return Math.min(MESSAGE_CONTEXT_MAX, Math.max(0, Math.trunc(value)));
}

function asArray(data: unknown): unknown[] {
  if (!Array.isArray(data)) throw new DbError("not_found");
  return data;
}

export function createDbQueries(clients: DbClientFactories): BatonQueries {
  const user = async () => clients.user();
  const admin = async () => {
    if (!clients.admin) throw new DbError("internal");
    return clients.admin();
  };

  const read = <T>(work: () => Promise<T>) => run(work, readError);
  const byId = <T>(value: string, work: (id: string) => Promise<T>): Promise<Result<T>> =>
    UUID.test(value) ? read(() => work(value.toLowerCase())) : Promise.resolve(fail<T>("not_found"));

  return {
    listMyHandovers: () =>
      read(async () => asArray(await callRpc(await user(), "api_list_my_handovers")).map(mapHandoverSummary)),

    getHandover: (handoverId) =>
      byId(handoverId, async (id) =>
        mapHandoverSummary(requireFound(await callRpc(await user(), "api_get_handover", { p_handover_id: id })))),

    listMembers: (handoverId) =>
      byId(handoverId, async (id) =>
        mapMemberList(asArray(await callRpc(await user(), "api_list_members", { p_handover_id: id })))),

    listSources: (handoverId) =>
      byId(handoverId, async (id) =>
        asArray(await callRpc(await user(), "api_list_sources", { p_handover_id: id })).map(mapSourceSummary)),

    // R8: review roles, within clearance. Never the identity hash.
    listParticipants: (handoverId, sourceId?: string) => {
      if (sourceId !== undefined && !UUID.test(sourceId)) return Promise.resolve(fail("not_found"));
      return byId(handoverId, async (id) =>
        asArray(await callRpc(await user(), "api_list_participants", {
          p_handover_id: id,
          p_source_id: sourceId === undefined ? null : sourceId.toLowerCase(),
        })).map(mapSourceParticipant));
    },

    // R8: review roles.
    listExclusions: (handoverId) =>
      byId(handoverId, async (id) =>
        asArray(await callRpc(await user(), "api_list_exclusions", { p_handover_id: id })).map(mapExclusionSummary)),

    getProcessingStatus: (handoverId) =>
      byId(handoverId, async (id) =>
        mapProcessingStatus(requireFound(await callRpc(await user(), "api_get_processing_status", { p_handover_id: id })))),

    listPoints: (handoverId, filter?: PointListFilter) =>
      byId(handoverId, async (id) => {
        if (filter?.category && !(POINT_CATEGORIES as readonly string[]).includes(filter.category)) return [];
        if (filter?.status && !(EVIDENCE_STATUSES as readonly string[]).includes(filter.status)) return [];
        if (filter?.reviewState && !(REVIEW_STATES as readonly string[]).includes(filter.reviewState)) return [];
        const data = await callRpc(await user(), "api_list_points", {
          p_handover_id: id,
          p_category: filter?.category ?? null,
          p_status: filter?.status ?? null,
          p_review_state: filter?.reviewState ?? null,
        });
        return asArray(data).map(mapPointSummary);
      }),

    getPoint: (pointId) =>
      byId(pointId, async (id) => mapPointDetail(requireFound(await callRpc(await user(), "api_get_point", { p_point_id: id })))),

    // R8: review roles within clearance; not_found for testimony and for anything not visible.
    getSourceMessageContext: (pointEvidenceId, window?: MessageContextWindow) =>
      byId(pointEvidenceId, async (id) =>
        mapSourceMessageContext(requireFound(await callRpc(await user(), "api_get_source_message_context", {
          p_point_evidence_id: id,
          p_before: clampWindow(window?.before),
          p_after: clampWindow(window?.after),
        })))),

    listGapQuestions: (handoverId) =>
      byId(handoverId, async (id) =>
        asArray(await callRpc(await user(), "api_list_gap_questions", { p_handover_id: id })).map(mapGapQuestion)),

    getReadiness: (handoverId) =>
      byId(handoverId, async (id) =>
        mapReadiness(requireFound(await callRpc(await user(), "api_get_readiness", { p_handover_id: id })))),

    getPublishedHandover: (handoverId) =>
      byId(handoverId, async (id) =>
        mapPublishedHandover(requireFound(await callRpc(await user(), "api_get_published_handover", { p_handover_id: id })))),

    // R8: review roles see Gap Interview links; the creator also sees invitations (§12.4). Pending
    // invitations = { purpose: "member_invite", activeOnly: true }. An unknown purpose matches nothing.
    listAccessTokens: (handoverId, filter?: AccessTokenFilter) =>
      byId(handoverId, async (id) => {
        if (filter?.purpose !== undefined && !(TOKEN_PURPOSES as readonly string[]).includes(filter.purpose)) return [];
        const data = await callRpc(await user(), "list_access_tokens", {
          p_handover_id: id,
          p_purpose: filter?.purpose ?? null,
          p_active_only: filter?.activeOnly === true,
        });
        return asArray(data).map(mapAccessTokenSummary);
      }),

    // R8: offers addressed to the signed-in user (/account).
    listMyCreatorTransferOffers: () =>
      read(async () => asArray(await callRpc(await user(), "api_list_my_creator_transfer_offers")).map(mapCreatorTransferOffer)),

    // Server-only (§11.6): token redemption with the service role. Expired, revoked, exhausted and unknown
    // tokens are indistinguishable (§3.2).
    // M6: one hit per client and per token is consumed (and committed) BEFORE the lookup, so invalid tokens
    // count too. Malformed tokens are rejected without a database call.
    getGapInterview: async (token) => {
      if (!isWellFormedToken(token)) return fail("token_invalid");
      return run(
        async () => {
          const db = await admin();
          const tokenHashHex = await sha256Hex(token);
          await consumeRateLimits(db, "gap_interview_view", {
            client: await clientSubject(clients.clientIp ? await clients.clientIp() : null),
            tokenHashHex,
          });
          return mapGapInterview(requireFound(await callRpc(db, "get_gap_interview", { p_token_hash: hexToBytea(tokenHashHex) })));
        },
        (code) => (code === "internal" || code === "rate_limited" ? code : "token_invalid"),
      );
    },
  };
}
