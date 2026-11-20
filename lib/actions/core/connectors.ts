/**
 * Round 4 connector actions (logic; the "use server" wrappers are in lib/actions/connectors.ts). Every action needs
 * a verified session actor; the store re-checks creator rights and lifecycle in SQL (D35). Nothing returned here
 * contains credentials or provider tokens.
 */

import { z } from "zod";

import type { Result } from "../../contracts/api";
import type {
  CaptureConsentDto,
  ChannelChoiceDto,
  ConnectorLinkSummary,
  HandoverConnectorsView,
  LinkIntentDto,
} from "../../contracts/connectors";
import { connectorConfigured, connectorPaths, slackOptions } from "../../connectors/config";
import { captureConsentStatement, CONNECTOR_CAPTURE_CONSENT_VERSION, MAX_HISTORY_DAYS } from "../../connectors/consent";
import { ConnectorStoreError } from "../../connectors/errors";
import { flushLink, type SourceWriter } from "../../connectors/flush";
import { ingestHistory, type HistoryImportResult } from "../../connectors/ingest";
import { onlyLink, pullLink } from "../../connectors/sync";
import { ProviderError, type AdapterContext, type ProviderServerAdapter } from "../../connectors/providers/adapter";
import { verifyConnectorState } from "../../connectors/state";
import {
  CONNECTOR_MESSAGE_LIMITS,
  CONNECTOR_PROVIDERS,
  type ChannelLinkRecord,
  type ConnectorMessage,
  type ConnectorProvider,
  type ConnectorStore,
  type InstallationRecord,
} from "../../connectors/types";
import { createInputMasker } from "./mask";
import { action, failWith, ok, type Failure } from "./run";
import type { ActionDeps } from "./types";

export interface ConnectorDeps {
  store(): ConnectorStore;
  adapter(provider: ConnectorProvider): Promise<ProviderServerAdapter>;
  adapterContext(): AdapterContext;
  writer(): SourceWriter;
  env: Record<string, string | undefined>;
  now(): number;
  /** Handovers the actor created that accept new sources (draft / in review), for the /connect picker. */
  creatorHandovers(profileId: string): Promise<Array<{ id: string; title: string }>>;
  /** The person's Baton display name for channel notices (never an email); null when unknown. Optional in tests. */
  displayName?(profileId: string): Promise<string | null>;
}

const uuid = z.string().uuid();
const providerSchema = z.enum(CONNECTOR_PROVIDERS);

/** Maps store/provider errors to the standard failures; anything else is rethrown (guarded → internal). */
function mapError(e: unknown): Failure {
  if (e instanceof ConnectorStoreError) {
    if (e.code === "internal") throw e;
    const message =
      e.code === "forbidden"
        ? "Only the person who created this handover can manage its connected channels."
        : e.code === "invalid_transition"
          ? "That can't be changed in the connection's current state."
          : undefined;
    return failWith(e.code, message ? { message } : undefined);
  }
  if (e instanceof ProviderError) {
    const message =
      e.code === "not_configured"
        ? "This connector isn't set up on this server yet."
        : e.code === "rate_limited"
          ? "The provider asked Baton to slow down. Try again in a minute."
          : e.code === "unauthorized" || e.code === "forbidden"
            ? "Baton no longer has access. Reconnect the app and try again."
            : "The provider didn't answer. Try again in a moment.";
    return failWith("precondition_failed", { message, details: { reason: `provider_${e.code}` } });
  }
  throw e;
}

async function attempt<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await work();
  } catch (e) {
    return mapError(e);
  }
}

export function linkSummary(link: ChannelLinkRecord, installations: Map<string, InstallationRecord>): ConnectorLinkSummary {
  return {
    id: link.id,
    provider: link.provider,
    installationId: link.installationId,
    accountLabel: installations.get(link.installationId)?.accountLabel ?? "",
    channelLabel: link.channelLabel,
    state: link.state,
    consentVersion: link.consentVersion,
    consentedAt: link.consentedAt,
    bufferedCount: link.bufferedCount,
    lastEventAt: link.lastEventAt,
    lastFlushAt: link.lastFlushAt,
    lastFlushError: link.lastFlushError,
    sourceId: link.sourceId,
    settings: link.settings,
  };
}

/** Display name for a channel notice; a lookup failure never blocks the action (the notice falls back to neutral). */
async function actorName(c: ConnectorDeps, profileId: string): Promise<string | null> {
  return c.displayName ? c.displayName(profileId).catch(() => null) : null;
}

/** Shown when a Slack private channel is picked while private channels are off (SLACK_PRIVATE_CHANNELS). */
const PRIVATE_CHANNEL_OFF = "Private channels aren't turned on for Slack on this Baton server. Link a public channel, or ask the server owner to enable private channels.";

// ── reads ────────────────────────────────────────────────────────────────────

export async function listHandoverConnectors(deps: ActionDeps, c: ConnectorDeps, input: { handoverId: string }): Promise<Result<HandoverConnectorsView>> {
  return action(deps, z.object({ handoverId: uuid }), input, (actor, v) =>
    attempt(async () => {
      // No provider configured on this server: say so without touching the connector tables (a deployment
      // without connector credentials, or before the connector migration, must not show an error).
      if (!CONNECTOR_PROVIDERS.some((p) => connectorConfigured(p, c.env))) {
        return ok<HandoverConnectorsView>({
          canManage: false, // nothing to manage on this server; never claims rights it did not check
          providers: CONNECTOR_PROVIDERS.map((p) => ({ provider: p, configured: false, installPath: null })),
          installations: [],
          links: [],
        });
      }
      const store = c.store();
      let links: ChannelLinkRecord[];
      try {
        links = await store.listLinksForHandover({ kind: "user", profileId: actor.profileId }, v.handoverId);
      } catch (e) {
        if (e instanceof ConnectorStoreError && e.code === "forbidden") {
          return ok<HandoverConnectorsView>({ canManage: false, providers: [], installations: [], links: [] });
        }
        throw e;
      }
      const installations = await store.listInstallationsForProfile(actor.profileId);
      const byId = new Map(installations.map((i) => [i.id, i]));
      for (const l of links) {
        if (!byId.has(l.installationId)) {
          const i = await store.getInstallation(l.installationId);
          if (i) byId.set(i.id, i);
        }
      }
      return ok<HandoverConnectorsView>({
        canManage: true,
        providers: CONNECTOR_PROVIDERS.map((p) => {
          const configured = connectorConfigured(p, c.env);
          const slack = slackOptions(c.env);
          return {
            provider: p,
            configured,
            installPath: configured && p !== "telegram" ? `${connectorPaths.install(p)}?handover=${v.handoverId}` : null,
            slashCommand: p === "slack" ? slack.slashCommand : p !== "github",
            ...(p === "slack" ? { privateChannels: slack.privateChannels } : {}),
          };
        }),
        installations: [...byId.values()].map((i) => ({ id: i.id, provider: i.provider, accountLabel: i.accountLabel, status: i.status, statusReason: i.statusReason })),
        links: links.filter((l) => l.state !== "revoked").map((l) => linkSummary(l, byId)),
      });
    }),
  { refresh: false });
}

export async function listInstallationChannels(
  deps: ActionDeps,
  c: ConnectorDeps,
  input: { installationId: string; handoverId: string },
): Promise<Result<ChannelChoiceDto[]>> {
  return action(deps, z.object({ installationId: uuid, handoverId: uuid }), input, (actor, v) =>
    attempt(async () => {
      const store = c.store();
      const inst = await store.getInstallation(v.installationId);
      if (!inst || inst.installedByProfileId !== actor.profileId || inst.status !== "active") return failWith("not_found");
      const linked = new Set(
        (await store.listLinksForHandover({ kind: "user", profileId: actor.profileId }, v.handoverId))
          .filter((l) => l.installationId === inst.id && l.state !== "revoked")
          .map((l) => l.externalChannelId),
      );
      const adapter = await c.adapter(inst.provider);
      const channels = await adapter.listChannels(c.adapterContext(), inst);
      return ok(channels.map((ch) => ({ id: ch.id, label: ch.label, blockedReason: ch.blockedReason ?? null, linked: linked.has(ch.id) })));
    }),
  { refresh: false });
}

export function captureConsent(provider: ConnectorProvider, channelLabel: string, historyDays = 0): CaptureConsentDto {
  return {
    version: CONNECTOR_CAPTURE_CONSENT_VERSION,
    statement: captureConsentStatement(provider, channelLabel, historyDays),
    maxHistoryDays: MAX_HISTORY_DAYS,
    historyAvailable: provider !== "telegram", // Telegram bots cannot read messages sent before they joined
  };
}

// ── mutations ────────────────────────────────────────────────────────────────

const linkInput = z.object({ installationId: uuid, handoverId: uuid, externalChannelId: z.string().min(1).max(200) });

/** Links a channel (state pending_consent). The label is taken from the provider, never from the browser. */
export async function linkChannel(deps: ActionDeps, c: ConnectorDeps, input: z.input<typeof linkInput>): Promise<Result<ConnectorLinkSummary>> {
  return action(deps, linkInput, input, (actor, v) =>
    attempt(async () => {
      const store = c.store();
      const inst = await store.getInstallation(v.installationId);
      // Someone else's installation is "not found": its channels are never looked up for this user.
      if (!inst || inst.status !== "active" || inst.installedByProfileId !== actor.profileId) return failWith("not_found");
      const adapter = await c.adapter(inst.provider);
      const channel = await adapter.describeChannel(c.adapterContext(), inst, v.externalChannelId);
      if (!channel) return failWith("not_found", { message: "Baton can't see that channel. Check the app's access and try again." });
      if (channel.blockedReason === "private_channel") return failWith("forbidden", { message: PRIVATE_CHANNEL_OFF });
      const link = await store.linkChannel(
        { kind: "user", profileId: actor.profileId },
        { installationId: inst.id, handoverId: v.handoverId, externalChannelId: channel.id, channelLabel: createInputMasker().text(channel.label) },
      );
      return ok(linkSummary(link, new Map([[inst.id, inst]])));
    }),
  );
}

const consentInput = z.object({
  linkId: uuid,
  consentVersion: z.literal(CONNECTOR_CAPTURE_CONSENT_VERSION),
  historyDays: z.number().int().min(0).max(MAX_HISTORY_DAYS).default(0),
});

/**
 * Records capture consent (pending_consent/paused → capturing), optionally imports recent history, announces.
 *
 * PR #7 second review, fix 2 — order of operations when earlier messages are requested (historyDays > 0):
 *   1. load and validate the link and installation; 2. the caller must be the handover's creator AND the person who
 *   installed the app, checked before the provider is contacted; 3. lifecycle (active installation, link not revoked)
 *   and history capability; 4. fetch the history FIRST: if the provider fails, nothing has been written (no setting,
 *   no consent, no capture window, no state change, no announcement); 5. only then save historyDays and record consent
 *   (if recording consent fails, the previous settings are written back: two writes, compensated, not atomic);
 *   a RETRY on an already capturing link keeps its consent time (store/SQL) and re-fetches the ORIGINAL interval
 *   (consent time − saved history days), so the batch delivery prefix, the window and Discord's initial cursor stay put;
 *   6. buffer the history in ≤ 100-message batches (fix 1); 7. announce.
 * A history batch that still fails after one retry is surfaced: consent IS recorded (said so in the message), and
 * confirming again re-fetches and re-buffers safely (upserts by provider message id, no duplicates; an already
 * capturing link opens no new window and is not announced again). historyDays = 0 keeps the previous path.
 */
export async function recordCaptureConsent(deps: ActionDeps, c: ConnectorDeps, input: z.input<typeof consentInput>): Promise<Result<ConnectorLinkSummary>> {
  return action(deps, consentInput, input, (actor, v) =>
    attempt(async () => {
      const store = c.store();
      const user = { kind: "user", profileId: actor.profileId } as const;
      const before = await store.getLink(v.linkId);
      if (!before) return failWith("not_found");
      const inst = await store.getInstallation(before.installationId);
      if (!inst) return failWith("not_found");
      const adapter = await c.adapter(inst.provider);
      // PR #7 review: a provider without history import (Telegram) can never consent to earlier messages. Checked
      // BEFORE anything is written, so neither the settings nor the capture window can carry a back-dating value.
      if (v.historyDays > 0 && !adapter.fetchHistory) {
        return failWith("validation_failed", { message: "This app can't bring in earlier messages. Choose \"from now on\".", details: { field: "historyDays" } });
      }
      const ctx = c.adapterContext();
      let history: ConnectorMessage[] = [];
      let wroteSettings = false;
      if (v.historyDays > 0 && adapter.fetchHistory) {
        await store.listLinksForHandover(user, before.handoverId); // creator only: forbidden otherwise (read-only)
        if (inst.installedByProfileId !== actor.profileId) {
          return failWith("forbidden", { message: "Only the person who connected this app can bring in earlier messages." });
        }
        if (inst.status !== "active" || before.state === "revoked") return failWith("invalid_transition", { message: "That can't be changed in the connection's current state." });
        // The consented interval is fixed at the FIRST successful consent: a retry while the link is already capturing
        // fetches the same interval again (original consent time − the saved history days), not a rolling "now − N
        // days" that would drop the oldest messages of a failed batch. The saved setting is not changed by a retry.
        const savedDays = Number(before.settings.historyDays);
        const retry = before.state === "capturing" && before.consentedAt !== null && Number.isInteger(savedDays) && savedDays > 0;
        const sinceMs = retry ? Date.parse(before.consentedAt as string) - savedDays * 86_400_000 : c.now() - v.historyDays * 86_400_000;
        history = (await adapter.fetchHistory(ctx, inst, before, new Date(sinceMs).toISOString(), CONNECTOR_MESSAGE_LIMITS.messagesPerFlush)).slice(0, CONNECTOR_MESSAGE_LIMITS.messagesPerFlush);
        if (!retry) {
          await store.updateLinkSettings(user, v.linkId, { ...before.settings, historyDays: v.historyDays });
          wroteSettings = true;
        }
      }
      let link: ChannelLinkRecord;
      try {
        link = await store.recordCaptureConsent(user, v.linkId, v.consentVersion);
      } catch (e) {
        if (wroteSettings) await store.updateLinkSettings(user, v.linkId, before.settings).catch(() => {}); // compensate
        throw e;
      }
      let incomplete: HistoryImportResult | null = null;
      if (history.length > 0) {
        const r = await ingestHistory(
          store,
          { provider: inst.provider, externalAccountId: inst.externalAccountId, externalChannelId: link.externalChannelId, deliveryPrefix: `history:${link.id}:${link.consentedAt}` },
          history, undefined, { filter: onlyLink(link.id) },
        );
        if (r.failed.length > 0) incomplete = r;
      }
      // announce the start of capture; a retry on an already capturing link does not announce it again
      if (v.historyDays === 0 || before.state !== "capturing") {
        const by = await actorName(c, actor.profileId);
        await adapter.announceCapture?.(ctx, inst, link, "started", by).catch(() => {}); // a notice failure never blocks consent
      }
      if (incomplete) {
        return failWith("precondition_failed", {
          message: "Baton started saving new messages, but some earlier messages couldn't be brought in. Confirm again with the same choice to retry; messages already brought in aren't duplicated.",
          retryable: true,
          details: { reason: "history_import_incomplete", consentRecorded: true, failedBatches: incomplete.failed.length, batches: incomplete.batches, buffered: incomplete.buffered },
        });
      }
      return ok(linkSummary((await store.getLink(link.id)) ?? link, new Map([[inst.id, inst]])));
    }),
  );
}

const linkIdInput = z.object({ linkId: uuid });

const settingsInput = z.object({ linkId: uuid, settings: z.record(z.string(), z.unknown()) });

/**
 * Saves a link's provider settings (e.g. GitHub event families). The provider adapter validates them
 * (`parseSettings`, refusing malformed values); the consent-time `historyDays` choice is kept.
 */
export async function updateConnectorLinkSettings(deps: ActionDeps, c: ConnectorDeps, input: z.input<typeof settingsInput>): Promise<Result<ConnectorLinkSummary>> {
  return action(deps, settingsInput, input, (actor, v) =>
    attempt(async () => {
      const store = c.store();
      const link = await store.getLink(v.linkId);
      if (!link || link.state === "revoked") return failWith("not_found");
      const adapter = await c.adapter(link.provider);
      const merged = { ...v.settings, ...(typeof link.settings.historyDays === "number" ? { historyDays: link.settings.historyDays } : {}) };
      const parsed = adapter.parseSettings ? adapter.parseSettings(merged) : null;
      if (!parsed) return failWith("validation_failed", { message: "These settings can't be used for this connection." });
      const updated = await store.updateLinkSettings({ kind: "user", profileId: actor.profileId }, v.linkId, parsed);
      const inst = await store.getInstallation(updated.installationId);
      return ok(linkSummary(updated, new Map(inst ? [[inst.id, inst]] : [])));
    }),
  );
}

export async function setCapturePaused(deps: ActionDeps, c: ConnectorDeps, input: { linkId: string; paused: boolean }): Promise<Result<ConnectorLinkSummary>> {
  return action(deps, z.object({ linkId: uuid, paused: z.boolean() }), input, (actor, v) =>
    attempt(async () => {
      const store = c.store();
      const link = await store.setLinkState({ kind: "user", profileId: actor.profileId }, v.linkId, v.paused ? "paused" : "capturing");
      const inst = await store.getInstallation(link.installationId);
      const adapter = inst ? await c.adapter(inst.provider) : null;
      // Resuming a pull-based link starts from now: nothing sent while it was paused is captured.
      if (!v.paused && adapter?.cursorAt) await store.setPullCursor(link.id, adapter.cursorAt(c.now()));
      if (inst && adapter) await adapter.announceCapture?.(c.adapterContext(), inst, link, v.paused ? "paused" : "started", await actorName(c, actor.profileId)).catch(() => {});
      return ok(linkSummary(link, new Map(inst ? [[inst.id, inst]] : [])));
    }),
  );
}

export async function unlinkChannel(deps: ActionDeps, c: ConnectorDeps, input: { linkId: string }): Promise<Result<null>> {
  return action(deps, linkIdInput, input, (actor, v) =>
    attempt(async () => {
      const store = c.store();
      const link = await store.getLink(v.linkId);
      if (!link) return failWith("not_found");
      await store.revokeLink({ kind: "user", profileId: actor.profileId }, v.linkId, "creator_unlinked");
      const inst = await store.getInstallation(link.installationId);
      if (inst) await (await c.adapter(inst.provider)).announceCapture?.(c.adapterContext(), inst, link, "stopped", await actorName(c, actor.profileId)).catch(() => {});
      return ok(null);
    }),
  );
}

/** "Bring in new messages now": flushes the buffer into a source (or a new version) for the creator to review. */
export async function syncLinkNow(deps: ActionDeps, c: ConnectorDeps, input: { linkId: string }): Promise<Result<{ status: string; messages: number }>> {
  return action(deps, linkIdInput, input, (actor, v) =>
    attempt(async () => {
      const store = c.store();
      const link = await store.getLink(v.linkId);
      if (!link || link.state === "revoked") return failWith("not_found");
      // creator check (the flush itself acts as the consenting creator, re-checked in SQL)
      await store.listLinksForHandover({ kind: "user", profileId: actor.profileId }, link.handoverId);
      // pull-based providers (Discord) fetch what is new first; push providers already buffered it
      await pullLink(store, await c.adapter(link.provider), c.adapterContext(), link);
      const r = await flushLink(store, c.writer(), v.linkId);
      if (r.status === "refused") return failWith("precondition_failed", { message: FLUSH_MESSAGES[r.refusal] ?? FLUSH_MESSAGES.internal, details: { reason: r.refusal } });
      return ok({ status: r.status, messages: r.status === "flushed" ? r.messages : 0 });
    }),
  );
}

export const FLUSH_MESSAGES: Record<string, string> = {
  handover_not_accepting_updates: "New messages can be added while the handover is a draft or in review. Reopen it for review to bring them in.",
  awaiting_consent: "The previous update from this channel is waiting for your consent in Settings → Sources.",
  update_in_progress: "Another update or processing run is in progress. Try again when it has finished.",
  source_removed: "This channel's source was removed. Disconnect the channel and connect it again to start a new source.",
  source_limit: "This handover has reached its source limit.",
  creator_changed: "Only the handover's creator can bring in messages.",
  unchanged: "There is nothing new to bring in.",
  internal: "Baton couldn't add the messages. They are kept and will be tried again.",
};

export async function disconnectInstallation(deps: ActionDeps, c: ConnectorDeps, input: { installationId: string }): Promise<Result<null>> {
  return action(deps, z.object({ installationId: uuid }), input, (actor, v) =>
    attempt(async () => {
      const store = c.store();
      const inst = await store.getInstallation(v.installationId);
      if (!inst || inst.installedByProfileId !== actor.profileId) return failWith("not_found");
      const adapter = await c.adapter(inst.provider);
      // revoke at the provider first (best effort), then locally: local revocation always happens
      await adapter.revokeAtProvider?.(c.adapterContext(), inst).catch(() => {});
      await store.revokeInstallation({ kind: "user", profileId: actor.profileId }, inst.id, "creator_disconnected");
      return ok(null);
    }),
  );
}

// ── link intents from bot commands (/connect) ────────────────────────────────

export async function readLinkIntent(deps: ActionDeps, c: ConnectorDeps, input: { intent: string }): Promise<Result<LinkIntentDto>> {
  return action(deps, z.object({ intent: z.string().min(10).max(4096) }), input, (actor, v) =>
    attempt(async () => {
      const check = verifyConnectorState(c.env.CONNECTOR_STATE_SECRET ?? "", v.intent, c.now());
      if (!check.ok || check.payload.t !== "intent") return failWith("token_invalid", { details: { reason: check.ok ? "invalid" : check.reason } });
      const p = check.payload;
      return ok({ provider: p.p, accountLabel: p.accountLabel, channelLabel: p.channelLabel, handovers: await c.creatorHandovers(actor.profileId) });
    }),
  { refresh: false });
}

const intentLinkInput = z.object({ intent: z.string().min(10).max(4096), handoverId: uuid });

/**
 * Links the channel named by a verified intent to one of the actor's handovers. The installation for that provider
 * account must already exist (Discord/Slack: installed via OAuth by this user; Telegram: created here, since the
 * bot is shared and the group is the account). Consent is a separate, explicit step.
 */
export async function linkFromIntent(deps: ActionDeps, c: ConnectorDeps, input: z.input<typeof intentLinkInput>): Promise<Result<ConnectorLinkSummary>> {
  return action(deps, intentLinkInput, input, (actor, v) =>
    attempt(async () => {
      const check = verifyConnectorState(c.env.CONNECTOR_STATE_SECRET ?? "", v.intent, c.now());
      if (!check.ok || check.payload.t !== "intent") return failWith("token_invalid", { details: { reason: check.ok ? "invalid" : check.reason } });
      const p = check.payload;
      const store = c.store();
      const user = { kind: "user", profileId: actor.profileId } as const;
      // Only the handover's creator may use an intent: checked BEFORE a Telegram installation is created, so nobody
      // else can claim a group by opening its link first.
      await store.listLinksForHandover(user, v.handoverId);
      let inst = await store.findInstallation(p.p, p.account);
      if ((!inst || inst.status === "revoked") && p.p === "telegram") {
        inst = await store.upsertInstallation(user, { provider: "telegram", externalAccountId: p.account, accountLabel: createInputMasker().text(p.accountLabel), scopes: [], credentials: null });
      }
      if (!inst || inst.status !== "active") return failWith("precondition_failed", { message: "Install the Baton app in that workspace first, then use the command again.", details: { reason: "not_installed" } });
      const adapter = await c.adapter(inst.provider);
      const channel = await adapter.describeChannel(c.adapterContext(), inst, p.channel);
      if (!channel) return failWith("not_found", { message: "Baton can't see that channel any more." });
      if (channel.blockedReason === "private_channel") return failWith("forbidden", { message: PRIVATE_CHANNEL_OFF });
      const link = await store.linkChannel(user, { installationId: inst.id, handoverId: v.handoverId, externalChannelId: channel.id, channelLabel: createInputMasker().text(channel.label) });
      return ok(linkSummary(link, new Map([[inst.id, inst]])));
    }),
  );
}

export const connectorProviderSchema = providerSchema;
