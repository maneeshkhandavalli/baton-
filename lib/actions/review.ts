"use server";

/** Review Server Functions (§11.3). Logic: lib/actions/core/review.ts. */

import type { Result } from "../contracts/api";
import type { PointDetail } from "../contracts/dto";
import type { CreateManualPointInput, ReviewPointInput } from "../contracts/schemas";
import * as core from "./core/review";
import { actionDeps } from "./deps";

export async function reviewPoint(input: ReviewPointInput): Promise<Result<PointDetail>> {
  return core.reviewPoint(actionDeps(), input);
}

export async function createManualPoint(input: CreateManualPointInput): Promise<Result<PointDetail>> {
  return core.createManualPoint(actionDeps(), input);
}
