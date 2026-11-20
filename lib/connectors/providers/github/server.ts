/**
 * GitHub adapter (Round 4 contract §6, Worker 02). Model: a GitHub App with read-only repository permissions
 * (Metadata, Issues, Pull requests, Contents), installed by the owner on chosen repositories. Events arrive by
 * webhook (app/api/connectors/github/webhook); this adapter serves the repository picker, the link-time access
 * check and the optional history import. All calls use a short-lived installation token (app-auth.ts).
 *
 * GitHub pushes events, so there is no `pullNew`. `revokeAtProvider` does nothing destructive: uninstalling the
 * app is the owner's action on GitHub (Settings → Applications → Installed GitHub Apps); local revocation always
 * happens in Baton, and the `installation.deleted` webhook revokes too.
 */

import { CONNECTOR_MESSAGE_LIMITS, type ConnectorMessage, type InstallationRecord } from "../../types";
import { ProviderError, type AdapterContext, type ChannelChoice, type ProviderServerAdapter } from "../adapter";
import { githubPaginate, githubRequest, type GithubAuth, type GithubHttp } from "./api";
import { installationTokens, type InstallationTokenCache } from "./app-auth";
import {
  commentMessage,
  commitMessage,
  idStr,
  isBotAccount,
  obj,
  openedMessage,
  parseGithubSettings,
  releaseMessage,
  reviewMessage,
  stateMessage,
  str,
  type GithubFamilies,
} from "./events";

const REPO_LIST_LIMITS = { maxItems: 1_000, maxPages: 10 } as const;
/** Pull requests whose reviews are fetched during a history import (one request each). */
const HISTORY_REVIEW_PRS = 20;

interface Repo {
  id: string;
  fullName: string;
}

const asArray = (d: unknown): unknown[] => (Array.isArray(d) ? d : []);

/** Test seam: a different token cache (the default is the process-wide in-memory one). */
export function createGithubAdapter(tokens: InstallationTokenCache = installationTokens): ProviderServerAdapter {
  async function installationAuth(ctx: AdapterContext, installation: InstallationRecord): Promise<GithubAuth> {
    if (installation.provider !== "github" || installation.status !== "active") throw new ProviderError("forbidden");
    return { kind: "bearer", token: await tokens.get(ctx, ctx.env, installation.externalAccountId) };
  }

  /** Runs `work` with an installation token; on 401 the cached token is dropped and the call retried once. */
  async function withToken<T>(ctx: AdapterContext, installation: InstallationRecord, work: (auth: GithubAuth) => Promise<T>): Promise<T> {
    try {
      return await work(await installationAuth(ctx, installation));
    } catch (e) {
      if (!(e instanceof ProviderError) || e.code !== "unauthorized") throw e;
      tokens.invalidate(installation.externalAccountId);
      return work(await installationAuth(ctx, installation));
    }
  }

  async function repositories(http: GithubHttp, auth: GithubAuth): Promise<Repo[]> {
    return githubPaginate(
      http,
      "/installation/repositories?per_page=100",
      auth,
      (d) => asArray(obj(d)?.repositories),
      (r) => {
        const o = obj(r);
        const id = idStr(o?.id);
        const fullName = str(o?.full_name);
        return id && fullName && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName) ? { id, fullName } : null;
      },
      REPO_LIST_LIMITS,
    );
  }

  async function findRepo(ctx: AdapterContext, installation: InstallationRecord, repoId: string): Promise<{ repo: Repo; auth: GithubAuth } | null> {
    if (!/^\d{1,20}$/.test(repoId)) return null;
    return withToken(ctx, installation, async (auth) => {
      const repo = (await repositories(ctx, auth)).find((r) => r.id === repoId);
      return repo ? { repo, auth } : null;
    });
  }

  return {
    provider: "github",

    async listChannels(ctx, installation): Promise<ChannelChoice[]> {
      const repos = await withToken(ctx, installation, (auth) => repositories(ctx, auth));
      return repos.map((r) => ({ id: r.id, label: r.fullName, blockedReason: null }));
    },

    async describeChannel(ctx, installation, externalChannelId) {
      const found = await findRepo(ctx, installation, externalChannelId);
      return found ? { id: found.repo.id, label: found.repo.fullName, blockedReason: null } : null;
    },

    async fetchHistory(ctx, installation, link, sinceIso, limit) {
      const found = await findRepo(ctx, installation, link.externalChannelId);
      if (!found) throw new ProviderError("not_found");
      const families = parseGithubSettings(link.settings)?.families;
      if (!families) return [];
      const max = Math.max(0, Math.min(limit, CONNECTOR_MESSAGE_LIMITS.messagesPerFlush));
      return importHistory(ctx, found.auth, found.repo, families, sinceIso, max, new Date(ctx.now()).toISOString());
    },

    async revokeAtProvider(_ctx, installation) {
      // Nothing destructive at GitHub: the owner uninstalls the app there. Forget the cached token now.
      tokens.invalidate(installation.externalAccountId);
    },

    parseSettings(settings) {
      const parsed = parseGithubSettings(settings);
      return parsed ? { ...parsed } : null;
    },
  };
}

export const githubAdapter: ProviderServerAdapter = createGithubAdapter();

// ── history import (optional, opted in at consent time) ─────────────────────

async function importHistory(
  http: GithubHttp,
  auth: GithubAuth,
  repo: Repo,
  families: GithubFamilies,
  sinceIso: string,
  limit: number,
  nowIso: string,
): Promise<ConnectorMessage[]> {
  const since = Date.parse(sinceIso);
  if (limit === 0 || Number.isNaN(since)) return [];
  const sinceQ = encodeURIComponent(new Date(since).toISOString());
  const base = `/repos/${repo.fullName}`;
  const pageLimits = { maxItems: limit, maxPages: 5 };
  const after = (iso: string | null) => iso !== null && Date.parse(iso) >= since;
  const out: Array<ConnectorMessage | null> = [];

  // issues and pull requests updated since (the issues endpoint lists both)
  const prNumbers = new Set<string>();
  const items =
    families.issues || families.pullRequests || families.reviews
      ? await githubPaginate(http, `${base}/issues?state=all&sort=updated&direction=asc&per_page=100&since=${sinceQ}`, auth, asArray, obj, pageLimits)
      : [];
  for (const item of items) {
    const n = idStr(item.number);
    if (!n) continue;
    const isPr = obj(item.pull_request) !== null;
    if (isPr) prNumbers.add(n);
    if (isPr ? !families.pullRequests : !families.issues) continue;
    const it = { item, isPullRequest: isPr };
    if (after(str(item.created_at))) out.push(openedMessage(it));
    const closedAt = str(item.closed_at);
    if (after(closedAt)) {
      // The list response does not say who closed or merged it: recorded as a system line, not attributed.
      const mergedAt = str(obj(item.pull_request)?.merged_at);
      const m = isPr && mergedAt ? stateMessage(it, "merged", mergedAt, "GitHub") : stateMessage(it, "closed", closedAt, "GitHub");
      out.push(m ? { ...m, kind: "system", authorLabel: "" } : null);
    }
  }

  // comments on issues and pull requests
  if (families.issues || families.pullRequests) {
    const comments = await githubPaginate(http, `${base}/issues/comments?sort=updated&direction=asc&per_page=100&since=${sinceQ}`, auth, asArray, obj, pageLimits);
    for (const c of comments) {
      const n = /\/issues\/(\d{1,20})$/.exec(str(c.issue_url) ?? "")?.[1];
      if (!n || !after(str(c.created_at))) continue;
      const isPr = prNumbers.has(n);
      if (isPr ? !families.pullRequests : !families.issues) continue;
      out.push(commentMessage(n, isPr, c, "created"));
    }
  }

  // reviews of recently updated pull requests (bounded: one request per pull request)
  if (families.reviews) {
    const prs = items.filter((i) => obj(i.pull_request) !== null).slice(-HISTORY_REVIEW_PRS);
    for (const pr of prs) {
      const n = idStr(pr.number);
      if (!n) continue;
      const reviews = await githubPaginate(http, `${base}/pulls/${n}/reviews?per_page=100`, auth, asArray, obj, { maxItems: 100, maxPages: 1 });
      for (const r of reviews) if (after(str(r.submitted_at))) out.push(reviewMessage(n, str(pr.title), r, false, nowIso));
    }
  }

  // commits on the default branch (the commits endpoint defaults to it)
  if (families.commits) {
    const commits = await githubPaginate(http, `${base}/commits?per_page=100&since=${sinceQ}`, auth, asArray, obj, pageLimits);
    for (const c of commits) {
      if (isBotAccount(c.author)) continue;
      const commit = obj(c.commit);
      const author = obj(commit?.author);
      out.push(commitMessage(str(c.sha) ?? "", str(commit?.message) ?? "", str(author?.date) ?? "", str(author?.name) ?? str(obj(c.author)?.login) ?? ""));
    }
  }

  // releases
  if (families.releases) {
    const releases = await githubRequest(http, `${base}/releases?per_page=30`, { auth });
    for (const r of asArray(releases.data)) {
      const rel = obj(r);
      if (rel && after(str(rel.published_at))) out.push(releaseMessage(rel, false, nowIso));
    }
  }

  return out
    .filter((m): m is ConnectorMessage => m !== null)
    .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || a.providerMessageId.localeCompare(b.providerMessageId))
    .slice(0, limit);
}
