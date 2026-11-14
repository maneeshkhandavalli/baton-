"use server";

/** Handover lifecycle Server Functions (§11.3). Logic: lib/actions/core/handovers.ts. */

import type { Result } from "../contracts/api";
import type { HandoverSummary, PublicationSummary } from "../contracts/dto";
import type {
  CreateHandoverInput,
  OfferCreatorTransferInput,
  PublishHandoverInput,
  RespondToCreatorTransferInput,
  UpdateHandoverDetailsInput,
} from "../contracts/schemas";
import * as core from "./core/handovers";
import { actionDeps } from "./deps";

export async function createHandover(input: CreateHandoverInput): Promise<Result<HandoverSummary>> {
  return core.createHandover(actionDeps(), input);
}

/** R3 C1: edit a draft's details (creator or outgoing member; optimistic concurrency on expectedUpdatedAt). */
export async function updateHandoverDetails(input: UpdateHandoverDetailsInput): Promise<Result<HandoverSummary>> {
  return core.updateHandoverDetails(actionDeps(), input);
}

export async function startProcessing(input: { handoverId: string }): Promise<Result<{ runId: string }>> {
  return core.startProcessing(actionDeps(), input);
}

/** Round 2 hosted preview: while a run is active, schedules one more fenced drain (no background loop on Vercel). */
export async function continueProcessing(input: { handoverId: string }): Promise<Result<{ active: boolean }>> {
  return core.continueProcessing(actionDeps(), input);
}

export async function cancelProcessing(input: { handoverId: string }): Promise<Result<null>> {
  return core.cancelProcessing(actionDeps(), input);
}

export async function publishHandover(input: PublishHandoverInput): Promise<Result<PublicationSummary>> {
  return core.publishHandover(actionDeps(), input);
}

export async function startRevision(input: { handoverId: string }): Promise<Result<HandoverSummary>> {
  return core.startRevision(actionDeps(), input);
}

export async function deleteHandover(input: { handoverId: string }): Promise<Result<null>> {
  return core.deleteHandover(actionDeps(), input);
}

export async function offerCreatorTransfer(input: OfferCreatorTransferInput): Promise<Result<null>> {
  return core.offerCreatorTransfer(actionDeps(), input);
}

export async function respondToCreatorTransfer(input: RespondToCreatorTransferInput): Promise<Result<null>> {
  return core.respondToCreatorTransfer(actionDeps(), input);
}
