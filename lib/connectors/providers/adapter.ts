/**
 * Server-side provider adapter (Round 4 contract §6). One per provider, implemented by the owning worker in
 * lib/connectors/providers/<provider>/server.ts. Main's actions (lib/actions/connectors.ts) and the scheduled sync
 * call adapters ONLY through this interface; routes under app/api/connectors/<provider>/ are the worker's own.
 *
 * Rules for every adapter:
 *  - All provider HTTP calls go through `ctx.fetch` (tests inject a fake; no real network in tests).
 *  - Credentials come from `ctx.credentials(installation)` (decrypted server-side) or provider env; never log them,
 *    never return them, never put them in URLs or errors.
 *  - Errors: throw ProviderError with a code; never include provider response bodies in messages.
 */

import type { ConnectorSecretKey } from "../secrets";
import type { ChannelLinkRecord, ConnectorMessage, ConnectorProvider, ConnectorStore, InstallationRecord } from "../types";

export interface AdapterContext {
  store: ConnectorStore;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now(): number;
  /** Decrypted per-installation credentials (Slack bot token), or null. */
  credentials(installation: InstallationRecord): Promise<string | null>;
  secretKey: ConnectorSecretKey | null;
}

export interface ChannelChoice {
  id: string;
  /** "#core-team", "owner/repo", group title. */
  label: string;
  /**
   * Present when the bot cannot read this channel yet (e.g. Slack: not a member; Telegram: privacy mode).
   * `private_channel`: a Slack private channel while private channels are off on this server — linking is refused.
   */
  blockedReason?: "bot_not_member" | "missing_permission" | "privacy_mode" | "private_channel" | null;
}

export const PROVIDER_ERROR_CODES = ["not_configured", "unauthorized", "forbidden", "not_found", "rate_limited", "unavailable", "invalid_response"] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  /** Seconds until a retry is sensible (rate limits), when the provider says. */
  readonly retryAfterSeconds: number | null;
  constructor(code: ProviderErrorCode, retryAfterSeconds: number | null = null) {
    super(`provider error: ${code}`);
    this.name = "ProviderError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ProviderServerAdapter {
  provider: ConnectorProvider;
  /** Channels/repositories of an installation the creator may link (the picker). */
  listChannels(ctx: AdapterContext, installation: InstallationRecord): Promise<ChannelChoice[]>;
  /** One channel, verified with the provider (the label stored on the link comes from here, not the browser). */
  describeChannel(ctx: AdapterContext, installation: InstallationRecord, externalChannelId: string): Promise<ChannelChoice | null>;
  /**
   * Optional: messages already in the channel, newer than `sinceIso`, at most `limit` (pull-capable providers:
   * Slack conversations.history, Discord channel messages, GitHub REST). Only called when the creator opted in
   * to a history import at consent time (link.settings.historyDays > 0) or on "Bring in new messages".
   */
  fetchHistory?(ctx: AdapterContext, installation: InstallationRecord, link: ChannelLinkRecord, sinceIso: string, limit: number): Promise<ConnectorMessage[]>;
  /**
   * Optional, PULL-based providers only (Discord: message events exist only on the Gateway, which a serverless
   * deployment cannot hold). Messages of a capturing link newer than `link.pullCursor` (or than consent time when
   * null), oldest first, at most `limit`, and the new cursor. Main's scheduled sync and "Bring in new messages"
   * call it, then ingest the messages through ingestEvent (de-duplicated by `pull:<link>:<cursor>`).
   */
  pullNew?(ctx: AdapterContext, installation: InstallationRecord, link: ChannelLinkRecord, limit: number): Promise<{ messages: ConnectorMessage[]; cursor: string | null }>;
  /**
   * Pull-based providers: the cursor meaning "from this moment on". Used when a paused link resumes, so messages sent
   * while capture was paused are never pulled (the pause notice promises nothing is saved until it resumes).
   */
  cursorAt?(nowMs: number): string;
  /** Optional: post a visible notice in the channel when capture starts/pauses/stops (consent transparency). */
  announceCapture?(ctx: AdapterContext, installation: InstallationRecord, link: ChannelLinkRecord, change: "started" | "paused" | "stopped", by?: string | null): Promise<void>;
  /** Optional: revoke at the provider on disconnect (Slack auth.revoke, Discord leave guild, Telegram leave chat). */
  revokeAtProvider?(ctx: AdapterContext, installation: InstallationRecord): Promise<void>;
  /** Validates and normalises link.settings for this provider; throws ProviderError("invalid_response") never — returns null when invalid. */
  parseSettings?(settings: unknown): Record<string, unknown> | null;
}
