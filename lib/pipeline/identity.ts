/**
 * Pipeline side of participant pseudonymisation (Round 3 Task 02, PRIV-1).
 *
 * - `openPeople` decrypts the handover's sealed labels in memory (identity-vault.ts). A label that does not
 *   verify is treated as unknown (null), never as an error message or a log line.
 * - `loadJobIdentity` gives the extract and verify_support stages the handover's detector, and enforces the
 *   legacy gate: a source parsed before pseudonymisation (plain-text names) is not sent to the AI unless the
 *   owner explicitly allows it (BATON_ALLOW_LEGACY_IDENTITY_SOURCES=1).
 * - `findsIdentity` is the output guard: model text that names a known participant, or an excluded person
 *   (found by hash, excluded-discovery.ts), is refused.
 * Nothing here logs names, labels or keys.
 */

import { listHandoverPeopleForJob, type SealedPerson } from "../db/pipeline";
import { compileExclusions, type CompiledExclusions } from "../privacy/exclusions";
import { discoverExcludedNames, hasExcludedNameRules } from "../privacy/excluded-discovery";
import { getIdentityMapKey, openLabel, type IdentityMapKey, type IdentityMapKeyResult } from "../privacy/identity-vault";
import { createPseudonymizer, type KnownPerson, type Pseudonymizer } from "../privacy/pseudonymize";
import { claimOf, type StageContext } from "./stage-context";
import { failure, type PipelineFailure } from "./types";

/** A display label that carries no name (phone-number senders, labels that named an excluded person). */
export function vaultLabelFor(displayLabel: string): string | null {
  return /^Participant \d+$/.test(displayLabel) ? null : displayLabel;
}

export function openPeople(key: IdentityMapKey | null, handoverId: string, sealed: readonly SealedPerson[]): KnownPerson[] {
  return sealed.map((p) => ({
    ordinal: p.ordinal,
    label: key === null || p.sealed === null ? null : openLabel(key, handoverId, p.personKey, p.sealed, p.keyVersion),
  }));
}

/** The map key for the stage: the context's reader when present (tests), else the server environment. */
export function identityMapKeyFor(ctx: Pick<StageContext, "getIdentityMapKey">): IdentityMapKeyResult {
  return ctx.getIdentityMapKey ? ctx.getIdentityMapKey() : getIdentityMapKey();
}

export function legacySourcesAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.BATON_ALLOW_LEGACY_IDENTITY_SOURCES === "1";
}

export interface JobIdentity {
  detector: Pseudonymizer;
  /** True when the job's source predates pseudonymisation (only reachable with the owner's override). */
  legacySource: boolean;
}

/**
 * For extract (source-scoped) and verify_support (handover-scoped). Fails retryable when people exist but
 * the map key is missing; fails non-retryable for a legacy source unless the override is set.
 */
export async function loadJobIdentity(
  ctx: StageContext,
  opts: { sourceScoped: boolean },
): Promise<{ ok: true; identity: JobIdentity } | { ok: false; failure: PipelineFailure }> {
  const { people, sourceIdentityScheme } = await listHandoverPeopleForJob(ctx.db, claimOf(ctx));
  const legacySource = opts.sourceScoped && sourceIdentityScheme === null;
  if (legacySource && !legacySourcesAllowed()) {
    ctx.logger.warn("legacy_identity_source_refused", { jobId: ctx.claimed.id, sourceId: ctx.job.job.sourceId });
    return { ok: false, failure: failure("precondition_failed", "source_not_pseudonymized") };
  }
  let key: IdentityMapKey | null = null;
  if (people.some((p) => p.sealed !== null)) {
    const k = identityMapKeyFor(ctx);
    if (!k.ok) {
      ctx.logger.error("identity_map_key_unverified", { jobId: ctx.claimed.id, reason: k.reason });
      return { ok: false, failure: failure("processing_failed", "identity_map_key_unverified", true) };
    }
    key = k.key;
  }
  return { ok: true, identity: { detector: createPseudonymizer(openPeople(key, ctx.job.job.handoverId, people)), legacySource } };
}

/** Excluded-name guard material: the source's apply rules (compiled) and the pepper, or null when not needed. */
export interface ExcludedGuard {
  exclusions: CompiledExclusions;
  pepper: string;
}

export function excludedGuardFrom(rules: unknown, pepper: string | null): ExcludedGuard | null | "pepper_required" {
  const exclusions = compileExclusions(rules);
  if (!hasExcludedNameRules(exclusions)) return null;
  if (pepper === null) return "pepper_required";
  return { exclusions, pepper };
}

/** True when any string names a known participant or an excluded person. */
export function findsIdentity(strings: readonly string[], detector: Pseudonymizer, excluded: ExcludedGuard | null): boolean {
  if (!detector.isEmpty && strings.some((s) => detector.containsKnownName(s))) return true;
  if (excluded && discoverExcludedNames(strings, excluded.exclusions, excluded.pepper).length > 0) return true;
  return false;
}

/** Every string inside a JSON-like value. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}
