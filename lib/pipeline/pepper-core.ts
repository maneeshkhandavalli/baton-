/**
 * Identity-pepper verification (§12.8 point 9, §12.11 point 7, D27, D30). Environment passed in, so it is
 * testable; `pepper.ts` is the server-only entry point that reads `process.env`.
 *
 * Fails closed: no new source is parsed unless IDENTITY_PEPPER is a valid p1 pepper (≥ 32 characters, no
 * surrounding whitespace), IDENTITY_PEPPER_VERSION is exactly "p1", and HMAC(pepper, canary message)
 * equals IDENTITY_PEPPER_CANARY. In production the golden test canary is refused. The failure never
 * describes the pepper; `details.check` only names which check failed, for operators.
 */

import { timingSafeEqual } from "node:crypto";

import type { Result } from "../contracts/api";
import { CURRENT_IDENTITY_PEPPER_VERSION, IDENTITY_GOLDEN_TEST_CANARY } from "../contracts/identity";
import { assertIdentityPepper, computeIdentityPepperCanary } from "../privacy/identity";

export type PepperEnv = Readonly<Record<string, string | undefined>>;

export interface VerifiedPepper {
  pepper: string;
  version: "p1";
}

type PepperCheck = "version" | "pepper" | "canary_format" | "canary_mismatch" | "test_canary_in_production";

function unverified(check: PepperCheck): Result<VerifiedPepper> {
  return {
    ok: false,
    error: {
      code: "processing_failed",
      message: "Processing is temporarily unavailable.",
      retryable: true,
      details: { reason: "identity_pepper_unverified", check },
    },
  };
}

export function verifyIdentityPepper(env: PepperEnv): Result<VerifiedPepper> {
  if (env.IDENTITY_PEPPER_VERSION !== CURRENT_IDENTITY_PEPPER_VERSION) return unverified("version");

  const pepper = env.IDENTITY_PEPPER;
  try {
    assertIdentityPepper(pepper);
  } catch {
    return unverified("pepper");
  }

  const canary = (env.IDENTITY_PEPPER_CANARY ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(canary)) return unverified("canary_format");
  if (env.NODE_ENV === "production" && canary === IDENTITY_GOLDEN_TEST_CANARY) return unverified("test_canary_in_production");

  const expected = Buffer.from(computeIdentityPepperCanary(pepper), "hex");
  if (!timingSafeEqual(expected, Buffer.from(canary, "hex"))) return unverified("canary_mismatch");

  return { ok: true, data: { pepper, version: "p1" } };
}
