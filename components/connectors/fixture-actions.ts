/**
 * In-memory connector actions for the dev-only `/preview/connectors` gallery (Main, Round 4 review). Synthetic data
 * only; nothing leaves the browser tab. Each scenario starts the panel in one state, and the actions move it on the
 * way the real server would (link → consent → capturing → bring in → paused …), so the whole flow can be clicked.
 */

import type { Result } from "@/lib/contracts/api";
import type { ChannelChoiceDto, ConnectorInstallationSummary, ConnectorLinkSummary, ConnectorProvider, HandoverConnectorsView } from "@/lib/contracts/connectors";

import { captureConsentStatement, CONNECTOR_CAPTURE_CONSENT_VERSION, MAX_HISTORY_DAYS } from "@/lib/connectors/consent";

import type { ConnectorActions } from "./actions-context";

export const FIXTURE_SCENARIOS = ["not-configured", "connect", "pick-channel", "consent", "capturing", "attention", "github"] as const;
export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

export const SCENARIO_TITLES: Record<FixtureScenario, string> = {
  "not-configured": "No provider set up on this server",
  connect: "Providers set up, nothing connected yet",
  "pick-channel": "Workspace connected: pick a channel",
  consent: "Channel linked, waiting for capture consent",
  capturing: "Capturing, with messages waiting to be added",
  attention: "Needs attention: paused, lost access, handover published",
  github: "GitHub repository with event settings",
};

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (message: string, reason: string): Result<never> => ({ ok: false, error: { code: "precondition_failed", message, retryable: false, details: { reason } } });
const delay = () => new Promise((r) => setTimeout(r, 350));
const now = () => new Date().toISOString();
const ALL: ConnectorProvider[] = ["github", "discord", "slack", "telegram"];

const inst = (id: string, provider: ConnectorProvider, accountLabel: string, status: ConnectorInstallationSummary["status"] = "active", statusReason: string | null = null): ConnectorInstallationSummary => ({ id, provider, accountLabel, status, statusReason });

function link(id: string, installationId: string, provider: ConnectorProvider, accountLabel: string, channelLabel: string, over: Partial<ConnectorLinkSummary> = {}): ConnectorLinkSummary {
  return {
    id, provider, installationId, accountLabel, channelLabel, state: "pending_consent", consentVersion: null, consentedAt: null, bufferedCount: 0,
    lastEventAt: null, lastFlushAt: null, lastFlushError: null, sourceId: null, settings: {}, ...over,
  };
}

const CHANNELS: Record<ConnectorProvider, ChannelChoiceDto[]> = {
  slack: [
    { id: "C01", label: "#core-team", blockedReason: null, linked: false },
    { id: "C02", label: "#sponsors", blockedReason: "bot_not_member", linked: false },
    { id: "C03", label: "#random", blockedReason: null, linked: false },
  ],
  discord: [
    { id: "100", label: "#core-team", blockedReason: null, linked: false },
    { id: "101", label: "#announcements", blockedReason: "missing_permission", linked: false },
  ],
  telegram: [{ id: "-1001", label: "CodeCell Leads", blockedReason: "privacy_mode", linked: false }],
  github: [
    { id: "9001", label: "codecell/devforge-site", blockedReason: null, linked: false },
    { id: "9002", label: "codecell/workshops", blockedReason: null, linked: false },
  ],
};

function seed(s: FixtureScenario): HandoverConnectorsView {
  const configured = s !== "not-configured";
  const view: HandoverConnectorsView = {
    canManage: true,
    providers: ALL.map((p) => ({ provider: p, configured, installPath: configured && p !== "telegram" ? `#install-${p}` : null })),
    installations: [],
    links: [],
  };
  const slack = inst("i-slack", "slack", "Midnight Labs");
  const discord = inst("i-discord", "discord", "CodeCell server");
  const tg = inst("i-tg", "telegram", "CodeCell Leads");
  const gh = inst("i-gh", "github", "codecell");
  const hour = new Date(Date.now() - 3600_000).toISOString();
  switch (s) {
    case "pick-channel":
      view.installations = [slack];
      break;
    case "consent":
      view.installations = [slack];
      view.links = [link("l-1", slack.id, "slack", slack.accountLabel, "#core-team")];
      break;
    case "capturing":
      view.installations = [slack, discord];
      view.links = [
        link("l-1", slack.id, "slack", slack.accountLabel, "#core-team", { state: "capturing", consentVersion: "connector-capture-2026-11-19-v1", consentedAt: hour, bufferedCount: 12, lastEventAt: now() }),
        link("l-2", discord.id, "discord", discord.accountLabel, "#core-team", { state: "capturing", consentVersion: "connector-capture-2026-11-19-v1", consentedAt: hour, bufferedCount: 0, lastFlushAt: hour, sourceId: "src-1" }),
      ];
      break;
    case "attention":
      view.installations = [slack, discord, tg, inst("i-gh-s", "github", "codecell", "suspended", "provider_suspended")];
      view.links = [
        link("l-1", slack.id, "slack", slack.accountLabel, "#core-team", { state: "paused", consentVersion: "v", consentedAt: hour, bufferedCount: 3 }),
        link("l-2", discord.id, "discord", discord.accountLabel, "#core-team", { state: "paused", consentVersion: "v", consentedAt: hour, lastFlushError: "provider_forbidden" }),
        link("l-3", tg.id, "telegram", tg.accountLabel, "CodeCell Leads", { state: "capturing", consentVersion: "v", consentedAt: hour, bufferedCount: 40, lastFlushError: "handover_not_accepting_updates" }),
      ];
      break;
    case "github":
      view.installations = [gh];
      view.links = [
        link("l-gh", gh.id, "github", gh.accountLabel, "codecell/devforge-site", {
          state: "capturing", consentVersion: "v", consentedAt: hour, bufferedCount: 5, lastEventAt: now(),
          settings: { families: { issues: true, pullRequests: true, reviews: true, commits: false, releases: true } },
        }),
      ];
      break;
  }
  return view;
}

export function createFixtureActions(scenario: FixtureScenario): ConnectorActions {
  const view = seed(scenario);
  let n = 0;
  const find = (id: string) => view.links.find((l) => l.id === id);
  const snapshot = (): HandoverConnectorsView => structuredClone({ ...view, links: view.links.filter((l) => l.state !== "revoked") });
  return {
    async listHandoverConnectors() {
      await delay();
      return ok(snapshot());
    },
    async listInstallationChannels({ installationId }) {
      await delay();
      const i = view.installations.find((x) => x.id === installationId);
      if (!i) return fail("Connection not found.", "not_found");
      return ok(CHANNELS[i.provider].map((c) => ({ ...c, linked: view.links.some((l) => l.installationId === i.id && l.channelLabel === c.label && l.state !== "revoked") })));
    },
    async getCaptureConsent({ provider, channelLabel, historyDays }) {
      return ok({
        version: CONNECTOR_CAPTURE_CONSENT_VERSION,
        statement: captureConsentStatement(provider, channelLabel, historyDays ?? 0),
        maxHistoryDays: MAX_HISTORY_DAYS,
        historyAvailable: provider !== "telegram",
      });
    },
    async linkChannel({ installationId, externalChannelId }) {
      await delay();
      const i = view.installations.find((x) => x.id === installationId);
      const c = i && CHANNELS[i.provider].find((x) => x.id === externalChannelId);
      if (!i || !c) return fail("Baton can't see that channel.", "not_found");
      const l = link(`l-new-${++n}`, i.id, i.provider, i.accountLabel, c.label);
      view.links.push(l);
      return ok(structuredClone(l));
    },
    async recordCaptureConsent({ linkId }) {
      await delay();
      const l = find(linkId);
      if (!l) return fail("Connection not found.", "not_found");
      Object.assign(l, { state: "capturing", consentVersion: "connector-capture-2026-11-19-v1", consentedAt: now(), bufferedCount: l.provider === "telegram" ? 0 : 4, lastEventAt: now() });
      return ok(structuredClone(l));
    },
    async setCapturePaused({ linkId, paused }) {
      await delay();
      const l = find(linkId);
      if (!l) return fail("Connection not found.", "not_found");
      l.state = paused ? "paused" : "capturing";
      return ok(structuredClone(l));
    },
    async unlinkChannel({ linkId }) {
      await delay();
      const l = find(linkId);
      if (l) Object.assign(l, { state: "revoked", bufferedCount: 0 });
      return ok(null);
    },
    async syncLinkNow({ linkId }) {
      await delay();
      const l = find(linkId);
      if (!l) return fail("Connection not found.", "not_found");
      if (l.lastFlushError === "handover_not_accepting_updates") {
        return fail("New messages can be added while the handover is a draft or in review. Reopen it for review to bring them in.", "handover_not_accepting_updates");
      }
      const messages = l.bufferedCount;
      Object.assign(l, { bufferedCount: 0, lastFlushAt: now(), lastFlushError: null, sourceId: l.sourceId ?? `src-${l.id}` });
      return ok({ status: messages > 0 ? "flushed" : "nothing_to_flush", messages });
    },
    async disconnectInstallation({ installationId }) {
      await delay();
      view.installations = view.installations.filter((i) => i.id !== installationId);
      for (const l of view.links) if (l.installationId === installationId) l.state = "revoked";
      return ok(null);
    },
    async updateConnectorLinkSettings({ linkId, settings }) {
      await delay();
      const l = find(linkId);
      if (!l) return fail("Connection not found.", "not_found");
      l.settings = { ...settings };
      return ok(structuredClone(l));
    },
  };
}
