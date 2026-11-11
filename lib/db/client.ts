/**
 * The minimal database surface lib/db depends on (docs/architecture/shared-contracts.md §11.1–§11.2).
 *
 * Every Baton read and write is a Postgres function (see supabase/migrations), so lib/db only needs
 * `rpc`. lib/supabase adapts a real Supabase client to this interface (`asDbClient`); tests use fakes.
 * Keeping lib/db independent of @supabase/* also keeps raw rows and client details out of UI code.
 */

export interface DbRpcError {
  /** SQLSTATE (PostgREST forwards it as `code`). */
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

export interface DbRpcResponse {
  data: unknown;
  error: DbRpcError | null;
}

export interface DbClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbRpcResponse>;
}

/** Lazily created clients. `user` carries the caller's session (RLS applies); `admin` is service-role. */
export interface DbClientFactories {
  user: () => Promise<DbClient> | DbClient;
  admin?: () => Promise<DbClient> | DbClient;
  /** The requesting client's IP, for rate limiting only (M6). */
  clientIp?: () => Promise<string | null> | string | null;
}
