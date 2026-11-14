/** Handover lifecycle actions (§9, §11.3, §12.9). */

import type { Result } from "../../contracts/api";
import type { HandoverSummary, PublicationSummary } from "../../contracts/dto";
import {
  createHandoverInput,
  handoverIdInput,
  offerCreatorTransferInput,
  publishHandoverInput,
  respondToCreatorTransferInput,
  updateHandoverDetailsInput,
} from "../../contracts/schemas";
import type {
  CreateHandoverInput,
  OfferCreatorTransferInput,
  PublishHandoverInput,
  RespondToCreatorTransferInput,
  UpdateHandoverDetailsInput,
} from "../../contracts/schemas";
import { isDbError } from "../../db/errors";
import * as mutations from "../../db/mutations";
import { deleteHandoverRawObjects } from "../../db/storage";
import { createInputMasker } from "./mask";
import { action, failWith, ok, parseInput } from "./run";
import type { ActionDeps } from "./types";

/** R3 C1: the safe message and reason for a stale draft edit (optimistic concurrency). */
export const STALE_DRAFT_MESSAGE = "This draft was changed somewhere else. Reload it to see the latest details.";
export const STALE_DRAFT_REASON = "stale_draft";

/** startProcessing refused by the consent check: every source needs consent for the configured provider. */
export const CONSENT_REQUIRED_REASON = "consent_required";
export const CONSENT_REQUIRED_MESSAGE = "Every source needs consent for the current AI provider. Confirm the consent statement again, then start processing.";

/**
 * R3 C2: a double-click or a retried submission with the same details returns the SAME draft (the database
 * reuses an untouched draft created by the same actor in the last 2 minutes), so the wizard never ends up
 * with two empty drafts. Different details always create a new draft.
 */
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
 * R3 C1: edit a draft's details. D35 order: validate → verified actor → mask (one masker per request, like
 * createHandover) → re-validate the masked values → update_handover_details (creator or outgoing member,
 * draft only, optimistic concurrency on `expectedUpdatedAt`) → RLS re-read.
 *
 * `roleTitle` / `description`: omitted keeps the stored value; an empty string clears it. A stale
 * `expectedUpdatedAt` is `conflict` with `details.reason = "stale_draft"`: reload the draft (its new
 * `updatedAt`) before saving again. A retry of a save that already committed succeeds (nothing changes).
 */
export async function updateHandoverDetails(deps: ActionDeps, input: UpdateHandoverDetailsInput): Promise<Result<HandoverSummary>> {
  return action(deps, updateHandoverDetailsInput, input, async (actor, v) => {
    const m = createInputMasker();
    const masked = parseInput(updateHandoverDetailsInput, {
      ...v,
      title: m.text(v.title),
      teamName: m.text(v.teamName),
      roleTitle: m.optional(v.roleTitle),
      description: m.optional(v.description),
    });
    if (!masked.ok) return masked;
    try {
      await mutations.updateHandoverDetails(deps.adminDb(), actor, masked.data);
    } catch (error) {
      if (isDbError(error) && error.code === "conflict" && !error.retryable) {
        return failWith("conflict", { message: STALE_DRAFT_MESSAGE, details: { reason: STALE_DRAFT_REASON } });
      }
      throw error;
    }
    return deps.queries.getHandover(v.handoverId);
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
    let runId: string;
    try {
      ({ runId } = await mutations.startProcessing(deps.adminDb(), actor, {
        handoverId: v.handoverId,
        pipelineVersion: plan.data.pipelineVersion,
        aiConfig: { ...plan.data.aiConfig },
        jobs: plan.data.jobs,
      }));
    } catch (error) {
      // The plan mirrors start_processing's source scope, so a precondition refusal here is its consent
      // check: a source without consent, or with consent recorded for another AI provider (e.g. a source
      // consented while the test adapter was configured). Tell the client to collect consent again.
      if (isDbError(error) && error.code === "precondition_failed") {
        return failWith("precondition_failed", { message: CONSENT_REQUIRED_MESSAGE, details: { reason: CONSENT_REQUIRED_REASON } });
      }
      throw error;
    }
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

/**
 * Soft-deletes the handover, then (only after that commit) removes its raw uploads best-effort (R3-C6), so
 * a discarded draft does not keep raw, unmasked chat exports in Storage. Cleanup failures never fail the
 * action: failed objects keep their raw path and the retention sweep retries them (same as removeSource).
 */
export async function deleteHandover(deps: ActionDeps, input: { handoverId: string }): Promise<Result<null>> {
  return action(deps, handoverIdInput, input, async (actor, v) => {
    const db = deps.adminDb();
    await mutations.deleteHandover(db, actor, v.handoverId);
    try {
      await deleteHandoverRawObjects(db, deps.adminStorage(), actor, v.handoverId);
    } catch {
      // retried by the retention sweep (docs/proposals/retention.md)
    }
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
