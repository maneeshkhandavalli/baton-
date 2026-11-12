/**
 * PI-11: when the deterministic injection guard overrides the verifier, the stored verdict is
 * `irrelevant` and the rationale is a FIXED sentence (lib/ai/injection-guard.ts#GUARD_RATIONALE,
 * server-only). The review DTO carries no separate flag yet, so the UI recognises the fixed
 * sentence. Keep in sync with GUARD_RATIONALE (tested in components/shared/__tests__).
 * Cross-owner request: expose `guarded: boolean` (and modelVerdict) on PointDetail evidence.
 */

export const GUARD_RATIONALE_PREFIX = "Not counted as support: the evidence contains instructions addressed to an automated checker.";

export function isGuardedVerdict(e: { supportVerdict: string; verdictRationale: string | null }): boolean {
  return e.supportVerdict === "irrelevant" && !!e.verdictRationale && e.verdictRationale.startsWith(GUARD_RATIONALE_PREFIX);
}
