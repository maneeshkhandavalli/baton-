/**
 * The sealed Gmail refresh token in the database (migration 20261121400100_email_sender_credentials.sql). The table has
 * RLS on, no policies and no grants: only the service role can reach it, and only through two SQL functions. The
 * database only ever holds the sealed envelope (lib/connectors/secrets.ts), never the token itself.
 */

import { openCredentials, sealCredentials, type ConnectorSecretKey } from "../connectors/secrets";
import { GMAIL_SEAL_PROVIDER, type GmailTokenStore, type StoredGmailSender } from "./gmail-core";

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export function createDbGmailTokenStore(db: () => RpcClient): GmailTokenStore {
  return Object.freeze({
    async get(): Promise<StoredGmailSender | null> {
      const { data, error } = await db().rpc("email_sender_credentials_get", { p_provider: "gmail" });
      if (error) throw new Error("email_sender_credentials_get failed");
      const row = (Array.isArray(data) ? data[0] : data) as { sender_email?: unknown; sealed_refresh_token?: unknown } | null | undefined;
      if (!row || typeof row.sender_email !== "string" || typeof row.sealed_refresh_token !== "string") return null;
      return { senderEmail: row.sender_email, sealedRefreshToken: row.sealed_refresh_token };
    },
    async put(row: Parameters<GmailTokenStore["put"]>[0]) {
      const { error } = await db().rpc("email_sender_credentials_put", {
        p_provider: "gmail",
        p_sender_email: row.senderEmail,
        p_sealed_refresh_token: row.sealedRefreshToken,
        p_scopes: row.scopes,
        p_connected_by: row.connectedBy,
      });
      if (error) throw new Error("email_sender_credentials_put failed");
    },
  });
}

/** Seals a refresh token for one sender address (the address is the AAD, so an envelope never opens for another). */
export function sealGmailRefreshToken(key: ConnectorSecretKey, senderEmail: string, refreshToken: string): string {
  return sealCredentials(key, GMAIL_SEAL_PROVIDER, senderEmail.toLowerCase(), refreshToken);
}

export function openGmailRefreshToken(key: ConnectorSecretKey, senderEmail: string, envelope: string): string | null {
  return openCredentials(key, GMAIL_SEAL_PROVIDER, senderEmail.toLowerCase(), envelope);
}
