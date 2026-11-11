/** Gap questions, Gap Interview links and answers (§6.15, §6.16, §11.3, §12.3, §12.4). */

import type { Result } from "../../contracts/api";
import type { CreatedLink, GapQuestionSummary } from "../../contracts/dto";
import {
  createGapLinkInput,
  createGapQuestionInput,
  reviewGapAnswerInput,
  revokeAccessTokenInput,
  submitGapAnswersInput,
} from "../../contracts/schemas";
import type {
  CreateGapLinkInput,
  CreateGapQuestionInput,
  ReviewGapAnswerInput,
  RevokeAccessTokenInput,
  SubmitGapAnswersInput,
} from "../../contracts/schemas";
import * as mutations from "../../db/mutations";
import { isWellFormedToken } from "../../db/tokens";
import { routes } from "../../routes";
import { createInputMasker } from "./mask";
import { absoluteUrl, action, failWith, ok, parseInput, siteOriginOrFail, withActor, withoutActor } from "./run";
import type { ActionDeps } from "./types";

/** Review roles only (SQL). The server raises accessLevel to the point's level. */
export async function createGapQuestion(deps: ActionDeps, input: CreateGapQuestionInput): Promise<Result<GapQuestionSummary>> {
  return action(deps, createGapQuestionInput, input, async (actor, v) => {
    const m = createInputMasker();
    const masked = parseInput(createGapQuestionInput, { ...v, question: m.text(v.question), context: m.optional(v.context) });
    if (!masked.ok) return masked;
    const questionId = await mutations.createGapQuestion(deps.adminDb(), actor, masked.data);
    const questions = await deps.queries.listGapQuestions(v.handoverId);
    if (!questions.ok) return questions;
    const created = questions.data.find((q) => q.id.toLowerCase() === questionId.toLowerCase());
    return created ? ok(created) : failWith("not_found");
  });
}

/** Review roles. The raw token is returned once, inside an absolute url built from BATON_SITE_URL (§12.4). */
export async function createGapInterviewLink(deps: ActionDeps, input: CreateGapLinkInput): Promise<Result<CreatedLink>> {
  return action(deps, createGapLinkInput, input, async (actor, v) => {
    const site = siteOriginOrFail(deps); // before the token exists: a bad config leaves no orphan token
    if (!site.ok) return site;
    const link = await mutations.createGapInterviewLink(deps.adminDb(), actor, v);
    return ok({ tokenId: link.tokenId, url: absoluteUrl(site.origin, routes.token.gaps(link.rawToken)), expiresAt: link.expiresAt });
  });
}

/** Creator: any token of the handover. Other review roles: Gap Interview links only (SQL). */
export async function revokeAccessToken(deps: ActionDeps, input: RevokeAccessTokenInput): Promise<Result<null>> {
  return action(deps, revokeAccessTokenInput, input, async (actor, v) => {
    await mutations.revokeAccessToken(deps.adminDb(), actor, v.tokenId);
    return ok(null);
  });
}

/**
 * Session OR token (D8). With a token no account is needed: the label is self-declared and masked, and the
 * per-client and per-token rate limits are consumed first (§12.4). A held, unknown or out-of-scope question
 * fails as not_found (§5.5). With a session the database derives the answerer from the verified actor.
 */
export async function submitGapAnswers(deps: ActionDeps, input: SubmitGapAnswersInput): Promise<Result<{ submitted: number }>> {
  const parsed = parseInput(submitGapAnswersInput, input);
  if (!parsed.ok) return parsed;
  const m = createInputMasker();
  const masked = parseInput(submitGapAnswersInput, {
    ...parsed.data,
    answererLabel: m.optional(parsed.data.answererLabel),
    answers: parsed.data.answers.map((a) => ({ gapQuestionId: a.gapQuestionId, answerText: m.text(a.answerText) })),
  });
  if (!masked.ok) return masked;
  const v = masked.data;

  if (v.token !== undefined) {
    const rawToken = v.token;
    if (!isWellFormedToken(rawToken)) return failWith("token_invalid");
    return withoutActor(deps, async () => {
      const submitted = await mutations.submitGapAnswersWithToken(deps.adminDb(), {
        rawToken,
        answererLabel: v.answererLabel as string, // required with a token (schema refine)
        answers: v.answers,
        clientIp: await deps.clientIp(),
      });
      return ok({ submitted });
    });
  }

  return withActor(deps, async (actor) => {
    const submitted = await mutations.submitGapAnswers(deps.adminDb(), actor, v.answers);
    return ok({ submitted });
  });
}

/** Review roles; precondition_failed while the answer is privacy-held (SQL). */
export async function reviewGapAnswer(deps: ActionDeps, input: ReviewGapAnswerInput): Promise<Result<null>> {
  return action(deps, reviewGapAnswerInput, input, async (actor, v) => {
    const note = v.note?.trim() ? createInputMasker().text(v.note.trim()) : undefined;
    await mutations.reviewGapAnswer(deps.adminDb(), actor, { answerId: v.answerId, decision: v.decision, note });
    return ok(null);
  });
}
