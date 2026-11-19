/**
 * Round 4 connector contract (docs/round4/connectors-contract.md). Shared by every provider adapter
 * (GitHub, Discord, Slack, Telegram). Owned by Main: workers do not change these types; they ask Main.
 *
 * The model in one paragraph: a creator INSTALLS a provider account (a GitHub App installation, a Discord
 * guild, a Slack workspace, a Telegram group), then LINKS one channel/repository of it to one handover and
 * gives CAPTURE CONSENT. Only then are provider events for that channel accepted: each verified event is
 * de-duplicated by its provider delivery id, normalised into ConnectorMessage values and BUFFERED. A FLUSH turns
 * the buffered messages of a link into a `chat_import` source (first flush) or a new version of that source
 * (later flushes), through the existing upload → confirm → consent → processing pipeline. Events for channels
 * without a capturing link are acknowledged and dropped without storing any content.
 */

export const CONNECTOR_PROVIDERS = ["github", "discord", "slack", "telegram"] as const;
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

export const isConnectorProvider = (v: unknown): v is ConnectorProvider =>
  typeof v === "string" && (CONNECTOR_PROVIDERS as readonly string[]).includes(v);

// ── Canonical message (what every adapter produces) ─────────────────────────

export const CONNECTOR_MESSAGE_KINDS = ["text", "system", "media_omitted", "deleted"] as const;
export type ConnectorMessageKind = (typeof CONNECTOR_MESSAGE_KINDS)[number];

/**
 * One platform-neutral message. Adapters must:
 *  - put only what a handover needs in `text` (no raw JSON payloads, no URLs with tokens, no email addresses
 *    on purpose; the parser masks what slips through);
 *  - use a display name or login as `authorLabel`, never an email address or phone number, never a provider
 *    user id (ids are not people-readable and would become a cross-source identifier);
 *  - make `providerMessageId` stable and unique within the link (an edit of the same message keeps the id).
 */
export interface ConnectorMessage {
  /** Stable per link, e.g. Slack `ts`, Discord snowflake, Telegram `message_id`, GitHub `pr:12:review:345`. ≤ 200 chars. */
  providerMessageId: string;
  /** ISO 8601 UTC instant the message was sent (or the GitHub event happened). */
  sentAt: string;
  /** Display name or login; ≤ 120 chars. "" only for kind "system". */
  authorLabel: string;
  kind: ConnectorMessageKind;
  /** Plain text, ≤ 20,000 chars ("" for media_omitted/deleted). */
  text: string;
  /** providerMessageId of the message this replies to (thread parent), when the platform has one. */
  replyToId?: string | null;
  /** Set when the platform reports an edit; the buffered message is replaced. */
  editedAt?: string | null;
}

export const CONNECTOR_MESSAGE_LIMITS = {
  providerMessageIdChars: 200,
  authorLabelChars: 120,
  textChars: 20_000,
  /** Messages accepted from ONE event (a GitHub push with many commits is trimmed to this). */
  messagesPerEvent: 100,
  /** Messages turned into ONE source version by a flush; the rest wait for the next flush. */
  messagesPerFlush: 5_000,
  /** Buffered, not yet flushed messages per link; beyond this new events are refused (`buffer_full`). */
  bufferedPerLink: 20_000,
} as const;

// ── Records the store returns (never contain credentials) ───────────────────

export const INSTALLATION_STATUSES = ["active", "suspended", "revoked", "error"] as const;
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];

export interface InstallationRecord {
  id: string;
  provider: ConnectorProvider;
  /** GitHub installation id, Discord guild id, Slack team id, Telegram chat id. */
  externalAccountId: string;
  /** Human label (org / server / workspace / group name). */
  accountLabel: string;
  status: InstallationStatus;
  /** Machine-readable reason for suspended/error/revoked, e.g. "provider_uninstalled", "token_revoked". */
  statusReason: string | null;
  installedByProfileId: string | null;
  scopes: string[];
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 *  pending_consent → capturing ⇄ paused;   any → revoked (terminal; buffered content deleted).
 *  Only `capturing` accepts events. Consent is per link, by the handover creator, with a versioned statement.
 */
export const LINK_STATES = ["pending_consent", "capturing", "paused", "revoked"] as const;
export type LinkState = (typeof LINK_STATES)[number];

export interface ChannelLinkRecord {
  id: string;
  installationId: string;
  provider: ConnectorProvider;
  handoverId: string;
  /** Discord/Slack channel id, Telegram chat id, GitHub repository id (numeric, as string). */
  externalChannelId: string;
  /** "#core-team", "owner/repo". Masked like any persisted text. */
  channelLabel: string;
  state: LinkState;
  /** Provider-specific settings, validated by the adapter (e.g. GitHub event families). JSON only. */
  settings: Record<string, unknown>;
  consentVersion: string | null;
  consentedAt: string | null;
  consentedByProfileId: string | null;
  /** The current version's source id of this link's chat_import lineage; null before the first flush. */
  sourceId: string | null;
  bufferedCount: number;
  lastEventAt: string | null;
  lastFlushAt: string | null;
  /** Last flush problem shown to the creator, e.g. "handover_not_accepting_updates". */
  lastFlushError: string | null;
  /** Pull-based providers (Discord): opaque position of the last message pulled (e.g. a snowflake). */
  pullCursor: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Event ledger (de-duplication, retries) ──────────────────────────────────

export const EVENT_STATUSES = ["received", "processed", "ignored", "failed"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface EventReceipt {
  eventId: string;
  /**
   * true when this delivery must be processed now: first time seen, OR seen before but `failed`, OR stuck in
   * `received` for longer than the reclaim window (a crashed handler). false = duplicate, acknowledge only.
   */
  process: boolean;
  previousStatus: EventStatus | null;
  attempts: number;
}

/** Why an event was acknowledged without storing content. Logged as a code, never with payload. */
export const IGNORE_REASONS = [
  "no_installation",
  "installation_inactive",
  "no_capturing_link",
  "unsupported_event",
  "bot_or_self_message",
  "empty",
] as const;
export type IgnoreReason = (typeof IGNORE_REASONS)[number];

export const FAILURE_CODES = ["buffer_full", "store_unavailable", "provider_error", "invalid_payload", "internal"] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

// ── Store (DB-backed in lib/connectors/store-db.ts, in-memory fake in store-memory.ts) ──

/** Who performs a lifecycle change: a verified Baton user, or the provider itself (uninstall webhook). */
export type ConnectorActor = { kind: "user"; profileId: string } | { kind: "provider" } | { kind: "system" };

export interface UpsertInstallationInput {
  provider: ConnectorProvider;
  externalAccountId: string;
  accountLabel: string;
  scopes: string[];
  /** AES-GCM envelope from lib/connectors/secrets.ts, or null for providers without per-install tokens. */
  credentials: string | null;
}

export interface LinkChannelInput {
  installationId: string;
  handoverId: string;
  externalChannelId: string;
  channelLabel: string;
  settings?: Record<string, unknown>;
}

export interface BufferResult {
  inserted: number;
  updated: number;
  /** true when the link was not capturing (consent withdrawn between routing and buffering): nothing stored. */
  refused: boolean;
}

export interface FlushBatch {
  linkId: string;
  handoverId: string;
  /** Creator profile that consented; the flush acts as this person (the DB re-checks creator + lifecycle). */
  actorProfileId: string;
  sourceId: string | null;
  channelLabel: string;
  provider: ConnectorProvider;
  /** Oldest first, at most messagesPerFlush. */
  messages: Array<ConnectorMessage & { bufferId: string }>;
}

export interface ConnectorStore {
  // events
  recordEvent(input: { provider: ConnectorProvider; deliveryId: string; externalAccountId: string | null; eventType: string }): Promise<EventReceipt>;
  finishEvent(eventId: string, outcome: { status: "processed" } | { status: "ignored"; reason: IgnoreReason } | { status: "failed"; code: FailureCode }): Promise<void>;

  // installations
  upsertInstallation(actor: ConnectorActor, input: UpsertInstallationInput): Promise<InstallationRecord>;
  findInstallation(provider: ConnectorProvider, externalAccountId: string): Promise<InstallationRecord | null>;
  getInstallation(installationId: string): Promise<InstallationRecord | null>;
  /** Server-only: the encrypted credentials envelope (decrypt with lib/connectors/secrets.ts). */
  getInstallationCredentials(installationId: string): Promise<string | null>;
  setInstallationStatus(actor: ConnectorActor, installationId: string, status: Exclude<InstallationStatus, "revoked">, reason: string | null): Promise<void>;
  /** Terminal: deletes credentials, revokes every link and deletes their buffered messages. Idempotent. */
  revokeInstallation(actor: ConnectorActor, installationId: string, reason: string): Promise<void>;

  // links
  /** The actor must be the handover's creator AND the person who installed the provider account. */
  linkChannel(actor: ConnectorActor, input: LinkChannelInput): Promise<ChannelLinkRecord>;
  recordCaptureConsent(actor: ConnectorActor, linkId: string, consentVersion: string): Promise<ChannelLinkRecord>;
  setLinkState(actor: ConnectorActor, linkId: string, state: "capturing" | "paused"): Promise<ChannelLinkRecord>;
  /** Terminal for the link: buffered messages deleted. Already-created sources stay (removed via the source UI). */
  revokeLink(actor: ConnectorActor, linkId: string, reason: string): Promise<void>;
  updateLinkSettings(actor: ConnectorActor, linkId: string, settings: Record<string, unknown>): Promise<ChannelLinkRecord>;
  getLink(linkId: string): Promise<ChannelLinkRecord | null>;
  /** Creator only (forbidden otherwise): every link of the handover, including revoked ones. */
  listLinksForHandover(actor: ConnectorActor, handoverId: string): Promise<ChannelLinkRecord[]>;
  listInstallationsForProfile(profileId: string): Promise<InstallationRecord[]>;
  /** Capturing links of one provider channel (one channel may feed several handovers). */
  capturingLinks(provider: ConnectorProvider, externalAccountId: string, externalChannelId: string): Promise<ChannelLinkRecord[]>;

  // buffer and flush
  bufferMessages(linkId: string, messages: readonly ConnectorMessage[]): Promise<BufferResult>;
  /** Links that have buffered messages and are due (capturing or paused; never revoked). */
  linksDueForFlush(limit: number): Promise<string[]>;
  takeFlushBatch(linkId: string): Promise<FlushBatch | null>;
  /** Deletes the flushed buffer rows and records the new current source id. */
  completeFlush(linkId: string, bufferIds: readonly string[], sourceId: string): Promise<void>;
  recordFlushError(linkId: string, code: string): Promise<void>;
  /** Pull-based providers: remember how far messages were pulled (system only; ≤ 200 chars). */
  setPullCursor(linkId: string, cursor: string): Promise<void>;
  /** Capturing links of one provider (for the scheduled pull of pull-based providers). */
  capturingLinksForProvider(provider: ConnectorProvider, limit: number): Promise<ChannelLinkRecord[]>;
}

// ── Provider adapter (each worker implements one per provider) ──────────────

/** What a webhook handler gets back from an adapter after verification and parsing. */
export interface NormalizedEvent {
  provider: ConnectorProvider;
  /** Provider delivery id used for de-duplication (GitHub X-GitHub-Delivery, Slack event_id, Telegram update_id, Discord interaction id). */
  deliveryId: string;
  /** Provider event name for the ledger, e.g. "pull_request.opened", "message", "message_edited". */
  eventType: string;
  externalAccountId: string | null;
  /** null for events that are not about one channel (installation lifecycle, pings). */
  externalChannelId: string | null;
  messages: ConnectorMessage[];
  /** Lifecycle signal handled by the shared ingest before message routing. */
  lifecycle?: { kind: "uninstalled" | "suspended" | "unsuspended" | "token_revoked" | "channel_removed"; reason: string } | null;
}

export type EventOutcome =
  | { status: "processed"; buffered: number; links: number }
  | { status: "ignored"; reason: IgnoreReason }
  | { status: "duplicate" }
  | { status: "failed"; code: FailureCode };
