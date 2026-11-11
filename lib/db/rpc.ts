/** The single RPC primitive used by lib/db: calls a SQL function and turns its error into a DbError. */

import type { DbClient } from "./client";
import { DbError } from "./errors";

export async function callRpc(client: DbClient, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw DbError.fromRpc(error);
  return data;
}
