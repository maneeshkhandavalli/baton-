/**
 * Provider adapter registry (Round 4 contract §6). Main owns this file; each worker owns ONLY its provider's
 * folder (lib/connectors/providers/<provider>/). Imports are lazy so a provider's code is loaded only when used.
 */

import type { ConnectorProvider } from "../types";
import type { ProviderServerAdapter } from "./adapter";

export async function providerAdapter(provider: ConnectorProvider): Promise<ProviderServerAdapter> {
  switch (provider) {
    case "github":
      return (await import("./github/server")).githubAdapter;
    case "discord":
      return (await import("./discord/server")).discordAdapter;
    case "slack":
      return (await import("./slack/server")).slackAdapter;
    case "telegram":
      return (await import("./telegram/server")).telegramAdapter;
  }
}
