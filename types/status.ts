/**
 * Evidence status for any claim in a handover.
 * - sourced:     directly supported by a cited source document
 * - inferred:    reasonably derived from sources, but not stated outright
 * - conflicting: sources disagree
 * - missing:     knowledge the handover needs but no source covers
 */
export const EVIDENCE_STATUSES = ["sourced", "inferred", "conflicting", "missing"] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
