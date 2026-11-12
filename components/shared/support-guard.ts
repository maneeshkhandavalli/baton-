/**
 * PI-11: when the deterministic injection guard overrides the verifier, the stored verdict is
 * `irrelevant` and the evidence DTO carries `guarded: true` (EvidenceItem.guarded, with the model's
 * original verdict in `modelVerdict`). Older readers may omit the flag; only then does the UI fall back
 * to recognising the FIXED rationale sentence (lib/ai/injection-guard.ts#GUARD_RATIONALE, server-only;
 * kept in sync by components/shared/__tests__/support-guard.test.ts).
 */

export const GUARD_RATIONALE_PREFIX = "Not counted as support: the evidence contains instructions addressed to an automated checker.";

export function isGuardedVerdict(e: { supportVerdict: string; verdictRationale: string | null; guarded?: boolean }): boolean {
  if (typeof e.guarded === "boolean") return e.guarded;
  return e.supportVerdict === "irrelevant" && !!e.verdictRationale && e.verdictRationale.startsWith(GUARD_RATIONALE_PREFIX);
}
