"use server";

/** Participant erasure Server Function (§11.3, §12.8). Fail-closed while D27 is open: lib/actions/core/privacy.ts. */

import type { Result } from "../contracts/api";
import type { ErasureReport } from "../contracts/dto";
import type { EraseParticipantInput } from "../contracts/schemas";
import * as core from "./core/privacy";
import { actionDeps } from "./deps";

export async function eraseParticipant(input: EraseParticipantInput): Promise<Result<ErasureReport>> {
  return core.eraseParticipant(actionDeps(), input);
}
