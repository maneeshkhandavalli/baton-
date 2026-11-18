/**
 * R3 Task 05E: deciding a change-review item (accept / reject / investigate). The database
 * (decide_change_review_item) authorizes and enforces everything atomically; this layer validates early, masks the
 * reviewer's free text (§12.1), re-checks attributes for the point's real category, and explains refusals.
 */

import type { Result } from "../../contracts/api";
import {
  decideChangeReviewInput,
  decisionProblems,
  type ChangeReviewItem,
  type DecideChangeReviewInput,
} from "../../contracts/change-review";
import { meetsQuoteMinimum } from "../../ai/quote-check";
import { parsePointAttributes } from "../../contracts/schemas";
import type { PointCategory } from "../../contracts/enums";
import { isDbError } from "../../db/errors";
import * as mutations from "../../db/mutations";
import { createInputMasker } from "./mask";
import { action, failWith, ok, validationFailed } from "./run";
import type { ActionDeps } from "./types";

export const CHANGE_REVIEW_CONFLICT_MESSAGE =
  "This change was decided by someone else, or the point or the source changed since you opened it. Reload to see the current state.";
export const CHANGE_REVIEW_STALE_MESSAGE =
  "A newer version of this source replaced the version this change describes. It no longer needs a decision.";
export const CHANGE_REVIEW_CANNOT_ACCEPT_MESSAGE =
  "This change can't be accepted as it stands: the quotation is in several places, its message is no longer available, or the point is held for a privacy check. Reject it or mark it for investigation.";
export const QUOTE_TOO_SHORT_MESSAGE = "Choose at least 12 characters and 3 words from the new message as the supporting quotation.";

export async function decideChangeReview(
  deps: ActionDeps,
  input: DecideChangeReviewInput,
): Promise<Result<{ outcome: "decided" | "unchanged"; state: string; item: ChangeReviewItem | null }>> {
  return action(deps, decideChangeReviewInput, input, async (actor, v) => {
    // The item as the viewer may see it (RLS): its kind and point, never taken from the request.
    const items = await deps.queries.getChangeReviews(v.handoverId);
    const item = items.ok ? items.data.find((i) => i.id === v.itemId) : undefined;
    if (!item) return failWith("not_found");
    if (item.state === "stale") return failWith("precondition_failed", { message: CHANGE_REVIEW_STALE_MESSAGE, details: { reason: "change_review_stale" } });

    const problems = decisionProblems(item.kind, v);
    if (problems) {
      return {
        ok: false,
        error: {
          code: "validation_failed",
          message: Object.values(problems)[0],
          retryable: false,
          fieldErrors: Object.fromEntries(Object.entries(problems).map(([k, msg]) => [k, [msg]])),
        },
      };
    }

    const m = createInputMasker();
    let payload: Record<string, unknown> | null = null;
    if (v.decision === "accept" && item.kind === "possible_contradiction" && v.correction) {
      // the supporting quotation must be real words of the new message, meeting the app's quote minimum (§10.7.4)
      const body = item.newMessage?.body ?? null;
      const quote = body === null ? null : body.slice(v.correction.evidenceStart, v.correction.evidenceEnd);
      if (body === null || v.correction.evidenceEnd > body.length || quote === null || !meetsQuoteMinimum(quote)) {
        return {
          ok: false,
          error: { code: "validation_failed", message: QUOTE_TOO_SHORT_MESSAGE, retryable: false, fieldErrors: { correction: [QUOTE_TOO_SHORT_MESSAGE] } },
        };
      }
      const parsed = parsePointAttributes((item.point?.category ?? "") as PointCategory, m.attributes(v.correction.attributes));
      if (!parsed.success) return validationFailed(parsed.error);
      payload = {
        title: m.text(v.correction.title),
        statement: m.text(v.correction.statement),
        attributes: parsed.data.attributes,
        evidenceStart: v.correction.evidenceStart,
        evidenceEnd: v.correction.evidenceEnd,
      };
    } else if (v.decision === "accept" && item.kind === "new_information" && v.approval) {
      payload = { ...v.approval, resolutionNote: m.optional(v.approval.resolutionNote) };
    }

    try {
      const r = await mutations.decideChangeReviewItem(deps.adminDb(), actor, {
        itemId: v.itemId,
        decision: v.decision,
        expectedState: v.expectedState,
        expectedPointRevisionId: v.expectedPointRevisionId,
        note: v.note?.trim() ? m.text(v.note.trim()) : null,
        payload,
      });
      const after = await deps.queries.getChangeReviews(v.handoverId);
      return ok({ outcome: r.outcome, state: r.state, item: after.ok ? (after.data.find((i) => i.id === v.itemId) ?? null) : null });
    } catch (error) {
      if (isDbError(error) && error.code === "conflict") {
        return failWith("conflict", { message: CHANGE_REVIEW_CONFLICT_MESSAGE, details: { reason: "change_review_conflict" } });
      }
      if (isDbError(error) && error.code === "precondition_failed") {
        return failWith("precondition_failed", { message: CHANGE_REVIEW_CANNOT_ACCEPT_MESSAGE, details: { reason: "change_review_cannot_accept" } });
      }
      if (isDbError(error) && error.code === "validation_failed") {
        return failWith("validation_failed", { message: QUOTE_TOO_SHORT_MESSAGE });
      }
      if (isDbError(error) && error.code === "invalid_transition") {
        return failWith("invalid_transition", { message: CHANGE_REVIEW_STALE_MESSAGE, details: { reason: "change_review_stale" } });
      }
      throw error;
    }
  });
}

