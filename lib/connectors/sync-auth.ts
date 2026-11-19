/**
 * Authentication for POST /api/connectors/sync, separate from the pipeline's CRON_SECRET.
 *
 * The connector sync pulls provider messages and writes chat_import sources; the pipeline drain runs AI processing
 * jobs. They are different privileges, so each endpoint accepts only its own credential:
 *   - /api/connectors/sync  → CONNECTOR_SYNC_SECRET (bearer, or a dispatch header signed for "connector_sync")
 *   - /api/pipeline/drain   → CRON_SECRET (unchanged)
 * The sync refuses to run when CONNECTOR_SYNC_SECRET is unset, shorter than 32 characters or identical to
 * CRON_SECRET (a reused value would let either secret drive both endpoints). Errors name the variable, never a value.
 */

import { authenticateWorkerRequest, MIN_SECRET_LENGTH } from "../pipeline/worker-auth";

type Env = Record<string, string | undefined>;

export type ConnectorSyncAuth =
  | { ok: true; via: "bearer" | "dispatch" }
  | { ok: false; status: 401; error: "unauthorized"; reason: string }
  | { ok: false; status: 503; error: "sync_not_configured"; reason: "sync_secret_unset" | "sync_secret_reused"; message: string };

const NOT_CONFIGURED = `Connector sync is not configured: set CONNECTOR_SYNC_SECRET (at least ${MIN_SECRET_LENGTH} characters, different from CRON_SECRET).`;

export function authenticateConnectorSync(headers: Headers, env: Env = process.env, nowMs: number = Date.now()): ConnectorSyncAuth {
  if (headers.get("authorization") === null && headers.get("x-baton-dispatch") === null) {
    return { ok: false, status: 401, error: "unauthorized", reason: "no_credentials" };
  }
  const secret = env.CONNECTOR_SYNC_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, status: 503, error: "sync_not_configured", reason: "sync_secret_unset", message: NOT_CONFIGURED };
  }
  if (env.CRON_SECRET && env.CRON_SECRET === secret) {
    return { ok: false, status: 503, error: "sync_not_configured", reason: "sync_secret_reused", message: NOT_CONFIGURED };
  }
  const auth = authenticateWorkerRequest(headers, secret, nowMs, "connector_sync");
  return auth.ok ? { ok: true, via: auth.via } : { ok: false, status: 401, error: "unauthorized", reason: auth.reason };
}
