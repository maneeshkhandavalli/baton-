// Capture windows, part 2 (2026-11-20 review of 1ce9cd6): deletions and edits of objects that already existed.
//
// Deletion policy (privacy tombstones):
//   * A deletion only ever REMOVES content: it is stored as kind "deleted" with an empty body and replaces the buffered
//     row of the same message id.
//   * It is checked against the ORIGINAL message's send time only; the time of the deletion (or of any earlier edit)
//     is not used. So a deletion of a message from an authorised window is honoured whenever it is delivered while the
//     link is capturing, including a deletion that happened during a pause and was delivered (retried) after resuming.
//   * A deletion of a message sent outside every window (before consent, during a pause) creates nothing.
//   * KNOWN GAP (unchanged by 1ce9cd6, reported 2026-11-20): a deletion delivered WHILE the link is paused is dropped
//     like every other event of a non-capturing link, so the buffered original stays until it is flushed.
//
// Edits of existing objects (privacy-first, kept): an edit is stored only when the edit time lies in the SAME window
// as the object's original send/creation time. Edits of objects created before consent, during a pause, or in an
// earlier window are refused and never overwrite what was captured.
//
// Exercised through the real Slack and GitHub webhook routes (signed requests) with the in-memory store, which mirrors
// public.connector_buffer_messages (supabase/tests/sql/99_connectors_r4.sql §11 covers the database itself).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { MemoryConnectorStore } from "../store-memory";
import type { ConnectorStore } from "../types";
import { CREATOR, HANDOVER, NOW as BOT_NOW, SYNTHETIC_ENV, makeDeps } from "../providers/bots/testing";
import { handleSlackWebhook } from "../providers/slack/routes";
import { handleGithubWebhook, type GithubRouteDeps } from "../providers/github/routes";
import { ENV as GH_ENV, INSTALLATION_ID, REPO_ID, basePayload, issue, pr, sign as ghSign } from "../providers/github/__tests__/helpers";

const T = (iso: string) => Date.parse(iso);
const user = { kind: "user", profileId: CREATOR } as const;

/** One link with a mutable store clock; consent / pause / resume at the given times. */
function clockStore() {
  let clock = T("2026-11-20T08:00:00Z");
  const store = new MemoryConnectorStore(() => clock);
  store.handovers.set(HANDOVER, { id: HANDOVER, creatorProfileId: CREATOR, state: "draft" });
  return { store, at: (iso: string) => void (clock = T(iso)) };
}

const rows = (store: MemoryConnectorStore, linkId: string) => store.bufferedFor(linkId).map((m) => [m.providerMessageId, m.kind, m.text]);
const lastDetail = (store: MemoryConnectorStore) => store.events[store.events.length - 1]?.detail ?? null;

// ── Slack ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const TEAM = "T0SYNTH";
const CH = "C0CORE";
const slackTs = (iso: string) => `${Math.floor(T(iso) / 1000)}.000100`;

function slackHarness() {
  const { store, at } = clockStore();
  const { deps } = makeDeps({ store });
  let n = 0;
  const post = (event: Record<string, unknown>) => {
    const body = JSON.stringify({ type: "event_callback", team_id: TEAM, event_id: `EvW${++n}`, event: { channel: CH, ...event } });
    const ts = String(Math.floor(BOT_NOW / 1000)); // signature replay window uses the route clock, not the store clock
    const sig = "v0=" + createHmac("sha256", SYNTHETIC_ENV.SLACK_SIGNING_SECRET).update(`v0:${ts}:${body}`).digest("hex");
    return handleSlackWebhook(
      new Request(`${SYNTHETIC_ENV.BATON_SITE_URL}/api/connectors/slack/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sig },
        body,
      }),
      deps,
    );
  };
  const original = (sentIso: string, text: string) => ({ type: "message", user: "U0ASHA", user_profile: { display_name: "Asha" }, text, ts: slackTs(sentIso) });
  return {
    store,
    at,
    /** A new message sent at `sentIso`. */
    message: (sentIso: string, text: string) => post(original(sentIso, text)),
    /** Slack `message_deleted` for the message sent at `sentIso`; the deletion itself happened at `deletedIso`. */
    remove: (sentIso: string, deletedIso: string, text = "original") =>
      post({ type: "message", subtype: "message_deleted", deleted_ts: slackTs(sentIso), event_ts: slackTs(deletedIso), previous_message: original(sentIso, text) }),
    async setup() {
      const inst = await store.upsertInstallation(user, { provider: "slack", externalAccountId: TEAM, accountLabel: "CodeCell", scopes: [], credentials: null });
      const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: CH, channelLabel: "#core" });
      at("2026-11-20T09:00:00Z");
      await store.recordCaptureConsent(user, link.id, "v1"); // window A opens 09:00
      return link;
    },
    async pauseAndResume(link: { id: string }) {
      at("2026-11-20T10:00:00Z");
      await store.setLinkState(user, link.id, "paused"); // window A closes 10:00
      at("2026-11-20T11:00:00Z");
      await store.setLinkState(user, link.id, "capturing"); // window B opens 11:00
    },
  };
}

describe("capture windows: Slack deletions are privacy tombstones", () => {
  it("a deletion inside the authorised window replaces the buffered text with a contentless tombstone", async () => {
    const h = slackHarness();
    const link = await h.setup();
    await h.message("2026-11-20T09:05:00Z", "sponsor call moved");
    h.at("2026-11-20T09:20:00Z");
    await h.remove("2026-11-20T09:05:00Z", "2026-11-20T09:20:00Z");
    assert.deepEqual(rows(h.store, link.id), [[slackTs("2026-11-20T09:05:00Z"), "deleted", ""]]);
  });

  it("KNOWN GAP: a deletion delivered during a pause is dropped and the buffered original stays (pre-existing)", async () => {
    const h = slackHarness();
    const link = await h.setup();
    await h.message("2026-11-20T09:05:00Z", "sponsor call moved");
    h.at("2026-11-20T10:00:00Z");
    await h.store.setLinkState(user, link.id, "paused");
    h.at("2026-11-20T10:30:00Z");
    await h.remove("2026-11-20T09:05:00Z", "2026-11-20T10:30:00Z");
    // The Slack route drops events of channels that are not capturing before author lookup, so the ledger says
    // "unsupported_event" (no content, no users.info call).
    assert.equal(lastDetail(h.store), "unsupported_event");
    // The author deleted it, but the buffered copy remains and would be flushed. See the 2026-11-20 review report.
    assert.deepEqual(rows(h.store, link.id), [[slackTs("2026-11-20T09:05:00Z"), "text", "sponsor call moved"]]);
  });

  it("a deletion made during a pause but delivered after resuming is honoured (tombstone exception)", async () => {
    const h = slackHarness();
    const link = await h.setup();
    await h.message("2026-11-20T09:05:00Z", "sponsor call moved");
    await h.pauseAndResume(link);
    h.at("2026-11-20T11:05:00Z"); // Slack retry of a deletion made at 10:30
    await h.remove("2026-11-20T09:05:00Z", "2026-11-20T10:30:00Z");
    assert.deepEqual(rows(h.store, link.id), [[slackTs("2026-11-20T09:05:00Z"), "deleted", ""]]);
  });

  it("a deletion after resuming, of a message from the earlier window, is honoured", async () => {
    const h = slackHarness();
    const link = await h.setup();
    await h.message("2026-11-20T09:05:00Z", "sponsor call moved");
    await h.pauseAndResume(link);
    h.at("2026-11-20T11:30:00Z");
    await h.remove("2026-11-20T09:05:00Z", "2026-11-20T11:30:00Z");
    assert.deepEqual(rows(h.store, link.id), [[slackTs("2026-11-20T09:05:00Z"), "deleted", ""]]);
  });

  it("a deletion of a message sent before consent or during a pause creates nothing", async () => {
    const h = slackHarness();
    const link = await h.setup();
    await h.pauseAndResume(link);
    h.at("2026-11-20T11:30:00Z");
    await h.remove("2026-11-20T08:30:00Z", "2026-11-20T11:30:00Z"); // sent before consent
    assert.equal(lastDetail(h.store), "outside_capture_window");
    await h.remove("2026-11-20T10:30:00Z", "2026-11-20T11:30:00Z"); // sent during the pause
    assert.equal(lastDetail(h.store), "outside_capture_window");
    assert.deepEqual(rows(h.store, link.id), []);
  });

  it("a deletion of an authorised message that is no longer buffered (already added) leaves only a contentless marker", async () => {
    const h = slackHarness();
    const link = await h.setup();
    h.at("2026-11-20T09:30:00Z");
    await h.remove("2026-11-20T09:05:00Z", "2026-11-20T09:30:00Z", "text that must not be stored");
    assert.deepEqual(rows(h.store, link.id), [[slackTs("2026-11-20T09:05:00Z"), "deleted", ""]]);
    assert.doesNotMatch(JSON.stringify(h.store.bufferedFor(link.id)), /must not be stored/);
  });
});

// ── GitHub ────────────────────────────────────────────────────────────────────────────────────────────────────────

function githubHarness() {
  const { store, at } = clockStore();
  let n = 0;
  const deps = { env: GH_ENV, now: () => T("2026-11-20T12:00:00Z"), store: () => store as ConnectorStore, log: () => {} } as unknown as GithubRouteDeps;
  const post = (event: string, payload: unknown) => {
    const raw = JSON.stringify(payload);
    return handleGithubWebhook(
      new Request(`${GH_ENV.BATON_SITE_URL}/api/connectors/github/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-github-event": event, "x-github-delivery": `22222222-aaaa-4bbb-8ccc-${String(++n).padStart(12, "0")}`, "x-hub-signature-256": ghSign(raw) },
        body: raw,
      }),
      deps,
    );
  };
  const issueAt = (createdIso: string, over: Record<string, unknown> = {}) => issue({ created_at: createdIso, updated_at: createdIso, ...over });
  const comment = (id: number, createdIso: string, updatedIso: string, body: string) => ({ id, body, user: { login: "ravi", type: "User" }, created_at: createdIso, updated_at: updatedIso });
  return {
    store,
    at,
    post,
    issueAt,
    comment,
    async setup() {
      const inst = await store.upsertInstallation(user, { provider: "github", externalAccountId: INSTALLATION_ID, accountLabel: "acme", scopes: ["issues", "metadata"], credentials: null });
      const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: REPO_ID, channelLabel: "acme/sponsors" });
      at("2026-11-20T09:00:00Z");
      await store.recordCaptureConsent(user, link.id, "v1"); // window A opens 09:00
      return link;
    },
    async pauseAndResume(link: { id: string }) {
      at("2026-11-20T10:00:00Z");
      await store.setLinkState(user, link.id, "paused"); // window A closes 10:00
      at("2026-11-20T11:00:00Z");
      await store.setLinkState(user, link.id, "capturing"); // window B opens 11:00
    },
  };
}

describe("capture windows: GitHub objects that already existed", () => {
  it("editing an issue created before consent is refused; nothing about it is stored", async () => {
    const g = githubHarness();
    const link = await g.setup();
    await g.post("issues", basePayload({ action: "edited", issue: g.issueAt("2026-11-20T08:00:00Z", { updated_at: "2026-11-20T09:30:00Z", body: "pre-consent issue, edited" }) }));
    assert.equal(lastDetail(g.store), "outside_capture_window");
    assert.deepEqual(rows(g.store, link.id), []);
  });

  it("editing an issue created in the window: same window updates; an edit after pause/resume is refused (limitation)", async () => {
    const g = githubHarness();
    const link = await g.setup();
    await g.post("issues", basePayload({ action: "opened", issue: g.issueAt("2026-11-20T09:10:00Z", { body: "v1" }) }));
    await g.post("issues", basePayload({ action: "edited", issue: g.issueAt("2026-11-20T09:10:00Z", { updated_at: "2026-11-20T09:20:00Z", body: "v2 same window" }) }));
    assert.match(String(rows(g.store, link.id)[0][2]), /v2 same window/);
    await g.pauseAndResume(link);
    await g.post("issues", basePayload({ action: "edited", issue: g.issueAt("2026-11-20T09:10:00Z", { updated_at: "2026-11-20T11:20:00Z", body: "v3 window B" }) }));
    assert.equal(lastDetail(g.store), "outside_capture_window");
    assert.match(String(rows(g.store, link.id)[0][2]), /v2 same window/); // the window-B edit never overwrites
  });

  it("a new comment on an issue created before consent is stored on its own; the issue body is not", async () => {
    const g = githubHarness();
    const link = await g.setup();
    const old = g.issueAt("2026-11-20T08:00:00Z", { body: "pre-consent issue body" });
    await g.post("issue_comment", basePayload({ action: "created", issue: old, comment: g.comment(501, "2026-11-20T09:15:00Z", "2026-11-20T09:15:00Z", "new comment after consent") }));
    const r = rows(g.store, link.id);
    assert.deepEqual(r.map((x) => x[0]), ["issue:12:comment:501"]);
    assert.match(String(r[0][2]), /new comment after consent/);
    assert.doesNotMatch(JSON.stringify(g.store.bufferedFor(link.id)), /pre-consent issue body/);
  });

  it("a state change (close) of an issue created before consent is an in-window event and carries the current title", async () => {
    const g = githubHarness();
    const link = await g.setup();
    const old = g.issueAt("2026-11-20T08:00:00Z", { title: "Pre-consent title", body: "pre-consent issue body", closed_at: "2026-11-20T09:40:00Z", updated_at: "2026-11-20T09:40:00Z" });
    await g.post("issues", basePayload({ action: "closed", issue: old }));
    const text = JSON.stringify(g.store.bufferedFor(link.id));
    assert.match(text, /Closed issue #12: Pre-consent title/);
    assert.doesNotMatch(text, /pre-consent issue body/);
  });

  it("editing a comment: same window updates; an edit in a later window is refused (limitation)", async () => {
    const g = githubHarness();
    const link = await g.setup();
    const it0 = g.issueAt("2026-11-20T09:05:00Z");
    await g.post("issue_comment", basePayload({ action: "created", issue: it0, comment: g.comment(601, "2026-11-20T09:30:00Z", "2026-11-20T09:30:00Z", "c1") }));
    await g.post("issue_comment", basePayload({ action: "edited", issue: it0, comment: g.comment(601, "2026-11-20T09:30:00Z", "2026-11-20T09:45:00Z", "c1 edited in A") }));
    assert.match(String(rows(g.store, link.id)[0][2]), /c1 edited in A/);
    await g.pauseAndResume(link);
    await g.post("issue_comment", basePayload({ action: "edited", issue: it0, comment: g.comment(601, "2026-11-20T09:30:00Z", "2026-11-20T11:15:00Z", "c1 edited in B") }));
    assert.equal(lastDetail(g.store), "outside_capture_window");
    assert.match(String(rows(g.store, link.id)[0][2]), /c1 edited in A/);
  });

  it("editing an existing pull request after resuming is refused (limitation); a PR from before consent likewise", async () => {
    const g = githubHarness();
    const link = await g.setup();
    const prA = (over: Record<string, unknown> = {}) => pr({ number: 7, created_at: "2026-11-20T09:10:00Z", updated_at: "2026-11-20T09:10:00Z", body: "PR v1", ...over });
    await g.post("pull_request", basePayload({ action: "opened", pull_request: prA(), number: 7 }));
    await g.pauseAndResume(link);
    await g.post("pull_request", basePayload({ action: "edited", pull_request: prA({ updated_at: "2026-11-20T11:20:00Z", body: "PR v2 after resume" }), number: 7 }));
    assert.equal(lastDetail(g.store), "outside_capture_window");
    await g.post("pull_request", basePayload({ action: "edited", pull_request: pr({ number: 8, created_at: "2026-11-20T08:00:00Z", updated_at: "2026-11-20T11:25:00Z", body: "old PR" }), number: 8 }));
    assert.equal(lastDetail(g.store), "outside_capture_window");
    const text = JSON.stringify(g.store.bufferedFor(link.id));
    assert.match(text, /PR v1/);
    assert.doesNotMatch(text, /PR v2 after resume|old PR/);
  });

  it("deleting a comment that was later edited in another window still removes the buffered text", async () => {
    // Regression found in the 2026-11-20 review: GitHub sends the comment's last updated_at with a deletion. That edit
    // time used to be window-checked, so the tombstone was refused and the deleted text stayed buffered.
    const g = githubHarness();
    const link = await g.setup();
    const it0 = g.issueAt("2026-11-20T09:05:00Z");
    await g.post("issue_comment", basePayload({ action: "created", issue: it0, comment: g.comment(701, "2026-11-20T09:30:00Z", "2026-11-20T09:30:00Z", "secret plan") }));
    await g.pauseAndResume(link);
    await g.post("issue_comment", basePayload({ action: "edited", issue: it0, comment: g.comment(701, "2026-11-20T09:30:00Z", "2026-11-20T11:10:00Z", "edited in B") }));
    await g.post("issue_comment", basePayload({ action: "deleted", issue: it0, comment: g.comment(701, "2026-11-20T09:30:00Z", "2026-11-20T11:10:00Z", "edited in B") }));
    assert.deepEqual(rows(g.store, link.id), [["issue:12:comment:701", "deleted", ""]]);
    assert.equal(g.store.bufferedFor(link.id)[0].editedAt ?? null, null);
  });

  it("deleting a comment edited during a pause, delivered after resuming, removes the buffered text", async () => {
    const g = githubHarness();
    const link = await g.setup();
    const it0 = g.issueAt("2026-11-20T09:05:00Z");
    await g.post("issue_comment", basePayload({ action: "created", issue: it0, comment: g.comment(702, "2026-11-20T09:30:00Z", "2026-11-20T09:30:00Z", "secret plan") }));
    await g.pauseAndResume(link);
    await g.post("issue_comment", basePayload({ action: "deleted", issue: it0, comment: g.comment(702, "2026-11-20T09:30:00Z", "2026-11-20T10:30:00Z", "edited while paused") }));
    assert.deepEqual(rows(g.store, link.id), [["issue:12:comment:702", "deleted", ""]]);
  });

  it("deleting a comment created before consent creates nothing", async () => {
    const g = githubHarness();
    const link = await g.setup();
    await g.post("issue_comment", basePayload({ action: "deleted", issue: g.issueAt("2026-11-20T08:00:00Z"), comment: g.comment(703, "2026-11-20T08:10:00Z", "2026-11-20T08:10:00Z", "old") }));
    assert.equal(lastDetail(g.store), "outside_capture_window");
    assert.deepEqual(rows(g.store, link.id), []);
  });
});
