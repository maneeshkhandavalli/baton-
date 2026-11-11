/**
 * Participant erasure (§12.8, D24, D27). FAIL-CLOSED: D27 (the external recovery manifest) is open, so no
 * manifest entry can be written and no receipt can exist. After validation and the verified actor the action
 * refuses with precondition_failed (I3 amendment 5). It never calls erasure_target or erase_participant,
 * never registers a receipt verifier and never fabricates a receipt.
 */

import type { Result } from "../../contracts/api";
import type { ErasureReport } from "../../contracts/dto";
import { eraseParticipantInput } from "../../contracts/schemas";
import type { EraseParticipantInput } from "../../contracts/schemas";
import { action, failWith } from "./run";
import type { ActionDeps } from "./types";

export const RECOVERY_MANIFEST_UNAVAILABLE = "recovery_manifest_unavailable";

export async function eraseParticipant(deps: ActionDeps, input: EraseParticipantInput): Promise<Result<ErasureReport>> {
  return action(deps, eraseParticipantInput, input, async () =>
    failWith("precondition_failed", {
      message: "Erasure isn't available yet. Nothing was changed.",
      details: { reason: RECOVERY_MANIFEST_UNAVAILABLE },
    }),
  );
}
