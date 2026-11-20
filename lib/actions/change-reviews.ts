"use server";

/** R3 Task 05E: change-review decisions (Server Function). Logic: lib/actions/core/change-reviews.ts. */

import type { Result } from "../contracts/api";
import type { ChangeReviewItem, DecideChangeReviewInput } from "../contracts/change-review";
import * as core from "./core/change-reviews";
import { actionDeps } from "./deps";

export async function decideChangeReview(
  input: DecideChangeReviewInput,
): Promise<Result<{ outcome: "decided" | "unchanged"; state: string; item: ChangeReviewItem | null }>> {
  return core.decideChangeReview(actionDeps(), input);
}

/** Round 4 B (audit F4): "Confirm & approve" a point backed by reviewer testimony. */
export async function confirmTestimonyAndApprove(
  input: core.ConfirmTestimonyInput,
): Promise<Result<{ pointId: string; evidenceStatus: "sourced"; reviewState: "approved" }>> {
  return core.confirmTestimonyAndApprove(actionDeps(), input);
}
