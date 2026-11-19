// GitHub webhook payload → NormalizedEvent mapping (Worker 02). Synthetic payloads only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cleanText,
  DEFAULT_GITHUB_FAMILIES,
  effectiveFamilies,
  normalizeGithubWebhook,
  parseGithubSettings,
  type GithubFamilies,
} from "../events";
import { basePayload, INSTALLATION, INSTALLATION_ID, issue, pr, REPO, REPO_ID } from "./helpers";

const nowIso = "2026-11-19T10:00:00.000Z";
const map = (eventName: string, payload: unknown, families?: GithubFamilies) => normalizeGithubWebhook({ deliveryId: "d-1", eventName, payload, families, nowIso });
const one = (eventName: string, payload: unknown, families?: GithubFamilies) => {
  const events = map(eventName, payload, families);
  assert.equal(events.length, 1);
  return events[0];
};

describe("github events: issues and comments", () => {
  it("opened issue → issue:<n> with title and body, routed by installation and repository id", () => {
    const e = one("issues", basePayload({ action: "opened", issue: issue() }));
    assert.equal(e.eventType, "issues.opened");
    assert.equal(e.externalAccountId, INSTALLATION_ID);
    assert.equal(e.externalChannelId, REPO_ID);
    assert.deepEqual(e.messages, [
      { providerMessageId: "issue:12", sentAt: "2026-11-19T09:00:00Z", authorLabel: "asha", kind: "text", text: "Opened issue #12: Track sponsor payments\n\nWe need one sheet for sponsor payments.", replyToId: null, editedAt: null },
    ]);
  });

  it("edited issue keeps the id, carries the new text and editedAt; closed/reopened are replies", () => {
    const edited = one("issues", basePayload({ action: "edited", issue: issue({ title: "Track sponsor payments (Q4)", updated_at: "2026-11-19T09:30:00Z" }) })).messages[0];
    assert.equal(edited.providerMessageId, "issue:12");
    assert.equal(edited.editedAt, "2026-11-19T09:30:00Z");
    assert.match(edited.text, /\(Q4\)/);

    const closed = one("issues", basePayload({ action: "closed", issue: issue({ closed_at: "2026-11-19T09:40:00Z", state_reason: "not_planned" }) })).messages[0];
    assert.equal(closed.providerMessageId, "issue:12:closed:2026-11-19T09:40:00Z");
    assert.equal(closed.text, "Closed issue #12 as not planned: Track sponsor payments");
    assert.equal(closed.replyToId, "issue:12");

    const reopened = one("issues", basePayload({ action: "reopened", issue: issue({ updated_at: "2026-11-19T09:50:00Z" }) })).messages[0];
    assert.equal(reopened.text, "Reopened issue #12: Track sponsor payments");
  });

  it("issue comments: created, edited (same id) and deleted (kind deleted); PR comments use pr:<n>", () => {
    const comment = { id: 345, body: "Asha owns this now.", user: { login: "ravi", type: "User" }, created_at: "2026-11-19T09:20:00Z", updated_at: "2026-11-19T09:25:00Z" };
    const created = one("issue_comment", basePayload({ action: "created", issue: issue(), comment })).messages[0];
    assert.equal(created.providerMessageId, "issue:12:comment:345");
    assert.equal(created.text, "Commented on issue #12:\n\nAsha owns this now.");
    assert.equal(created.replyToId, "issue:12");
    assert.equal(created.editedAt, null);

    const edited = one("issue_comment", basePayload({ action: "edited", issue: issue(), comment: { ...comment, body: "Ravi owns this now." } })).messages[0];
    assert.equal(edited.providerMessageId, "issue:12:comment:345");
    assert.equal(edited.editedAt, "2026-11-19T09:25:00Z");

    const deleted = one("issue_comment", basePayload({ action: "deleted", issue: issue(), comment })).messages[0];
    assert.equal(deleted.kind, "deleted");
    assert.equal(deleted.text, "");
    assert.equal(deleted.providerMessageId, "issue:12:comment:345");

    const onPr = one("issue_comment", basePayload({ action: "created", issue: issue({ number: 7, pull_request: { url: "x" } }), comment })).messages[0];
    assert.equal(onPr.providerMessageId, "pr:7:comment:345");
    assert.match(onPr.text, /^Commented on pull request #7:/);
  });
});

describe("github events: pull requests and reviews", () => {
  it("opened (template comments stripped), draft, edited, merged, closed, reopened, ready_for_review", () => {
    const opened = one("pull_request", basePayload({ action: "opened", pull_request: pr() })).messages[0];
    assert.equal(opened.providerMessageId, "pr:7");
    assert.equal(opened.authorLabel, "ravi");
    assert.equal(opened.text, "Opened pull request #7: Add sponsor tracker\n\nAdds the tracker.");

    assert.match(one("pull_request", basePayload({ action: "opened", pull_request: pr({ draft: true }) })).messages[0].text, /^Opened draft pull request #7/);

    const edited = one("pull_request", basePayload({ action: "edited", pull_request: pr({ body: "New body", updated_at: "2026-11-19T09:15:00Z" }) })).messages[0];
    assert.deepEqual([edited.providerMessageId, edited.editedAt], ["pr:7", "2026-11-19T09:15:00Z"]);

    const merged = one("pull_request", basePayload({ action: "closed", pull_request: pr({ merged: true, merged_at: "2026-11-19T09:45:00Z", closed_at: "2026-11-19T09:45:00Z" }) })).messages[0];
    assert.deepEqual([merged.providerMessageId, merged.text, merged.authorLabel], ["pr:7:merged", "Merged pull request #7: Add sponsor tracker", "asha"]);

    const closed = one("pull_request", basePayload({ action: "closed", pull_request: pr({ closed_at: "2026-11-19T09:46:00Z" }) })).messages[0];
    assert.equal(closed.text, "Closed pull request #7 without merging: Add sponsor tracker");

    assert.equal(one("pull_request", basePayload({ action: "reopened", pull_request: pr({ updated_at: "2026-11-19T09:47:00Z" }) })).messages[0].text, "Reopened pull request #7: Add sponsor tracker");
    assert.equal(one("pull_request", basePayload({ action: "ready_for_review", pull_request: pr({ updated_at: "2026-11-19T09:48:00Z" }) })).messages[0].text, "Marked pull request #7 ready for review: Add sponsor tracker");
    assert.deepEqual(one("pull_request", basePayload({ action: "labeled", pull_request: pr() })).messages, []);
  });

  it("reviews: approved, changes requested, commented with body; inline-only comment reviews are skipped", () => {
    const review = (state: string, body: string | null) => ({ id: 9, state, body, user: { login: "meera", type: "User" }, submitted_at: "2026-11-19T09:30:00Z" });
    const r = (state: string, body: string | null) => one("pull_request_review", basePayload({ action: "submitted", pull_request: pr(), review: review(state, body) })).messages;
    assert.equal(r("approved", null)[0].text, "Approved pull request #7: Add sponsor tracker");
    assert.equal(r("changes_requested", "Please add totals.")[0].text, "Requested changes on pull request #7: Add sponsor tracker\n\nPlease add totals.");
    assert.equal(r("commented", "Looks close.")[0].text, "Reviewed pull request #7: Add sponsor tracker\n\nLooks close.");
    assert.deepEqual(r("commented", ""), []);
    const m = r("approved", null)[0];
    assert.deepEqual([m.providerMessageId, m.replyToId, m.authorLabel], ["pr:7:review:9", "pr:7", "meera"]);
  });
});

describe("github events: pushes and releases", () => {
  const commit = (sha: string, message: string, name = "Asha Rao", email = "asha@example.test") => ({
    id: sha, message, timestamp: "2026-11-19T15:00:00+05:30", author: { name, email, username: "asha" },
  });

  it("pushes to the default branch only: one message per commit, emails stripped, merge noise skipped", () => {
    const sha1 = "a".repeat(40);
    const sha2 = "b".repeat(40);
    const sha3 = "c".repeat(40);
    const payload = basePayload({
      ref: "refs/heads/main",
      commits: [
        commit(sha1, "Add sponsor sheet\n\nTotals per month.\n\nCo-authored-by: Ravi Kumar <ravi@example.test>"),
        commit(sha2, "Merge pull request #7 from acme/tracker\n\nAdd sponsor tracker"),
        commit(sha3, "Fix typo", "dependabot[bot]"),
      ],
    });
    const msgs = one("push", payload).messages;
    assert.equal(msgs.length, 1);
    assert.deepEqual(msgs[0], {
      providerMessageId: `commit:${sha1}`, sentAt: "2026-11-19T15:00:00+05:30", authorLabel: "Asha Rao", kind: "text",
      text: "Committed Add sponsor sheet\n\nTotals per month.\n\nCo-authored-by: Ravi Kumar", replyToId: null, editedAt: null,
    });
    assert.doesNotMatch(JSON.stringify(msgs), /@example\.test/);

    assert.deepEqual(one("push", { ...payload, ref: "refs/heads/feature-x" }).messages, []);
    assert.deepEqual(one("push", { ...payload, ref: "refs/tags/v1.0" }).messages, []);
    assert.deepEqual(one("push", { ...payload, repository: { ...REPO, default_branch: "trunk" } }).messages, []);
  });

  it("caps a push at 100 messages", () => {
    const commits = Array.from({ length: 150 }, (_, i) => commit(i.toString(16).padStart(40, "0"), `Change ${i}`));
    assert.equal(one("push", basePayload({ ref: "refs/heads/main", commits })).messages.length, 100);
  });

  it("releases: published and edited (same id); drafts skipped", () => {
    const release = { id: 55, tag_name: "v1.2.0", name: "Sponsor season", body: "Notes", author: { login: "asha", type: "User" }, published_at: "2026-11-19T09:00:00Z", draft: false, prerelease: false };
    const pub = one("release", basePayload({ action: "published", release })).messages[0];
    assert.deepEqual([pub.providerMessageId, pub.text], ["release:55", "Published release v1.2.0 — Sponsor season\n\nNotes"]);
    const edited = one("release", basePayload({ action: "edited", release })).messages[0];
    assert.deepEqual([edited.providerMessageId, edited.editedAt], ["release:55", nowIso]);
    assert.deepEqual(one("release", basePayload({ action: "edited", release: { ...release, draft: true } })).messages, []);
  });
});

describe("github events: bots, families, lifecycle, hygiene", () => {
  it("skips bot senders and bot authors", () => {
    assert.deepEqual(one("issues", basePayload({ action: "opened", issue: issue(), sender: { login: "renovate[bot]", type: "Bot" } })).messages, []);
    assert.deepEqual(one("issues", basePayload({ action: "opened", issue: issue({ user: { login: "ci-bot", type: "Bot" } }) })).messages, []);
    assert.deepEqual(one("issue_comment", basePayload({ action: "created", issue: issue(), comment: { id: 1, body: "x", user: { login: "github-actions[bot]", type: "User" }, created_at: "2026-11-19T09:00:00Z" } })).messages, []);
  });

  it("a disabled family maps to messages: [] (acknowledged and ignored)", () => {
    const families = { ...DEFAULT_GITHUB_FAMILIES, issues: false };
    assert.deepEqual(one("issues", basePayload({ action: "opened", issue: issue() }), families).messages, []);
    // comments follow their parent's family
    const comment = { id: 3, body: "hi", user: { login: "ravi", type: "User" }, created_at: "2026-11-19T09:00:00Z" };
    assert.deepEqual(one("issue_comment", basePayload({ action: "created", issue: issue(), comment }), families).messages, []);
    assert.equal(one("issue_comment", basePayload({ action: "created", issue: issue({ pull_request: {} }), comment }), families).messages.length, 1);
  });

  it("settings: defaults, validation, and the strictest choice across links", () => {
    assert.deepEqual(parseGithubSettings({}), { families: { ...DEFAULT_GITHUB_FAMILIES } });
    assert.deepEqual(parseGithubSettings({ families: { commits: false }, historyDays: 7, junk: 1 }), { families: { ...DEFAULT_GITHUB_FAMILIES, commits: false }, historyDays: 7 });
    assert.equal(parseGithubSettings({ families: { commits: "no" } }), null);
    assert.equal(parseGithubSettings([]), null);
    assert.deepEqual(effectiveFamilies([{}, { families: { releases: false } }]), { ...DEFAULT_GITHUB_FAMILIES, releases: false });
    assert.deepEqual(effectiveFamilies([{ families: { issues: 1 } }]), { issues: false, pullRequests: false, reviews: false, commits: false, releases: false });
  });

  it("installation lifecycle: deleted → uninstalled, suspend, unsuspend; created → nothing", () => {
    const e = (action: string) => one("installation", { action, installation: INSTALLATION, sender: { login: "asha", type: "User" } });
    assert.deepEqual(e("deleted").lifecycle, { kind: "uninstalled", reason: "provider_uninstalled" });
    assert.equal(e("deleted").externalChannelId, null);
    assert.deepEqual(e("suspend").lifecycle, { kind: "suspended", reason: "provider_suspended" });
    assert.deepEqual(e("unsuspend").lifecycle, { kind: "unsuspended", reason: "provider_unsuspended" });
    assert.equal(e("created").lifecycle, null);
  });

  it("installation_repositories.removed → one channel_removed event per repository with derived delivery ids", () => {
    const events = map("installation_repositories", { action: "removed", installation: INSTALLATION, repositories_removed: [{ id: 4242 }, { id: 5151 }], sender: { login: "asha" } });
    assert.deepEqual(events.map((e) => [e.deliveryId, e.externalChannelId, e.lifecycle?.kind]), [["d-1:4242", "4242", "channel_removed"], ["d-1:5151", "5151", "channel_removed"]]);
    assert.equal(map("installation_repositories", { action: "added", installation: INSTALLATION })[0].lifecycle, null);
  });

  it("cleanText removes emails, HTML comments and token-bearing query strings", () => {
    const out = cleanText("Mail me at a.b@example.test <!-- hidden --> see https://files.example.test/x.pdf?token=abc123&x=1 and https://example.test/ok");
    assert.equal(out, "Mail me at [email removed]  see https://files.example.test/x.pdf and https://example.test/ok");
  });

  it("unknown events and malformed payloads produce no messages", () => {
    assert.deepEqual(one("star", basePayload({ action: "created" })).messages, []);
    assert.deepEqual(one("issues", null).messages, []);
    assert.equal(one("issues", null).externalAccountId, null);
  });
});
