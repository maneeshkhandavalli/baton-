/**
 * Connector configuration (server only). Every endpoint URL is derived from BATON_SITE_URL, so the same code
 * serves local development, previews and production; nothing here hardcodes a host.
 *
 * A provider is ENABLED only when all of its required variables are set (like invitation email with Resend).
 * Disabled providers render as "not configured" in the UI and their routes answer 404.
 */

import type { ConnectorProvider } from "./types";

type Env = Record<string, string | undefined>;

/** Required server variables per provider (exact names; documented in docs/round4/setup/*.md). */
export const CONNECTOR_ENV: Readonly<Record<ConnectorProvider, readonly string[]>> = {
  github: ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET"],
  discord: ["DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DISCORD_CLIENT_SECRET"],
  slack: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET"],
};

/**
 * Optional Slack capabilities (off by default; docs/round4/setup/SLACK_SCOPE_AUDIT.md). Turning one on also needs
 * the matching scopes/events in the Slack app and a reinstall from Baton.
 *  SLACK_PRIVATE_CHANNELS=1  private channels (groups:history, groups:read; events message.groups, group_left)
 *  SLACK_SLASH_COMMAND=1     the /handover slash command (commands)
 */
export const SLACK_OPTION_ENV = ["SLACK_PRIVATE_CHANNELS", "SLACK_SLASH_COMMAND"] as const;

export interface SlackOptions {
  /** Private channels can be listed, linked and captured. */
  privateChannels: boolean;
  /** The /handover slash command is answered. */
  slashCommand: boolean;
}

const flagOn = (v: string | undefined) => v !== undefined && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());

export function slackOptions(env: Env = process.env): SlackOptions {
  return { privateChannels: flagOn(env.SLACK_PRIVATE_CHANNELS), slashCommand: flagOn(env.SLACK_SLASH_COMMAND) };
}

/** Shared by every provider. */
export const CONNECTOR_SHARED_ENV = ["BATON_SITE_URL", "CONNECTOR_STATE_SECRET", "CONNECTOR_SECRET_KEY"] as const;

/** Shared secrets shorter than this make signing throw; a provider is not "configured" with them. */
const MIN_SECRET_LENGTH = 32;

export function connectorConfigured(provider: ConnectorProvider, env: Env = process.env): boolean {
  const set = (k: string) => typeof env[k] === "string" && env[k]!.trim() !== "";
  return (
    [...CONNECTOR_SHARED_ENV, ...CONNECTOR_ENV[provider]].every(set) &&
    (env.CONNECTOR_STATE_SECRET ?? "").trim().length >= MIN_SECRET_LENGTH &&
    (env.CONNECTOR_SECRET_KEY ?? "").trim().length >= MIN_SECRET_LENGTH
  );
}

/** The configured base URL without a trailing slash; throws when unset or not http(s). */
export function siteBaseUrl(env: Env = process.env): string {
  const raw = env.BATON_SITE_URL?.trim();
  if (!raw) throw new Error("BATON_SITE_URL is not set");
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("BATON_SITE_URL must be http(s)");
  return u.origin;
}

/** Fixed route paths (the contract): workers implement these exact paths. */
export const connectorPaths = {
  install: (p: ConnectorProvider) => `/api/connectors/${p}/install`,
  callback: (p: ConnectorProvider) => `/api/connectors/${p}/callback`,
  webhook: (p: ConnectorProvider) => `/api/connectors/${p}/webhook`,
  /** Signed link intent from a bot command → the creator picks a handover and consents. */
  connect: "/connect",
  /** Scheduled flush of buffered messages (CRON_SECRET, like /api/pipeline/drain). */
  sync: "/api/connectors/sync",
} as const;

export function connectorUrls(p: ConnectorProvider, env: Env = process.env) {
  const base = siteBaseUrl(env);
  return {
    install: base + connectorPaths.install(p),
    callback: base + connectorPaths.callback(p),
    webhook: base + connectorPaths.webhook(p),
    connect: base + connectorPaths.connect,
  };
}
