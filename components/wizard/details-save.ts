/**
 * Pure helpers for autosaving a draft's details through `updateHandoverDetails` (R3 C1 → A2).
 * React-free so they are unit-tested (components/wizard/__tests__/details-save.test.ts).
 */

import type { AppError } from "@/lib/contracts/api";
import type { UpdateHandoverDetailsInput } from "@/lib/contracts/schemas";

export interface DetailsValues {
  title: string;
  teamName: string;
  roleTitle: string;
  /** `undefined` when the stored description isn't known to the client: it is then never sent (kept). */
  description?: string;
}

/** The action input. roleTitle is always sent ("" clears it); description only when known. */
export function detailsInput(handoverId: string, v: DetailsValues, expectedUpdatedAt: string): UpdateHandoverDetailsInput {
  return {
    handoverId,
    title: v.title,
    teamName: v.teamName,
    roleTitle: v.roleTitle,
    ...(v.description !== undefined ? { description: v.description } : {}),
    expectedUpdatedAt,
  };
}

export type SaveFailure =
  /** Someone/something saved a newer version: reload the draft, tell the user. */
  | { kind: "stale" }
  /** The handover is no longer a draft: continue on its processing page. */
  | { kind: "not_draft" }
  /** Field problems to show under the inputs. */
  | { kind: "fields"; fieldErrors: Record<string, string> }
  /** Transient (lock/network): try the same save once more. */
  | { kind: "retry" }
  /** Anything else: show the message, offer manual retry. */
  | { kind: "fail"; message: string };

export function classifySaveError(error: AppError): SaveFailure {
  if (error.code === "conflict" && error.details?.reason === "stale_draft") return { kind: "stale" };
  if (error.code === "invalid_transition") return { kind: "not_draft" };
  if (error.code === "validation_failed" && error.fieldErrors) {
    const fieldErrors: Record<string, string> = {};
    for (const [k, msgs] of Object.entries(error.fieldErrors)) if (msgs[0]) fieldErrors[k] = msgs[0];
    return { kind: "fields", fieldErrors };
  }
  if (error.retryable && !error.details?.reason) return { kind: "retry" };
  return { kind: "fail", message: error.message };
}

/** True when two value sets would save the same thing (used to skip no-op saves). */
export function sameDetails(a: DetailsValues, b: DetailsValues): boolean {
  return a.title === b.title && a.teamName === b.teamName && a.roleTitle === b.roleTitle && (a.description ?? null) === (b.description ?? null);
}
