/**
 * GitHub webhook payloads → NormalizedEvent (Round 4 contract §4). Pure: no network, no clock (callers pass `nowIso`).
 *
 * What is kept: titles, descriptions and comments of issues and pull requests, review verdicts and their text,
 * commit messages of pushes to the DEFAULT branch, release notes, and the login (or commit author name) of the
 * person. What is never kept: repository code, diffs, file lists, emails, provider user ids, URLs carrying tokens.
 *
 * Message ids (stable per link; an edit keeps the id so the buffered row is replaced):
 *   issue:12 · issue:12:comment:345 · issue:12:closed:<iso> · issue:12:reopened:<iso>
 *   pr:7 · pr:7:comment:345 · pr:7:review:9 · pr:7:merged · pr:7:closed:<iso> · pr:7:reopened:<iso> · pr:7:ready:<iso>
 *   commit:<sha> · release:<id>
 */

import { CONNECTOR_MESSAGE_LIMITS, type ConnectorMessage, type NormalizedEvent } from "../../types";

// ── link settings (event families) ──────────────────────────────────────────

export const GITHUB_FAMILIES = ["issues", "pullRequests", "reviews", "commits", "releases"] as const;
export type GithubFamily = (typeof GITHUB_FAMILIES)[number];
export type GithubFamilies = Record<GithubFamily, boolean>;

export const DEFAULT_GITHUB_FAMILIES: Readonly<GithubFamilies> = Object.freeze({
  issues: true,
  pullRequests: true,
  reviews: true,
  commits: true,
  releases: true,
});

export interface GithubLinkSettings {
  families: GithubFamilies;
  /** Kept when Main's consent action stored it (history import window). */
  historyDays?: number;
}

/**
 * Validates and normalises a link's settings. Missing families default to true; unknown keys are dropped;
 * returns null when the value is malformed (e.g. a family that is not a boolean).
 */
export function parseGithubSettings(raw: unknown): GithubLinkSettings | null {
  if (raw === undefined || raw === null) return { families: { ...DEFAULT_GITHUB_FAMILIES } };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const families: GithubFamilies = { ...DEFAULT_GITHUB_FAMILIES };
  if (r.families !== undefined) {
    if (typeof r.families !== "object" || r.families === null || Array.isArray(r.families)) return null;
    const f = r.families as Record<string, unknown>;
    for (const key of Object.keys(f)) {
      if (!(GITHUB_FAMILIES as readonly string[]).includes(key)) continue;
      if (typeof f[key] !== "boolean") return null;
      families[key as GithubFamily] = f[key] as boolean;
    }
  }
  const out: GithubLinkSettings = { families };
  if (r.historyDays !== undefined) {
    if (typeof r.historyDays !== "number" || !Number.isInteger(r.historyDays) || r.historyDays < 0 || r.historyDays > 30) return null;
    out.historyDays = r.historyDays;
  }
  return out;
}

/**
 * The families allowed for ONE event routed to several capturing links: a family is captured only when EVERY
 * capturing link of the repository allows it (privacy first: a creator who switched a family off never receives
 * it because another handover of the same repository wants it). No links → defaults (ingest drops it anyway).
 */
export function effectiveFamilies(settingsList: readonly unknown[]): GithubFamilies {
  const out: GithubFamilies = { ...DEFAULT_GITHUB_FAMILIES };
  for (const s of settingsList) {
    const parsed = parseGithubSettings(s);
    for (const f of GITHUB_FAMILIES) if (!parsed || !parsed.families[f]) out[f] = false; // malformed → capture nothing
  }
  return out;
}

// ── tiny safe readers over untrusted JSON ───────────────────────────────────

type Json = Record<string, unknown>;
export const obj = (v: unknown): Json | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null);
export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
export const idStr = (v: unknown): string | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : typeof v === "string" && /^\d{1,20}$/.test(v) ? v : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ── text hygiene ────────────────────────────────────────────────────────────

const EMAIL_IN_ANGLES = /\s*<[^<>\s@]+@[^<>\s]+>/g;
const BARE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const URL_RE = /https?:\/\/[^\s<>()"']+/g;
const SECRET_QUERY = /[?&](?:access_token|token|sig|signature|key|code|jwt|X-Amz-[A-Za-z-]+|X-Goog-[A-Za-z-]+)=/i;

/** Removes emails (keeping names in "Name <email>" trailers), HTML comments and query strings that carry tokens. */
export function cleanText(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(EMAIL_IN_ANGLES, "")
    .replace(BARE_EMAIL, "[email removed]")
    .replace(URL_RE, (u) => (SECRET_QUERY.test(u) ? u.split("?")[0] : u))
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "head" or "head\n\nbody", trimmed to the contract's text limit. */
export function composeText(head: string, body: string | null | undefined): string {
  const h = cleanText(head);
  const b = body ? cleanText(body) : "";
  const text = b ? `${h}\n\n${b}` : h;
  const max = CONNECTOR_MESSAGE_LIMITS.textChars;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function oneLine(s: string | null, max = 300): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function isBotAccount(user: unknown): boolean {
  const u = obj(user);
  if (!u) return false;
  const login = str(u.login) ?? "";
  return u.type === "Bot" || /\[bot\]$/i.test(login);
}

const login = (user: unknown): string => oneLine(str(obj(user)?.login), 120);

// ── shared message builders (webhooks and history import) ───────────────────

export interface GithubItem {
  /** The issue or pull request object from the REST API / webhook. */
  item: Json;
  isPullRequest: boolean;
}

const kindWord = (isPr: boolean, draft = false) => (isPr ? (draft ? "draft pull request" : "pull request") : "issue");
const prefix = (isPr: boolean) => (isPr ? "pr" : "issue");

/** The opening message (also used for edits: same id, current title/body, editedAt). */
export function openedMessage({ item, isPullRequest }: GithubItem, editedAt: string | null = null): ConnectorMessage | null {
  const n = idStr(item.number);
  const at = str(item.created_at);
  const author = login(item.user);
  if (!n || !at || !author || isBotAccount(item.user)) return null;
  const draft = isPullRequest && item.draft === true;
  return {
    providerMessageId: `${prefix(isPullRequest)}:${n}`,
    sentAt: at,
    authorLabel: author,
    kind: "text",
    text: composeText(`Opened ${kindWord(isPullRequest, draft)} #${n}: ${oneLine(str(item.title))}`, str(item.body)),
    replyToId: null,
    editedAt,
  };
}

export function stateMessage(
  { item, isPullRequest }: GithubItem,
  change: "closed" | "merged" | "reopened" | "ready",
  at: string | null,
  actorLogin: string,
): ConnectorMessage | null {
  const n = idStr(item.number);
  if (!n || !at || !actorLogin) return null;
  const title = oneLine(str(item.title));
  const word = kindWord(isPullRequest);
  const notPlanned = !isPullRequest && item.state_reason === "not_planned" ? " as not planned" : "";
  const head =
    change === "merged"
      ? `Merged pull request #${n}: ${title}`
      : change === "closed"
        ? isPullRequest
          ? `Closed pull request #${n} without merging: ${title}`
          : `Closed issue #${n}${notPlanned}: ${title}`
        : change === "reopened"
          ? `Reopened ${word} #${n}: ${title}`
          : `Marked pull request #${n} ready for review: ${title}`;
  const p = prefix(isPullRequest);
  return {
    providerMessageId: change === "merged" ? `${p}:${n}:merged` : `${p}:${n}:${change}:${at}`,
    sentAt: at,
    authorLabel: actorLogin,
    kind: "text",
    text: composeText(head, null),
    replyToId: `${p}:${n}`,
    editedAt: null,
  };
}

export function commentMessage(
  issueNumber: string,
  isPullRequest: boolean,
  comment: Json,
  mode: "created" | "edited" | "deleted",
): ConnectorMessage | null {
  const id = idStr(comment.id);
  const at = str(comment.created_at);
  const author = login(comment.user);
  if (!id || !at || !author || isBotAccount(comment.user)) return null;
  const p = prefix(isPullRequest);
  const base = { providerMessageId: `${p}:${issueNumber}:comment:${id}`, sentAt: at, authorLabel: author, replyToId: `${p}:${issueNumber}` };
  if (mode === "deleted") return { ...base, kind: "deleted", text: "", editedAt: str(comment.updated_at) };
  const body = str(comment.body);
  if (!body || !body.trim()) return null;
  return {
    ...base,
    kind: "text",
    text: composeText(`Commented on ${kindWord(isPullRequest)} #${issueNumber}:`, body),
    editedAt: mode === "edited" ? str(comment.updated_at) : null,
  };
}

export function reviewMessage(prNumber: string, prTitle: string | null, review: Json, edited: boolean, nowIso: string): ConnectorMessage | null {
  const id = idStr(review.id);
  const at = str(review.submitted_at);
  const author = login(review.user);
  if (!id || !at || !author || isBotAccount(review.user)) return null;
  const state = String(review.state ?? "").toLowerCase();
  const body = str(review.body);
  const title = oneLine(prTitle);
  let head: string;
  if (state === "approved") head = `Approved pull request #${prNumber}: ${title}`;
  else if (state === "changes_requested") head = `Requested changes on pull request #${prNumber}: ${title}`;
  else if (state === "commented") {
    if (!body || !body.trim()) return null; // inline-only review: the code comments are not captured
    head = `Reviewed pull request #${prNumber}: ${title}`;
  } else return null; // pending / dismissed
  return {
    providerMessageId: `pr:${prNumber}:review:${id}`,
    sentAt: at,
    authorLabel: author,
    kind: "text",
    text: composeText(head, body),
    replyToId: `pr:${prNumber}`,
    editedAt: edited ? nowIso : null,
  };
}

const MERGE_NOISE = /^Merge (pull request #\d+ from |branch '|remote-tracking branch '|[0-9a-f]{7,40} into )/;

/** One commit of a push to the default branch (or of the history import). */
export function commitMessage(sha: string, message: string, timestamp: string, authorName: string): ConnectorMessage | null {
  if (!/^[0-9a-f]{7,64}$/i.test(sha) || !timestamp) return null;
  const name = oneLine(authorName, 120);
  if (!name || /\[bot\]$/i.test(name)) return null;
  const msg = message.replace(/\r\n?/g, "\n").trim();
  if (!msg || MERGE_NOISE.test(msg)) return null;
  const nl = msg.indexOf("\n");
  const first = nl === -1 ? msg : msg.slice(0, nl);
  const rest = nl === -1 ? "" : msg.slice(nl + 1).trim();
  return {
    providerMessageId: `commit:${sha.toLowerCase()}`,
    sentAt: timestamp,
    authorLabel: name,
    kind: "text",
    text: composeText(`Committed ${oneLine(first)}`, rest),
    replyToId: null,
    editedAt: null,
  };
}

export function releaseMessage(release: Json, edited: boolean, nowIso: string): ConnectorMessage | null {
  const id = idStr(release.id);
  const at = str(release.published_at) ?? str(release.created_at);
  const author = login(release.author);
  if (!id || !at || !author || release.draft === true || isBotAccount(release.author)) return null;
  const tag = oneLine(str(release.tag_name), 120);
  const name = oneLine(str(release.name));
  const label = name && name !== tag ? `${tag} — ${name}` : tag || name;
  return {
    providerMessageId: `release:${id}`,
    sentAt: at,
    authorLabel: author,
    kind: "text",
    text: composeText(`Published ${release.prerelease === true ? "pre-release" : "release"} ${label}`, str(release.body)),
    replyToId: null,
    editedAt: edited ? nowIso : null,
  };
}

// ── webhook → NormalizedEvent ───────────────────────────────────────────────

export interface GithubWebhookInput {
  deliveryId: string;
  /** X-GitHub-Event */
  eventName: string;
  payload: unknown;
  /** Families allowed for this repository's capturing links (see effectiveFamilies). */
  families?: GithubFamilies;
  /** ISO time the webhook was received (editedAt for events without their own timestamp). */
  nowIso: string;
}

/** Installation id and repository id of a payload (routing keys), or null. */
export function githubRouting(payload: unknown): { installationId: string | null; repositoryId: string | null } {
  const p = obj(payload);
  return { installationId: idStr(obj(p?.installation)?.id), repositoryId: idStr(obj(p?.repository)?.id) };
}

/** The family a webhook belongs to (null: lifecycle or unsupported). */
export function familyOf(eventName: string, payload: unknown): GithubFamily | null {
  switch (eventName) {
    case "issues":
      return "issues";
    case "issue_comment":
      return obj(obj(obj(payload)?.issue)?.pull_request) ? "pullRequests" : "issues";
    case "pull_request":
      return "pullRequests";
    case "pull_request_review":
      return "reviews";
    case "push":
      return "commits";
    case "release":
      return "releases";
    default:
      return null;
  }
}

/**
 * Maps one verified webhook to one or more NormalizedEvents (several only for `installation_repositories.removed`,
 * one per removed repository with delivery id `<delivery>:<repoId>`). Unknown events/actions, bots, disabled
 * families and non-default-branch pushes become an event with `messages: []` (acknowledged, nothing stored).
 */
export function normalizeGithubWebhook(input: GithubWebhookInput): NormalizedEvent[] {
  const p = obj(input.payload) ?? {};
  const action = str(p.action);
  const eventType = action ? `${input.eventName}.${action}`.slice(0, 100) : input.eventName.slice(0, 100);
  const { installationId, repositoryId } = githubRouting(p);
  const base: NormalizedEvent = {
    provider: "github",
    deliveryId: input.deliveryId,
    eventType,
    externalAccountId: installationId,
    externalChannelId: repositoryId,
    messages: [],
    lifecycle: null,
  };

  // lifecycle first
  if (input.eventName === "installation") {
    const lifecycle =
      action === "deleted"
        ? ({ kind: "uninstalled", reason: "provider_uninstalled" } as const)
        : action === "suspend"
          ? ({ kind: "suspended", reason: "provider_suspended" } as const)
          : action === "unsuspend"
            ? ({ kind: "unsuspended", reason: "provider_unsuspended" } as const)
            : null;
    return [{ ...base, externalChannelId: null, lifecycle }];
  }
  if (input.eventName === "installation_repositories") {
    if (action !== "removed") return [{ ...base, externalChannelId: null }];
    const removed = arr(p.repositories_removed).map((r) => idStr(obj(r)?.id)).filter((id): id is string => id !== null);
    if (removed.length === 0) return [{ ...base, externalChannelId: null }];
    return removed.map((repoId) => ({
      ...base,
      deliveryId: `${input.deliveryId}:${repoId}`.slice(0, 200),
      externalChannelId: repoId,
      lifecycle: { kind: "channel_removed", reason: "repository_removed" } as const,
    }));
  }

  const family = familyOf(input.eventName, p);
  if (!family) return [base];
  if (input.families && !input.families[family]) return [base];
  if (isBotAccount(p.sender)) return [base];
  const sender = login(p.sender);
  return [{ ...base, messages: messagesFor(input.eventName, action, p, sender, input.nowIso).filter((m): m is ConnectorMessage => m !== null) }];
}

function messagesFor(eventName: string, action: string | null, p: Json, sender: string, nowIso: string): Array<ConnectorMessage | null> {
  switch (eventName) {
    case "issues": {
      const issue = obj(p.issue);
      if (!issue) return [];
      const it = { item: issue, isPullRequest: false };
      if (action === "opened") return [openedMessage(it)];
      if (action === "edited") return [openedMessage(it, str(issue.updated_at) ?? nowIso)];
      if (action === "closed") return [stateMessage(it, "closed", str(issue.closed_at) ?? str(issue.updated_at), sender)];
      if (action === "reopened") return [stateMessage(it, "reopened", str(issue.updated_at), sender)];
      return [];
    }
    case "issue_comment": {
      const issue = obj(p.issue);
      const comment = obj(p.comment);
      const n = idStr(issue?.number);
      if (!issue || !comment || !n) return [];
      const isPr = obj(issue.pull_request) !== null;
      if (action === "created" || action === "edited" || action === "deleted") return [commentMessage(n, isPr, comment, action)];
      return [];
    }
    case "pull_request": {
      const pr = obj(p.pull_request);
      if (!pr) return [];
      const it = { item: pr, isPullRequest: true };
      if (action === "opened") return [openedMessage(it)];
      if (action === "edited") return [openedMessage(it, str(pr.updated_at) ?? nowIso)];
      if (action === "closed") {
        return pr.merged === true
          ? [stateMessage(it, "merged", str(pr.merged_at) ?? str(pr.closed_at), sender)]
          : [stateMessage(it, "closed", str(pr.closed_at) ?? str(pr.updated_at), sender)];
      }
      if (action === "reopened") return [stateMessage(it, "reopened", str(pr.updated_at), sender)];
      if (action === "ready_for_review") return [stateMessage(it, "ready", str(pr.updated_at), sender)];
      return [];
    }
    case "pull_request_review": {
      const pr = obj(p.pull_request);
      const review = obj(p.review);
      const n = idStr(pr?.number);
      if (!pr || !review || !n) return [];
      if (action === "submitted" || action === "edited") return [reviewMessage(n, str(pr.title), review, action === "edited", nowIso)];
      return [];
    }
    case "push": {
      const repo = obj(p.repository);
      const defaultBranch = str(repo?.default_branch) ?? str(repo?.master_branch);
      if (!defaultBranch || p.ref !== `refs/heads/${defaultBranch}` || p.deleted === true) return [];
      return arr(p.commits)
        .slice(0, CONNECTOR_MESSAGE_LIMITS.messagesPerEvent)
        .map((c) => {
          const commit = obj(c);
          if (!commit) return null;
          const author = obj(commit.author);
          const name = str(author?.name) ?? str(author?.username) ?? sender;
          return commitMessage(str(commit.id) ?? "", str(commit.message) ?? "", str(commit.timestamp) ?? "", name);
        });
    }
    case "release": {
      const release = obj(p.release);
      if (!release) return [];
      if (action === "published" || action === "edited") return [releaseMessage(release, action === "edited", nowIso)];
      return [];
    }
    default:
      return [];
  }
}
