/**
 * Evidence status for any claim in a handover.
 * - sourced:     directly supported by a cited source document
 * - inferred:    reasonably derived from sources, but not stated outright
 * - conflicting: sources disagree
 * - missing:     knowledge the handover needs but no source covers
 *
 * Canonical definition: lib/contracts/enums.ts. Re-exported here so Phase 01 imports keep working.
 */
export { EVIDENCE_STATUSES } from "@/lib/contracts/enums";
export type { EvidenceStatus } from "@/lib/contracts/enums";
