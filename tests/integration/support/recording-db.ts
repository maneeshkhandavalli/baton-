/**
 * RecordingDb: a DbClient (lib/db/client.ts) that records every RPC in order and answers from scripted
 * handlers. It replaces only the network boundary; every lib/db function under test runs unmodified.
 *
 * An RPC without a handler is answered with an error (SQLSTATE XX000 → DbError "internal") and listed in
 * `unexpected`, so a test can assert that no unplanned database call happened (e.g. erase_participant).
 */

import type { DbClient, DbRpcResponse } from "../../../lib/db/client";

export type RpcHandler = (args: Record<string, unknown>) => unknown;

/** Throw from a handler to make the RPC fail with this SQLSTATE (e.g. "BTNF0", "23505"). */
export class RpcFailure extends Error {
  readonly sqlstate: string;
  readonly details: string | null;
  // (no TypeScript parameter properties: Node's type stripping does not support them)
  constructor(sqlstate: string, message = "synthetic database error", details: string | null = null) {
    super(message);
    this.sqlstate = sqlstate;
    this.details = details;
  }
}

export interface RpcCall {
  seq: number;
  fn: string;
  args: Record<string, unknown>;
}

export class RecordingDb implements DbClient {
  readonly calls: RpcCall[] = [];
  readonly unexpected: string[] = [];
  private readonly handlers = new Map<string, RpcHandler>();
  readonly events: string[];

  /** `events` may be shared with a RecordingStorage to assert cross-system ordering. */
  constructor(events: string[] = []) {
    this.events = events;
  }

  on(fn: string, handler: RpcHandler): this {
    this.handlers.set(fn, handler);
    return this;
  }

  /** Shorthand: the RPC returns `data`. */
  returns(fn: string, data: unknown): this {
    return this.on(fn, () => data);
  }

  /** Shorthand: the RPC fails with `sqlstate`. */
  fails(fn: string, sqlstate: string, message?: string): this {
    return this.on(fn, () => {
      throw new RpcFailure(sqlstate, message);
    });
  }

  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<DbRpcResponse> {
    const call: RpcCall = { seq: this.calls.length, fn, args: structuredClone(args) };
    this.calls.push(call);
    this.events.push(`db:${fn}`);
    const handler = this.handlers.get(fn);
    if (!handler) {
      this.unexpected.push(fn);
      return { data: null, error: { code: "XX000", message: `RecordingDb: no handler for ${fn}` } };
    }
    try {
      return { data: await handler(call.args), error: null };
    } catch (error) {
      if (error instanceof RpcFailure) {
        return { data: null, error: { code: error.sqlstate, message: error.message, details: error.details, hint: null } };
      }
      throw error;
    }
  }

  fns(): string[] {
    return this.calls.map((c) => c.fn);
  }

  called(fn: string): boolean {
    return this.calls.some((c) => c.fn === fn);
  }

  last(fn: string): RpcCall | undefined {
    return [...this.calls].reverse().find((c) => c.fn === fn);
  }
}
