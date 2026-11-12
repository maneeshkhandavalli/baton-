import "server-only";

import type { Result } from "../contracts/api";
import { verifyIdentityPepper, type VerifiedPepper } from "./pepper-core";

/**
 * I2: the verified identity pepper (D27, D30). Fails closed with retryable `processing_failed`
 * (`details.reason = "identity_pepper_unverified"`); callers must not preview or parse without it.
 */
export function getVerifiedPepper(): Result<VerifiedPepper> {
  return verifyIdentityPepper(process.env);
}
