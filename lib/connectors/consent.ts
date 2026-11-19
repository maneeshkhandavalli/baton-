/**
 * Capture consent for a connector link (Round 4 contract §2). The creator confirms this statement for ONE channel
 * and ONE handover before Baton stores any message from it. The version is stored on the link; a changed statement
 * gets a new version. This is in ADDITION to the per-source processing consent every source already needs.
 */

import type { ConnectorProvider } from "./types";

export const CONNECTOR_CAPTURE_CONSENT_VERSION = "connector-capture-2026-11-19-v1";

/** Maximum days of existing history a creator may choose to import at consent time (pull-capable providers). */
export const MAX_HISTORY_DAYS = 30;

const NAMES: Record<ConnectorProvider, string> = { github: "GitHub", discord: "Discord", slack: "Slack", telegram: "Telegram" };

export function captureConsentStatement(provider: ConnectorProvider, channelLabel: string, historyDays: number): string[] {
  const where = `${NAMES[provider]} ${channelLabel}`;
  const what =
    provider === "github"
      ? "issues, pull requests, reviews, commits and releases of this repository (titles, descriptions and comments), not its code"
      : "messages posted in this channel";
  return [
    `Baton will store the ${what} from ${where} for this handover only, starting now${historyDays > 0 ? `, plus the last ${historyDays} days` : ""}.`,
    "I confirm I may share this content with Baton for a handover, and that the people in it have been told.",
    provider === "github" ? "Baton reads only the events listed above." : "Baton posts a short notice in the channel when capture starts, pauses or stops.",
    "Phone numbers, emails and other personal details are masked when the messages are read. Nothing is processed with AI until I review the source and give the usual processing consent.",
    "I can pause or disconnect at any time. Disconnecting deletes messages Baton has stored but not yet added to the handover.",
  ];
}
