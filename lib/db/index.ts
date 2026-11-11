import "server-only";

/**
 * Server entry point of the data-access layer (§11.1). Nothing here may be imported by UI code.
 *
 *   * Reads: `dbQueries` (BatonQueries) uses the user's session, so RLS applies. Main's lib/data switches
 *     from lib/mocks to it at integration time.
 *   * Writes (security fix H1): main's Server Functions call `requireVerifiedActor()` (lib/supabase/auth)
 *     and pass that actor with `serverDb()` to the lib/db/mutations functions. The browser has no
 *     EXECUTE on any mutation function.
 */

import type { BatonQueries } from "../contracts/queries";
import { createSupabaseAdminClient } from "../supabase/admin";
import { asDbClient } from "../supabase/db";
import { createSupabaseServerClient } from "../supabase/server";
import { requestClientIp } from "../supabase/request-ip";
import type { DbClient } from "./client";
import { createDbQueries } from "./queries";
import type { StorageClient } from "./storage";

/** User-scoped client for the current request (RLS applies). Reads only. */
export async function userDb(): Promise<DbClient> {
  return asDbClient(await createSupabaseServerClient());
}

/** Service-role client for server-side mutations with a VerifiedActor, workers and token redemption. */
export function serverDb(): DbClient {
  return asDbClient(createSupabaseAdminClient());
}

/** The user's storage client: signs direct uploads so the bucket's INSERT policy applies to that user. */
export async function userStorage(): Promise<StorageClient> {
  return (await createSupabaseServerClient()).storage as unknown as StorageClient;
}

export function serverStorage(): StorageClient {
  return createSupabaseAdminClient().storage as unknown as StorageClient;
}

/** The real BatonQueries implementation (§11.6). */
export const dbQueries: BatonQueries = createDbQueries({ user: userDb, admin: serverDb, clientIp: requestClientIp });

export type { VerifiedActor } from "./actor-rules";
export { getVerifiedActor } from "./actor";
export { DbError, isDbError, toAppError } from "./errors";
