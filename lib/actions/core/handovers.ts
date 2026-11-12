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
 * I3: listSources (RLS) → the server's AI run config (never from the request; without a provider nothing is
 * written) → planProcessingRun → start_processing, which re-checks role, lifecycle, consent provider and
 * the included sources in SQL → scheduleDrain only after the run exists. The jobs are passed through as
 * planned. The drain is fire-and-forget and never awaited.
 */
export async function startProcessing(deps: ActionDeps, input: { handoverId: string }): Promise<Result<{ runId: string }>> {
  return action(deps, handoverIdInput, input, async (actor, v) => {
    const sources = await deps.queries.listSources(v.handoverId);
    if (!sources.ok) return sources;
    const ai = deps.aiRunConfig();
    if (!ai.ok) return ai;
    const plan = deps.planProcessingRun({
      handoverId: v.handoverId,
      sources: sources.data.map((s) => ({ id: s.id, state: s.state, rawAvailable: s.rawDeletedAt === null })),
      aiConfig: ai.data,
    });
    if (!plan.ok) return plan;
    const { runId } = await mutations.startProcessing(deps.adminDb(), actor, {
      handoverId: v.handoverId,
      pipelineVersion: plan.data.pipelineVersion,
      aiConfig: { ...plan.data.aiConfig },
      jobs: plan.data.jobs,
    });
    try {
      deps.scheduleDrain();
    } catch {
      // never fails the action: the cron sweep picks the queued jobs up
    }
    return ok({ runId });
  });
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
