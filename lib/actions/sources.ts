"use server";

/** Source Server Functions (§11.3). Logic: lib/actions/core/sources.ts. */

import type { Result } from "../contracts/api";
import type { SourceSummary, SourceUploadTicket } from "../contracts/dto";
import type { SourcePreview } from "../contracts/parser";
import type {
  AddExclusionInput,
  ConfirmIdentityMatchInput,
  CreateSourceUploadInput,
  RecordSourceConsentInput,
} from "../contracts/schemas";
import * as core from "./core/sources";
import { actionDeps } from "./deps";

export async function createSourceUpload(input: CreateSourceUploadInput): Promise<Result<SourceUploadTicket>> {
  return core.createSourceUpload(actionDeps(), input);
}

export async function confirmSourceUploaded(input: { sourceId: string }): Promise<Result<SourceSummary>> {
  return core.confirmSourceUploaded(actionDeps(), input);
}

export async function previewSource(input: { sourceId: string }): Promise<Result<SourcePreview>> {
  return core.previewSource(actionDeps(), input);
}

export async function recordSourceConsent(input: RecordSourceConsentInput): Promise<Result<SourceSummary>> {
  return core.recordSourceConsent(actionDeps(), input);
}

export async function addExclusion(input: AddExclusionInput): Promise<Result<{ exclusionId: string }>> {
  return core.addExclusion(actionDeps(), input);
}

export async function confirmIdentityMatch(input: ConfirmIdentityMatchInput): Promise<Result<null>> {
  return core.confirmIdentityMatch(actionDeps(), input);
}

export async function removeSource(input: { sourceId: string }): Promise<Result<null>> {
  return core.removeSource(actionDeps(), input);
}
