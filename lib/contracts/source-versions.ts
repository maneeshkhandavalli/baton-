/**
 * R3 Task 05B: source version helpers (pure). A source without `version` (a database before migration
 * 20261117500100) is its own current version 1, so every caller behaves as before on an older database.
 */

import type { SourceSummary } from "./dto";

/** The active version of its source: the only one that is processed. */
export function isCurrentSourceVersion(s: Pick<SourceSummary, "version">): boolean {
  return !s.version || (s.version.versionNumber !== null && s.version.supersededAt === null);
}

/** An update that is being uploaded or awaits consent; it becomes current only when consent is recorded. */
export function isPendingSourceVersion(s: Pick<SourceSummary, "version">): boolean {
  return !!s.version && s.version.versionNumber === null;
}

/** An earlier version, kept for its evidence and history. */
export function isSupersededSourceVersion(s: Pick<SourceSummary, "version">): boolean {
  return !!s.version && s.version.supersededAt !== null;
}

/** R3 Task 05C: a plain description of where a source update stands. */
export function sourceUpdateStateLabel(state: string | null, errorCode: string | null, openReviews = 0): string {
  const decide = openReviews > 0 ? `; ${openReviews} ${openReviews === 1 ? "change needs" : "changes need"} a decision` : "";
  switch (state) {
    case "awaiting_processing":
      return "waiting to be processed";
    case "processing":
      return "being processed";
    case "awaiting_detection":
      return "processed; Baton hasn't yet checked how it changes the handover: process it again to run the check";
    case "ready":
      // R3 Task 05D: fully evaluated (extraction complete and change detection recorded)
      return openReviews > 0 ? `processed and checked${decide}` : "processed and checked; nothing left to decide";
    case "failed":
      return errorCode === "extraction_partial"
        ? `only partly read: process it again, or acknowledge it when publishing${decide}`
        : errorCode === "extraction_failed"
          ? `couldn't be read: process it again, or acknowledge it when publishing${decide}`
          : errorCode === "detection_incomplete"
            ? "read, but the check of how it changes the handover didn't finish: process it again"
            : "processing didn't finish: process it again";
    case "superseded":
      return "replaced by a newer version";
    default:
      return "";
  }
}

/** The outcomes `create_source_version` returns (see the migration). */
export const SOURCE_VERSION_OUTCOMES = [
  "created",
  "resumed",
  "awaiting_confirmation",
  "awaiting_consent",
  "unchanged",
  "stale",
  "update_in_progress",
  "exclusions_not_portable",
] as const;
export type SourceVersionOutcome = (typeof SOURCE_VERSION_OUTCOMES)[number];

/** Reason tokens (AppError.details.reason) of the version refusals, with fixed, safe messages. */
export const SOURCE_VERSION_REFUSALS = {
  stale: {
    code: "conflict",
    message: "This source has a newer version since you opened it. Reload, then upload your file as a new version of the current one.",
  },
  update_in_progress: {
    code: "conflict",
    message: "Another new version of this source is already being added. Finish it, or discard it, before uploading a different file.",
  },
  exclusions_not_portable: {
    code: "precondition_failed",
    message:
      "This source has conversations excluded by position, which can't be matched in a new file. Add the new file as a separate source instead.",
  },
} as const;

export const SOURCE_VERSION_ACCESS_BROADENED_REASON = "source_version_access_broadened";
export const SOURCE_VERSION_ACCESS_BROADENED_MESSAGE =
  "A new version can't be visible to more people than the version it replaces. Keep its access level or choose a stricter one.";
export const SOURCE_VERSION_STALE_REASON = "source_version_stale";
export const SOURCE_VERSION_KIND_REASON = "source_version_kind_changed";
export const SOURCE_VERSION_KIND_MESSAGE = "A new version must be the same type of file as the source it replaces.";
