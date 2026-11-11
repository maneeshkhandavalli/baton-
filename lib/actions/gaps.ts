"use server";

/** Gap Server Functions (§11.3). Logic: lib/actions/core/gaps.ts. */

import type { Result } from "../contracts/api";
import type { CreatedLink, GapQuestionSummary } from "../contracts/dto";
import type {
  CreateGapLinkInput,
  CreateGapQuestionInput,
  ReviewGapAnswerInput,
  RevokeAccessTokenInput,
  SubmitGapAnswersInput,
} from "../contracts/schemas";
import * as core from "./core/gaps";
import { actionDeps } from "./deps";

export async function createGapQuestion(input: CreateGapQuestionInput): Promise<Result<GapQuestionSummary>> {
  return core.createGapQuestion(actionDeps(), input);
}

export async function createGapInterviewLink(input: CreateGapLinkInput): Promise<Result<CreatedLink>> {
  return core.createGapInterviewLink(actionDeps(), input);
}

export async function revokeAccessToken(input: RevokeAccessTokenInput): Promise<Result<null>> {
  return core.revokeAccessToken(actionDeps(), input);
}

export async function submitGapAnswers(input: SubmitGapAnswersInput): Promise<Result<{ submitted: number }>> {
  return core.submitGapAnswers(actionDeps(), input);
}

export async function reviewGapAnswer(input: ReviewGapAnswerInput): Promise<Result<null>> {
  return core.reviewGapAnswer(actionDeps(), input);
}
