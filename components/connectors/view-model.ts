/**
 * Pure view-model helpers for the "Connected channels" panel and the /connect page (Round 4, Worker 03). No React,
 * no server imports: tested in components/shared/__tests__/connectors-view-model.test.ts.
 *
 * Rule: never call something "connected" or "working" because an installation exists. Say what is actually
 * happening: waiting for consent, capturing since…, N messages waiting, last added…, paused, or the problem.
 */

import type { ConnectorInstallationSummary, ConnectorLinkSummary, ConnectorProvider, HandoverConnectorsView } from "@/lib/contracts/connectors";

export const isProvider = (v: unknown): v is ConnectorProvider => v === "github" || v === "discord" || v === "slack" || v === "telegram";

export const PROVIDER_ORDER: readonly ConnectorProvider[] = ["slack", "discord", "telegram", "github"];

export const PROVIDER_LABEL: Record<ConnectorProvider, string> = { github: "GitHub", discord: "Discord", slack: "Slack", telegram: "Telegram" };

/** What one installation of a provider is called. */
export const ACCOUNT_NOUN: Record<ConnectorProvider, string> = { github: "account", discord: "server", slack: "workspace", telegram: "group" };

/** Fixed same-origin path; Telegram's install route redirects to the add-to-group link (not in installPath by design). */
export const TELEGRAM_ADD_PATH = "/api/connectors/telegram/install";

/** Copy of FLUSH_MESSAGES (lib/actions/core/connectors.ts, server-only); a test keeps them identical. */
export const FLUSH_ERROR_TEXT: Record<string, string> = {
  handover_not_accepting_updates: "New messages can be added while the handover is a draft or in review. Reopen it for review to bring them in.",
  awaiting_consent: "The previous update from this channel is waiting for your consent in Settings → Sources.",
  update_in_progress: "Another update or processing run is in progress. Try again when it has finished.",
  source_removed: "This channel's source was removed. Disconnect the channel and connect it again to start a new source.",
  source_limit: "This handover has reached its source limit.",
  creator_changed: "Only the handover's creator can bring in messages.",
  unchanged: "There is nothing new to bring in.",
  internal: "Baton couldn't add the messages. They are kept and will be tried again.",
};

/** Pull errors recorded by Main's sync (lib/connectors/sync.ts) as `provider_<code>`; the link is paused. */
const PROVIDER_ERROR_TEXT: Record<string, string> = {
  provider_forbidden: "Baton lost access to this channel, so capture was paused. Check the bot's permissions in the channel, then resume.",
  provider_not_found: "Baton can't find this channel any more (deleted, or the bot was removed), so capture was paused.",
  provider_unauthorized: "Baton's access was revoked, so capture was paused. Reconnect the app, then resume.",
};

export function flushErrorText(code: string | null): string | null {
  if (!code) return null;
  return FLUSH_ERROR_TEXT[code] ?? PROVIDER_ERROR_TEXT[code] ?? FLUSH_ERROR_TEXT.internal;
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export interface LinkStatusView {
  /** Short state label for the badge. */
  label: string;
  tone: Tone;
  /** Plain facts, one per line ("Capturing since 19 Nov", "3 messages waiting", …). */
  facts: string[];
  /** A problem to show prominently, or null. */
  problem: string | null;
  canBringIn: boolean;
  canPause: boolean;
  canResume: boolean;
  needsConsent: boolean;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "19 Nov 2026, 10:05" style, in the viewer's locale; "" for null. Deterministic when `timeZone` is given (tests). */
export function formatWhen(iso: string | null, timeZone?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone });
}

export function linkStatus(link: ConnectorLinkSummary, opts: { pullBased?: boolean; timeZone?: string } = {}): LinkStatusView {
  const when = (iso: string | null) => formatWhen(iso, opts.timeZone);
  const problem = flushErrorText(link.lastFlushError);
  const facts: string[] = [];
  const waiting = link.bufferedCount;
  if (link.state !== "pending_consent") {
    if (waiting > 0) facts.push(`${plural(waiting, "message")} waiting to be added`);
    else if (link.state === "capturing") facts.push(opts.pullBased ? "No new messages fetched yet" : "No new messages yet");
    if (link.lastEventAt) facts.push(`Last message received ${when(link.lastEventAt)}`);
    if (link.lastFlushAt) facts.push(`Last added to the handover ${when(link.lastFlushAt)}`);
  }
  switch (link.state) {
    case "pending_consent":
      return { label: "Waiting for your consent", tone: "warning", facts: ["Nothing is saved until you confirm."], problem: null, canBringIn: false, canPause: false, canResume: false, needsConsent: true };
    case "capturing":
      return {
        label: problem ? "Capturing, needs attention" : "Capturing",
        tone: problem ? "warning" : "success",
        facts: [`Capturing since ${when(link.consentedAt)}`, ...facts],
        problem,
        canBringIn: waiting > 0 || !!opts.pullBased,
        canPause: true,
        canResume: false,
        needsConsent: false,
      };
    case "paused":
      return { label: "Paused", tone: problem ? "danger" : "neutral", facts: ["Nothing new is saved while paused.", ...facts], problem, canBringIn: waiting > 0, canPause: false, canResume: link.consentVersion !== null, needsConsent: link.consentVersion === null };
    case "revoked":
      return { label: "Disconnected", tone: "neutral", facts: [], problem: null, canBringIn: false, canPause: false, canResume: false, needsConsent: false };
  }
}

export function installationStatus(i: ConnectorInstallationSummary): { label: string; tone: Tone; detail: string | null } {
  switch (i.status) {
    case "active":
      return { label: "App added", tone: "info", detail: null };
    case "suspended":
      return { label: "Suspended", tone: "warning", detail: "The app was suspended in this account. Nothing is captured until it is restored." };
    case "error":
      return { label: "Needs attention", tone: "danger", detail: "Baton can't reach this account. Reconnect the app." };
    case "revoked":
      return {
        label: "Removed",
        tone: "neutral",
        detail: i.statusReason === "provider_uninstalled" || i.statusReason === "bot_removed" ? "The app was removed from this account." : i.statusReason === "token_revoked" ? "Access was revoked." : null,
      };
  }
}

export function blockedReasonText(reason: string | null, provider: ConnectorProvider): string | null {
  switch (reason) {
    case null:
      return null;
    case "bot_not_member":
      return provider === "slack" ? "The Baton app isn't in this channel. In Slack, type /invite @Baton Handover in the channel, then refresh." : "The Baton bot isn't in this channel yet.";
    case "privacy_mode":
      return "The bot can only see commands here. Turn off privacy mode in BotFather (/setprivacy → Disable) and add the bot to the group again, or make it a group admin.";
    case "missing_permission":
      return "The bot lacks permission to read this channel.";
    default:
      return "Baton can't read this channel yet.";
  }
}

/** Providers that fetch messages on demand ("Bring in new messages" also pulls) rather than receiving them. */
export const PULL_BASED: ReadonlySet<ConnectorProvider> = new Set(["discord"]);

export interface ProviderGroup {
  provider: ConnectorProvider;
  name: string;
  configured: boolean;
  /** Same-origin href that starts installation, or null. */
  installHref: string | null;
  installations: Array<ConnectorInstallationSummary & { links: ConnectorLinkSummary[] }>;
}

/** Groups the view per provider (stable order) with each installation's live links. */
export function providerGroups(view: HandoverConnectorsView): ProviderGroup[] {
  return PROVIDER_ORDER.map((p) => {
    const status = view.providers.find((s) => s.provider === p);
    const configured = !!status?.configured;
    return {
      provider: p,
      name: PROVIDER_LABEL[p],
      configured,
      installHref: !configured ? null : p === "telegram" ? TELEGRAM_ADD_PATH : (status?.installPath ?? null),
      installations: view.installations
        .filter((i) => i.provider === p && (i.status !== "revoked" || view.links.some((l) => l.installationId === i.id)))
        .map((i) => ({ ...i, links: view.links.filter((l) => l.installationId === i.id && l.state !== "revoked") })),
    };
  });
}

/** One-line summary of what a provider group is doing right now (never "connected"). */
export function groupSummary(g: ProviderGroup): string {
  if (!g.configured) return "Not set up on this server.";
  const links = g.installations.flatMap((i) => i.links);
  if (g.installations.length === 0) return g.provider === "telegram" ? "Add the Baton bot to a group to start." : "Not added yet.";
  if (links.length === 0) return "No channel linked to this handover yet.";
  const capturing = links.filter((l) => l.state === "capturing").length;
  const pending = links.filter((l) => l.state === "pending_consent").length;
  const paused = links.filter((l) => l.state === "paused").length;
  const parts = [capturing && `${capturing} capturing`, pending && `${pending} waiting for consent`, paused && `${paused} paused`].filter(Boolean);
  return parts.join(" · ");
}

/**
 * Message for `?connector=<p>&status=<code>` after an install round trip (codes shared by every connector, including
 * GitHub's). Unknown codes get a neutral fallback; null when there is nothing to say.
 */
export function installStatusText(provider: ConnectorProvider | null, code: string | null): { tone: "success" | "info" | "danger"; text: string } | null {
  if (!code) return null;
  const name = provider ? PROVIDER_LABEL[provider] : "The app";
  const ok = (text: string) => ({ tone: "success" as const, text });
  const bad = (text: string) => ({ tone: "danger" as const, text });
  switch (code) {
    case "connected":
      return ok(`${name} added. Now link a channel to this handover; nothing is saved until you confirm.`);
    case "updated":
      return ok(`${name} access was updated.`);
    case "install_requested":
      return { tone: "info", text: `The install was requested. An owner of that ${provider ? ACCOUNT_NOUN[provider] : "account"} must approve it before you can link anything.` };
    case "invalid_state":
    case "expired_state":
    case "invalid_request":
      return bad("That connection link was invalid or expired. Start again from here.");
    case "authorization_failed":
      return bad(`${name} wasn't added: the request was cancelled or not approved.`);
    case "installation_not_accessible":
      return bad(`Baton couldn't confirm you have access to that ${provider ? ACCOUNT_NOUN[provider] : "account"}.`);
    case "connected_by_someone_else":
      return bad("Someone else already connected this account to Baton. Ask them to link the channel, or to disconnect it first.");
    case "not_creator":
      return bad("Only the handover's creator can connect channels.");
    case "rate_limited":
      return bad(`${name} asked Baton to slow down. Try again in a minute.`);
    case "unavailable":
      return bad(`${name} couldn't be reached, or isn't fully set up on this server. Try again later.`);
    default:
      return bad(`${name} couldn't be added. Try again.`);
  }
}

/** History choices for the consent step (days), bounded by the server's maximum. */
export function historyOptions(max: number): number[] {
  return [0, 1, 7, 14, 30].filter((d) => d <= max);
}
