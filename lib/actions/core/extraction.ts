/** R3 Task 03 review actions for extraction signals (EXT-1) and review flags (VER-2/3). */

import type { Result } from "../../contracts/api";
import { reviewPointFlagInput, reviewSignalMessageInput, type ReviewPointFlagInput, type ReviewSignalMessageInput } from "../../contracts/schemas";
import * as mutations from "../../db/mutations";
import { action, ok } from "./run";
import type { ActionDeps } from "./types";

/** Marks one message's signals as not relevant (or back to unreviewed). Never creates or changes a point. */
export async function reviewSignalMessage(deps: ActionDeps, input: ReviewSignalMessageInput): Promise<Result<{ signals: number }>> {
  return action(deps, reviewSignalMessageInput, input, async (actor, v) => {
    const signals = await mutations.reviewExtractionSignals(deps.adminDb(), actor, v);
    return ok({ signals });
  });
}

/** Dismisses, confirms or reopens a review flag. Never changes the point's status or evidence. */
export async function reviewPointFlag(deps: ActionDeps, input: ReviewPointFlagInput): Promise<Result<null>> {
  return action(deps, reviewPointFlagInput, input, async (actor, v) => {
    await mutations.reviewPointFlag(deps.adminDb(), actor, v);
    return ok(null);
  });
}
