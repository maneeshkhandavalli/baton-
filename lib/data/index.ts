import "server-only";

/**
 * The read facade the UI uses (§11.1). This is the integration-time switch: it returns the real lib/db
 * implementation, whose reads run with the user's session so RLS decides what is visible (§8.3).
 * lib/mocks stays only behind /demo.
 */

import type { BatonQueries } from "../contracts/queries";
import { dbQueries } from "../db";

export function getQueries(): BatonQueries {
  return dbQueries;
}
