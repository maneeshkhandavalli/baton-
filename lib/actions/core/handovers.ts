/** Handover lifecycle actions (§9, §11.3, §12.9). */

import type { Result } from "../../contracts/api";
import type { HandoverSummary, PublicationSummary } from "../../contracts/dto";
import {
  createHandoverInput,
  handoverIdInput,
  offerCreatorTransferInput,
  publishHandoverInput,
  respondToCreatorTransferInput,
} from "../../contracts/schemas";
import type {
  CreateHandoverInput,
  OfferCreatorTransferInput,
  PublishHandoverInput,
  RespondToCreatorTransferInput,
} from "../../contracts/schemas";
import * as mutations from "../../db/mutations";
import { createInputMasker } from "./mask";
import { action, failWith, ok, parseInput } from "./run";
import type { ActionDeps } from "./types";

export async function createHandover(deps: ActionDeps, input: CreateHandoverInput): Promise<Result<HandoverSummary>> {
  return action(deps, createHandoverInput, input, async (actor, v) => {
    const m = createInputMasker();
    const masked = parseInput(createHandoverInput, {
      ...v,
      title: m.text(v.title),
      teamName: m.text(v.teamName),
      roleTitle: m.optional(v.roleTitle),
      description: m.optional(v.description),
    });
    if (!masked.ok) return masked;
    const handoverId = await mutations.createHandover(deps.adminDb(), actor, masked.data);
    return deps.queries.getHandover(handoverId);
  });
}

/**
 * B3: wired to lib/ai (getAiConfiguration) and lib/pipeline (planProcessingRun, scheduleDrain) once those are
 * merged. Until then it fails closed: no AI provider is configured (D11 open), so nothing is enqueued.
 */
export async function startProcessing(deps: ActionDeps, input: { handoverId: string }): Promise<Result<{ runId: string }>> {
  return action(deps, handoverIdInput, input, async () =>
    failWith("precondition_failed", { details: { reason: "provider_not_configured" } }),
  );
}

export async function cancelProcessing(deps: ActionDeps, input: { handoverId: string }): Promise<Result<null>> {
  return action(deps, handoverIdInput, input, async (actor, v) => {
    await mutations.cancelProcessing(deps.adminDb(), actor, v.handoverId);
    return ok(null);
  });
}

export async function publishHandover(deps: ActionDeps, input: PublishHandoverInput): Promise<Result<PublicationSummary>> {
  return action(deps, publishHandoverInput, input, async (actor, v) => {
    const summary = v.summary?.trim() ? createInputMasker().text(v.summary.trim()) : undefined;
    const publicationId = await mutations.publishHandover(deps.adminDb(), actor, { handoverId: v.handoverId, summary });
    const handover = await deps.queries.getHandover(v.handoverId);
    if (!handover.ok) return handover;
    const published = await deps.queries.getPublishedHandover(v.handoverId);
    if (!published.ok) return published;
    if (published.data.publicationId.toLowerCase() !== publicationId.toLowerCase()) return failWith("conflict");
    return ok({
      publicationId,
      handoverId: handover.data.id,
      version: published.data.version,
      publishedAt: published.data.publishedAt,
      handoverState: handover.data.state,
    });
  });
}

export async function startRevision(deps: ActionDeps, input: { handoverId: string }): Promise<Result<HandoverSummary>> {
  return action(deps, handoverIdInput, input, async (actor, v) => {
    await mutations.startRevision(deps.adminDb(), actor, v.handoverId);
    return deps.queries.getHandover(v.handoverId);
  });
}

export async function deleteHandover(deps: ActionDeps, input: { handoverId: string }): Promise<Result<null>> {
  return action(deps, handoverIdInput, input, async (actor, v) => {
    await mutations.deleteHandover(deps.adminDb(), actor, v.handoverId);
    return ok(null);
  });
}

/** Creator only; a self-target is validation_failed inside offer_creator_transfer (§12.9). */
export async function offerCreatorTransfer(deps: ActionDeps, input: OfferCreatorTransferInput): Promise<Result<null>> {
  return action(deps, offerCreatorTransferInput, input, async (actor, v) => {
    await mutations.offerCreatorTransfer(deps.adminDb(), actor, v);
    return ok(null);
  });
}

/** Only the offered member; transfer_creator re-checks every invariant (§12.9). */
export async function respondToCreatorTransfer(deps: ActionDeps, input: RespondToCreatorTransferInput): Promise<Result<null>> {
  return action(deps, respondToCreatorTransferInput, input, async (actor, v) => {
    await mutations.respondToCreatorTransfer(deps.adminDb(), actor, v);
    return ok(null);
  });
}
