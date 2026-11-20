import "server-only";

/**
 * Server wiring for Gmail delivery (Round 4, Agent E). The only reader of the GMAIL_* variables besides the pure
 * resolvers in gmail-core.ts (which receive the environment as an argument).
 */

import { getConnectorSecretKey } from "../connectors/secrets";
import { getVerifiedActor } from "../db/actor";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "../supabase/admin";
import type { EmailTransport } from "./core";
import { createGmailTransport, envRefreshToken, refreshTokenSource, resolveGmailConfig } from "./gmail-core";
import type { GmailRouteDeps } from "./gmail-routes";
import { createDbGmailTokenStore, openGmailRefreshToken, type RpcClient } from "./gmail-store";

const adminRpc = () => createSupabaseAdminClient() as unknown as RpcClient;

/** Event codes only: never an address, a token, a code or a message body. */
export function logEmailEvent(event: string, details: Record<string, string> = {}): void {
  console.warn(JSON.stringify({ scope: "email", event, ...details }));
}

/**
 * The Gmail transport when the four GMAIL_* variables are set AND a refresh token can exist (GMAIL_REFRESH_TOKEN, or
 * a sealed database row, which needs CONNECTOR_SECRET_KEY and the service key). Otherwise null, and lib/email/index.ts
 * falls back to Resend or to "not configured".
 */
export function gmailServerTransport(env: Readonly<Record<string, string | undefined>> = process.env): EmailTransport | null {
  const config = resolveGmailConfig(env);
  if (!config) return null;
  const key = getConnectorSecretKey(env as Record<string, string | undefined>);
  const envToken = envRefreshToken(env);
  const canUseDb = key.ok && isSupabaseAdminConfigured(env as Record<string, string | undefined>);
  if (!envToken && !canUseDb) return null;
  return createGmailTransport(
    config,
    refreshTokenSource({
      config,
      store: canUseDb ? createDbGmailTokenStore(adminRpc) : null,
      open: key.ok ? (sender, sealed) => openGmailRefreshToken(key.key, sender, sealed) : null,
      envToken,
    }),
  );
}

export function gmailRouteDeps(): GmailRouteDeps {
  return {
    env: process.env,
    getActor: async () => {
      const a = await getVerifiedActor();
      return a ? { profileId: a.profileId, email: a.email, emailConfirmed: a.emailConfirmed } : null;
    },
    store: () => createDbGmailTokenStore(adminRpc),
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    log: logEmailEvent,
  };
}
