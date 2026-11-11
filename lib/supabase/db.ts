/**
 * Adapts a Supabase client to lib/db's minimal `DbClient` (rpc only). Keeps @supabase/* types out of lib/db.
 */

import type { DbClient, DbRpcResponse } from "../db/client";

interface RpcCapable {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message: string; details?: string | null; hint?: string | null } | null }>;
}

export function asDbClient(client: unknown): DbClient {
  const rpcClient = client as RpcCapable;
  return {
    rpc: (fn, args) =>
      Promise.resolve(rpcClient.rpc(fn, args)).then((r): DbRpcResponse => ({ data: r.data, error: r.error })),
  };
}
