// Round 4 "Connected channels" view model (Worker 03): honest states (never "connected" because an app exists),
// flush/pull error texts, blocked reasons, provider grouping and install status messages.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ConnectorLinkSummary, HandoverConnectorsView } from "../../../lib/contracts/connectors";
import {
  blockedReasonText,
  FLUSH_ERROR_TEXT,
  flushErrorText,
  groupSummary,
  historyOptions,
  installationStatus,
  installStatusText,
  linkStatus,
  providerGroups,
  TELEGRAM_ADD_PATH,
} from "../../connectors/view-model";

const link = (over: Partial<ConnectorLinkSummary> = {}): ConnectorLinkSummary => ({
  id: "l1", provider: "slack", installationId: "i1", accountLabel: "CodeCell", channelLabel: "#core", state: "capturing", consentVersion: "v1",
  consentedAt: "2026-11-19T10:00:00.000Z", bufferedCount: 0, lastEventAt: null, lastFlushAt: null, lastFlushError: null, sourceId: null, settings: {}, ...over,
});

const view = (over: Partial<HandoverConnectorsView> = {}): HandoverConnectorsView => ({
  canManage: true,
  providers: [
    { provider: "github", configured: false, installPath: null },
    { provider: "discord", configured: true, installPath: "/api/connectors/discord/install?handover=h" },
    { provider: "slack", configured: true, installPath: "/api/connectors/slack/install?handover=h" },
    { provider: "telegram", configured: true, installPath: null },
  ],
  installations: [{ id: "i1", provider: "slack", accountLabel: "CodeCell", status: "active", statusReason: null }],
  links: [],
  ...over,
});

describe("connected channels: link states", () => {
  it("pending consent says nothing is saved yet and offers consent only", () => {
    const s = linkStatus(link({ state: "pending_consent", consentVersion: null, consentedAt: null }));
    assert.equal(s.label, "Waiting for your consent");
    assert.equal(s.needsConsent, true);
    assert.equal(s.canBringIn, false);
    assert.deepEqual(s.facts, ["Nothing is saved until you confirm."]);
  });

  it("capturing shows since when, how many wait and the last message/flush", () => {
    const s = linkStatus(link({ bufferedCount: 1, lastEventAt: "2026-11-19T10:05:00.000Z", lastFlushAt: "2026-11-18T09:00:00.000Z" }), { timeZone: "UTC" });
    assert.equal(s.label, "Capturing");
    assert.equal(s.tone, "success");
    assert.ok(s.facts[0].startsWith("Capturing since 19 Nov 2026"));
    assert.ok(s.facts.includes("1 message waiting to be added"));
    assert.ok(s.facts.some((f) => f.startsWith("Last message received 19 Nov 2026")));
    assert.ok(s.facts.some((f) => f.startsWith("Last added to the handover 18 Nov 2026")));
    assert.equal(s.canBringIn, true);
  });

  it("nothing waiting: push providers can't bring in, pull providers (Discord) can fetch", () => {
    assert.equal(linkStatus(link()).canBringIn, false);
    assert.equal(linkStatus(link({ provider: "discord" }), { pullBased: true }).canBringIn, true);
  });

  it("flush errors use the server's exact text; pull errors from the sync explain the pause", () => {
    const s = linkStatus(link({ lastFlushError: "handover_not_accepting_updates", bufferedCount: 3 }));
    assert.equal(s.label, "Capturing, needs attention");
    assert.equal(s.problem, FLUSH_ERROR_TEXT.handover_not_accepting_updates);
    const p = linkStatus(link({ state: "paused", lastFlushError: "provider_forbidden" }));
    assert.match(p.problem ?? "", /lost access/);
    assert.equal(p.canResume, true);
    assert.equal(flushErrorText("something_new"), FLUSH_ERROR_TEXT.internal);
    assert.equal(flushErrorText(null), null);
  });

  it("the copied flush texts match the server's FLUSH_MESSAGES", async () => {
    const { FLUSH_MESSAGES } = await import("../../../lib/actions/core/connectors");
    assert.deepEqual(FLUSH_ERROR_TEXT, FLUSH_MESSAGES);
  });

  it("no state is ever labelled connected or working", () => {
    for (const state of ["pending_consent", "capturing", "paused", "revoked"] as const) {
      assert.doesNotMatch(linkStatus(link({ state })).label, /bconnected|working/i);
    }
    assert.doesNotMatch(installationStatus({ id: "i", provider: "slack", accountLabel: "x", status: "active", statusReason: null }).label, /bconnected|working/i);
  });
});

describe("connected channels: grouping and summaries", () => {
  it("groups by provider in a stable order; Telegram gets the add-to-group path", () => {
    const groups = providerGroups(view({ links: [link(), link({ id: "l2", state: "pending_consent" }), link({ id: "l3", state: "revoked" })] }));
    assert.deepEqual(groups.map((g) => g.provider), ["slack", "discord", "telegram", "github"]);
    assert.equal(groups[0].installations[0].links.length, 2);
    assert.equal(groups[2].installHref, TELEGRAM_ADD_PATH);
    assert.equal(groups[3].installHref, null);
    assert.equal(groupSummary(groups[0]), "1 capturing · 1 waiting for consent");
    assert.equal(groupSummary(groups[1]), "Not added yet.");
    assert.equal(groupSummary(groups[3]), "Not set up on this server.");
  });

  it("an installed app without a linked channel says so", () => {
    assert.equal(groupSummary(providerGroups(view())[0]), "No channel linked to this handover yet.");
  });
});

describe("connected channels: reasons and messages", () => {
  it("explains blocked channels per provider", () => {
    assert.match(blockedReasonText("bot_not_member", "slack") ?? "", /\/invite @Baton Handover/);
    assert.match(blockedReasonText("privacy_mode", "telegram") ?? "", /setprivacy/);
    assert.equal(blockedReasonText(null, "slack"), null);
  });

  it("maps install status codes (shared with GitHub) to readable messages", () => {
    assert.equal(installStatusText("slack", "connected")?.tone, "success");
    assert.match(installStatusText("discord", "connected_by_someone_else")?.text ?? "", /Someone else/);
    assert.equal(installStatusText("github", "install_requested")?.tone, "info");
    assert.equal(installStatusText("slack", "whatever")?.tone, "danger");
    assert.equal(installStatusText("slack", null), null);
  });

  it("history options respect the server maximum", () => {
    assert.deepEqual(historyOptions(30), [0, 1, 7, 14, 30]);
    assert.deepEqual(historyOptions(7), [0, 1, 7]);
  });
});
