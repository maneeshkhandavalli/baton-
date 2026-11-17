"use server";

/** Extraction review Server Functions (R3 Task 03). Logic: lib/actions/core/extraction.ts. */

import type { Result } from "../contracts/api";
import type { ReviewPointFlagInput, ReviewSignalMessageInput } from "../contracts/schemas";
import * as core from "./core/extraction";
import { actionDeps } from "./deps";

export async function reviewSignalMessage(input: ReviewSignalMessageInput): Promise<Result<{ signals: number }>> {
  return core.reviewSignalMessage(actionDeps(), input);
}

export async function reviewPointFlag(input: ReviewPointFlagInput): Promise<Result<null>> {
  return core.reviewPointFlag(actionDeps(), input);
}
