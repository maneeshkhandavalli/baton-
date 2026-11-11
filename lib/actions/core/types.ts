/**
 * What the server actions depend on (§11.1, D35). The real object is built once, server-only, in
 * lib/actions/deps.ts and has no override; tests pass their own fakes straight to the core functions.
 */

import type { Result } from "../../contracts/api";
import type { BatonQueries } from "../../contracts/queries";
import type { VerifiedActor } from "../../db/actor-rules";
import type { DbClient } from "../../db/client";
import type { StorageClient } from "../../db/storage";

export interface ActionDeps {
  /** The actor of the verified session (`auth.getUser()`), or null. The ONLY source of identity. */
  getActor(): Promise<VerifiedActor | null>;
  /** Service-role client for lib/db mutations; every SQL function re-checks the actor (§8.3). */
  adminDb(): DbClient;
  /** User-scoped client (RLS) for reads outside BatonQueries. */
  userDb(): Promise<DbClient>;
  /** User-scoped, RLS-protected reads used to re-read DTOs after a mutation. */
  queries: BatonQueries;
  userStorage(): Promise<StorageClient>;
  adminStorage(): StorageClient;
  /** For rate limiting only (§12.4). */
  clientIp(): Promise<string | null>;
  /** The trusted origin from BATON_SITE_URL (§12.3). Throws when it is missing or unsafe. */
  siteOrigin(): string;
  /** The AI provider id recorded with consent (`runConfig.provider`, I3 amendment 1). */
  consentProvider(): Result<string>;
  /** Refreshes the client router after a successful write. */
  revalidate(): void;
}
