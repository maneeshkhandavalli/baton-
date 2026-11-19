"use client";

/**
 * The Server Functions the connector UI calls, injectable (Main, Round 4 review). Production uses the real ones
 * (the default); the dev-only `/preview/connectors` gallery provides an in-memory fixture implementation so every
 * panel state can be reviewed without provider credentials or the connector database schema.
 */

import { createContext, useContext } from "react";

import * as real from "@/lib/actions/connectors";

export interface ConnectorActions {
  listHandoverConnectors: typeof real.listHandoverConnectors;
  listInstallationChannels: typeof real.listInstallationChannels;
  getCaptureConsent: typeof real.getCaptureConsent;
  linkChannel: typeof real.linkChannel;
  recordCaptureConsent: typeof real.recordCaptureConsent;
  setCapturePaused: typeof real.setCapturePaused;
  unlinkChannel: typeof real.unlinkChannel;
  syncLinkNow: typeof real.syncLinkNow;
  disconnectInstallation: typeof real.disconnectInstallation;
  updateConnectorLinkSettings: typeof real.updateConnectorLinkSettings;
}

const REAL: ConnectorActions = {
  listHandoverConnectors: real.listHandoverConnectors,
  listInstallationChannels: real.listInstallationChannels,
  getCaptureConsent: real.getCaptureConsent,
  linkChannel: real.linkChannel,
  recordCaptureConsent: real.recordCaptureConsent,
  setCapturePaused: real.setCapturePaused,
  unlinkChannel: real.unlinkChannel,
  syncLinkNow: real.syncLinkNow,
  disconnectInstallation: real.disconnectInstallation,
  updateConnectorLinkSettings: real.updateConnectorLinkSettings,
};

const Ctx = createContext<ConnectorActions>(REAL);

export function ConnectorActionsProvider({ actions, children }: { actions: ConnectorActions; children: React.ReactNode }) {
  return <Ctx.Provider value={actions}>{children}</Ctx.Provider>;
}

export const useConnectorActions = () => useContext(Ctx);
