/**
 * Round 4 connector DTOs: what the browser may see about connectors (no credentials, no provider ids beyond the
 * channel/installation ids needed to act). Returned by lib/actions/connectors.ts.
 */

import type { ConnectorProvider, InstallationStatus, LinkState } from "../connectors/types";

export type { ConnectorProvider, InstallationStatus, LinkState };

export interface ConnectorProviderStatus {
  provider: ConnectorProvider;
  /** All required server variables are set (lib/connectors/config.ts). */
  configured: boolean;
  /** Same-origin path that starts installation for this handover; null when not configured or not applicable (Telegram). */
  installPath: string | null;
  /** A `/handover` chat command is answered for this provider (Slack: only when SLACK_SLASH_COMMAND is on). */
  slashCommand?: boolean;
  /** Slack only: private channels can be linked (SLACK_PRIVATE_CHANNELS). */
  privateChannels?: boolean;
}

export interface ConnectorInstallationSummary {
  id: string;
  provider: ConnectorProvider;
  accountLabel: string;
  status: InstallationStatus;
  statusReason: string | null;
}

export interface ConnectorLinkSummary {
  id: string;
  provider: ConnectorProvider;
  installationId: string;
  accountLabel: string;
  channelLabel: string;
  state: LinkState;
  consentVersion: string | null;
  consentedAt: string | null;
  bufferedCount: number;
  lastEventAt: string | null;
  lastFlushAt: string | null;
  /** A FlushRefusal code (lib/connectors/flush.ts) or null. */
  lastFlushError: string | null;
  sourceId: string | null;
  settings: Record<string, unknown>;
}

export interface HandoverConnectorsView {
  /** Only the creator manages connectors; others see nothing (the settings page is review-only). */
  canManage: boolean;
  providers: ConnectorProviderStatus[];
  installations: ConnectorInstallationSummary[];
  links: ConnectorLinkSummary[];
}

export interface ChannelChoiceDto {
  id: string;
  label: string;
  blockedReason: "bot_not_member" | "missing_permission" | "privacy_mode" | "private_channel" | null;
  /** Already linked to this handover (any non-revoked state). */
  linked: boolean;
}

export interface CaptureConsentDto {
  version: string;
  statement: string[];
  maxHistoryDays: number;
  /** Provider supports importing existing history. */
  historyAvailable: boolean;
}

/** A verified link intent from a bot command (the /connect page). */
export interface LinkIntentDto {
  provider: ConnectorProvider;
  accountLabel: string;
  channelLabel: string;
  /** Handovers the signed-in user created that can take a connector (draft or in review). */
  handovers: Array<{ id: string; title: string }>;
}
