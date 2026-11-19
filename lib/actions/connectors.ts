"use server";

/** Round 4 connector Server Functions (thin wrappers; logic in lib/actions/core/connectors.ts). */

import type { Result } from "../contracts/api";
import type { CaptureConsentDto, ChannelChoiceDto, ConnectorLinkSummary, HandoverConnectorsView, LinkIntentDto } from "../contracts/connectors";
import { connectorDeps } from "../connectors/server";
import * as core from "./core/connectors";
import { failWith } from "./core/run";
import { actionDeps as getActionDeps } from "./deps";

export async function listHandoverConnectors(input: { handoverId: string }): Promise<Result<HandoverConnectorsView>> {
  return core.listHandoverConnectors(getActionDeps(), connectorDeps(), input);
}
export async function listInstallationChannels(input: { installationId: string; handoverId: string }): Promise<Result<ChannelChoiceDto[]>> {
  return core.listInstallationChannels(getActionDeps(), connectorDeps(), input);
}
export async function getCaptureConsent(input: { provider: "github" | "discord" | "slack" | "telegram"; channelLabel: string; historyDays?: number }): Promise<Result<CaptureConsentDto>> {
  const p = core.connectorProviderSchema.safeParse(input.provider);
  if (!p.success) return failWith("validation_failed", { message: "Unknown provider." });
  return { ok: true, data: core.captureConsent(p.data, String(input.channelLabel).slice(0, 200), Math.max(0, Math.min(30, Number(input.historyDays) || 0))) };
}
export async function linkChannel(input: { installationId: string; handoverId: string; externalChannelId: string }): Promise<Result<ConnectorLinkSummary>> {
  return core.linkChannel(getActionDeps(), connectorDeps(), input);
}
export async function recordCaptureConsent(input: { linkId: string; consentVersion: string; historyDays?: number }): Promise<Result<ConnectorLinkSummary>> {
  return core.recordCaptureConsent(getActionDeps(), connectorDeps(), input as never);
}
export async function setCapturePaused(input: { linkId: string; paused: boolean }): Promise<Result<ConnectorLinkSummary>> {
  return core.setCapturePaused(getActionDeps(), connectorDeps(), input);
}
export async function unlinkChannel(input: { linkId: string }): Promise<Result<null>> {
  return core.unlinkChannel(getActionDeps(), connectorDeps(), input);
}
export async function syncLinkNow(input: { linkId: string }): Promise<Result<{ status: string; messages: number }>> {
  return core.syncLinkNow(getActionDeps(), connectorDeps(), input);
}
export async function disconnectInstallation(input: { installationId: string }): Promise<Result<null>> {
  return core.disconnectInstallation(getActionDeps(), connectorDeps(), input);
}
export async function readLinkIntent(input: { intent: string }): Promise<Result<LinkIntentDto>> {
  return core.readLinkIntent(getActionDeps(), connectorDeps(), input);
}
export async function linkFromIntent(input: { intent: string; handoverId: string }): Promise<Result<ConnectorLinkSummary>> {
  return core.linkFromIntent(getActionDeps(), connectorDeps(), input);
}
