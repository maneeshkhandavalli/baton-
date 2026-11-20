"use client";

/**
 * Provider-specific link settings rendered under a link row of the "Connected channels" panel. Main wires Worker 02's
 * GitHub component (components/connectors/providers/github*) here at integration; the chat bots need none.
 */

import type { ComponentType } from "react";

import type { ConnectorLinkSummary, ConnectorProvider } from "@/lib/contracts/connectors";

import { GithubLinkSettings } from "./providers/github-link-settings";

export interface ProviderSettingsProps {
  handoverId: string;
  link: ConnectorLinkSummary;
  /** Call after settings were saved so the panel reloads its view. */
  onSaved(): void;
}

export const PROVIDER_SETTINGS: Record<ConnectorProvider, ComponentType<ProviderSettingsProps> | null> = {
  github: GithubLinkSettings,
  discord: null,
  slack: null,
  telegram: null,
};
