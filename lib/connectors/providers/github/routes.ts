/**
 * GitHub connector route logic (install, callback, webhook). The files under app/api/connectors/github/ are thin
 * wrappers that pass real dependencies; tests call these handlers with constructed Requests and fakes.
 *
 * Security properties:
 *  - every route answers 404 unless `connectorConfigured("github")`;
 *  - webhook: signature over the RAW body is checked first (401, nothing parsed), then de-duplication and the consent
 *    gate in `ingestEvent`;
 *  - install: signed-in handover creator only; `state` is signed and bound to that user and handover;
 *  - callback: `state` must verify AND belong to the signed-in user; the OAuth code is exchanged server-side and the
 *    resulting user token is used once to prove the user can access `installation_id` (GET /user/installations),
 *    then revoked and dropped; nothing but the installation id, account login and permission names is stored;
 *  - logs carry codes only, never payloads, tokens, codes or keys.
 */

import { randomBytes } from "node:crypto";

import { loginPath } from "../../../supabase/redirects";
import { connectorConfigured, connectorPaths, connectorUrls, siteBaseUrl } from "../../config";
import { ConnectorStoreError } from "../../errors";
import { httpStatusFor, ingestEvent, type IngestLogger } from "../../ingest";
import { OAUTH_STATE_TTL_S, signConnectorState, verifyConnectorState } from "../../state";
import type { ConnectorMessage, ConnectorStore } from "../../types";
import { verifyGithubSignature } from "../../verify";
import { ProviderError } from "../adapter";
import { refuseDemoInstall, type ConnectorRouteActor } from "../bots/shared";
import { exchangeOAuthCode, GITHUB_WEB, githubPaginate, revokeUserToken, type GithubHttp } from "./api";
import { familyOf, idStr, normalizeGithubWebhook, obj, parseGithubSettings, str } from "./events";

type Env = Record<string, string | undefined>;
type LogFields = Record<string, string | number | boolean | null>;

export interface GithubRouteDeps {
  env: Env;
  now(): number;
  store(): ConnectorStore;
  fetch: typeof fetch;
  /** The verified session user (getVerifiedActor), or null when signed out. */
  getActor(): Promise<ConnectorRouteActor | null>;
  /** One structured log line (codes only). Defaults to console.warn(JSON). */
  log?(line: LogFields): void;
  nonce?(): string;
}

export type GithubWebhookDeps = Pick<GithubRouteDeps, "env" | "now" | "store" | "log">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** GitHub caps webhook payloads at 25 MB. */
const MAX_WEBHOOK_BYTES = 25 * 1024 * 1024;
const NO_STORE = { "cache-control": "no-store" } as const;

function logLine(deps: { log?: (line: LogFields) => void }, event: string, fields: LogFields = {}): void {
  const line = { scope: "connector", provider: "github", event, ...fields };
  if (deps.log) deps.log(line);
  else console.warn(JSON.stringify(line));
}

const json = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers: NO_STORE });
const notFound = () => json({ error: "not_found" }, 404);

function redirect(location: string): Response {
  // no-referrer: the callback URL carried a one-time code; never pass it on as a Referer
  return new Response(null, { status: 303, headers: { location, ...NO_STORE, "referrer-policy": "no-referrer" } });
}

// ── webhook ─────────────────────────────────────────────────────────────────

export async function handleGithubWebhook(request: Request, deps: GithubWebhookDeps): Promise<Response> {
  if (!connectorConfigured("github", deps.env)) return notFound();
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return json({ error: "payload_too_large" }, 413);

  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BYTES) return json({ error: "payload_too_large" }, 413);
  if (!verifyGithubSignature(deps.env.GITHUB_WEBHOOK_SECRET ?? "", raw, request.headers.get("x-hub-signature-256"))) {
    if (request.headers.has("x-hub-signature-256")) logLine(deps, "webhook_unauthorized", { code: "bad_signature" });
    return json({ error: "unauthorized" }, 401);
  }

  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  const eventName = request.headers.get("x-github-event") ?? "";
  if (!/^[A-Za-z0-9-]{1,100}$/.test(deliveryId) || !/^[a-z_]{1,64}$/.test(eventName)) return json({ error: "invalid_request" }, 400);
  if (eventName === "ping") return json({ ok: true }, 200);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    logLine(deps, "webhook_invalid_payload", { code: "invalid_payload" });
    return json({ error: "invalid_payload" }, 400);
  }

  let store: ConnectorStore;
  try {
    store = deps.store();
  } catch {
    logLine(deps, "webhook_failed", { code: "store_unavailable" });
    return json({ error: "unavailable" }, 503);
  }

  // Event families are a per-link setting: every capturing link keeps only the families its creator chose
  // (ingestEvent's per-link filter). A malformed setting captures nothing for that link (fail closed).
  const family = familyOf(eventName, payload);
  const filter = family
    ? (link: { settings: Record<string, unknown> }, messages: ConnectorMessage[]) => (parseGithubSettings(link.settings)?.families[family] ? messages : [])
    : undefined;

  const logger: IngestLogger = {
    info() {},
    warn(event, fields) {
      logLine(deps, event, { eventType: typeof fields.eventType === "string" ? fields.eventType : null, code: typeof fields.code === "string" ? fields.code : null });
    },
  };
  const nowIso = new Date(deps.now()).toISOString();
  let status = 200;
  for (const event of normalizeGithubWebhook({ deliveryId, eventName, payload, nowIso })) {
    const outcome = await ingestEvent(store, event, logger, { filter });
    if (outcome.status === "failed") logLine(deps, "webhook_event_failed", { eventType: event.eventType, code: outcome.code });
    status = Math.max(status, httpStatusFor(outcome));
  }
  return json({ ok: status < 300 }, status);
}

// ── install ─────────────────────────────────────────────────────────────────

/** Where the creator lands after install/callback, with a status code the settings panel can show. */
function landing(env: Env, handoverId: string | null, status: string): string {
  const base = siteBaseUrl(env);
  const q = `connector=github&status=${encodeURIComponent(status)}`;
  return handoverId ? `${base}/handover/${encodeURIComponent(handoverId)}/settings?${q}#connectors` : `${base}/dashboard?${q}`;
}

export async function handleGithubInstall(request: Request, deps: GithubRouteDeps): Promise<Response> {
  if (!connectorConfigured("github", deps.env)) return notFound();
  const slug = deps.env.GITHUB_APP_SLUG?.trim() ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/i.test(slug)) {
    logLine(deps, "install_misconfigured", { code: "bad_app_slug" });
    return notFound();
  }
  const handover = new URL(request.url).searchParams.get("handover");
  if (handover !== null && !UUID.test(handover)) return redirect(landing(deps.env, null, "invalid_request"));
  const handoverId = handover ? handover.toLowerCase() : null;

  const actor = await deps.getActor();
  if (!actor) {
    const back = `${connectorPaths.install("github")}${handoverId ? `?handover=${handoverId}` : ""}`;
    return redirect(siteBaseUrl(deps.env) + loginPath(back));
  }
  const demo = refuseDemoInstall(actor); // F3: shared demo accounts can't connect apps
  if (demo) return demo;

  if (handoverId) {
    // creator check: the store refuses anyone but the handover's creator
    try {
      await deps.store().listLinksForHandover({ kind: "user", profileId: actor.profileId }, handoverId);
    } catch (e) {
      const code = e instanceof ConnectorStoreError ? e.code : "internal";
      if (code === "forbidden" || code === "not_found") return redirect(landing(deps.env, null, "not_creator"));
      logLine(deps, "install_failed", { code: "store_unavailable" });
      return redirect(landing(deps.env, handoverId, "unavailable"));
    }
  }

  let state: string;
  try {
    state = signConnectorState(deps.env.CONNECTOR_STATE_SECRET ?? "", {
      t: "oauth",
      p: "github",
      profileId: actor.profileId,
      handoverId,
      nonce: deps.nonce ? deps.nonce() : randomBytes(16).toString("base64url"),
      exp: Math.floor(deps.now() / 1000) + OAUTH_STATE_TTL_S,
    });
  } catch {
    logLine(deps, "install_misconfigured", { code: "state_secret" });
    return notFound();
  }
  return redirect(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`);
}

// ── callback ────────────────────────────────────────────────────────────────

interface UserInstallation {
  id: string;
  accountLabel: string;
  permissions: string[];
  appId: string | null;
}

/** The installation `installationId` if the user's token can see it (GET /user/installations), else null. */
export async function findUserInstallation(http: GithubHttp, userToken: string, installationId: string): Promise<UserInstallation | null> {
  const list = await githubPaginate(
    http,
    "/user/installations?per_page=100",
    { kind: "bearer", token: userToken },
    (d) => (Array.isArray(obj(d)?.installations) ? (obj(d)!.installations as unknown[]) : []),
    (i): UserInstallation | null => {
      const o = obj(i);
      const id = idStr(o?.id);
      if (!o || !id) return null;
      const account = obj(o.account);
      const label = str(account?.login) ?? str(account?.slug) ?? str(account?.name) ?? "";
      const permissions = Object.keys(obj(o.permissions) ?? {}).filter((p) => /^[a-z_]{1,64}$/.test(p)).sort();
      return { id, accountLabel: label.slice(0, 120), permissions, appId: idStr(o.app_id) };
    },
    { maxItems: 1_000, maxPages: 10 },
  );
  return list.find((i) => i.id === installationId) ?? null;
}

export async function handleGithubCallback(request: Request, deps: GithubRouteDeps): Promise<Response> {
  if (!connectorConfigured("github", deps.env)) return notFound();
  const params = new URL(request.url).searchParams;
  const actor = await deps.getActor();
  if (!actor) return redirect(siteBaseUrl(deps.env) + loginPath("/dashboard", "connector_signin_required"));
  const demo = refuseDemoInstall(actor); // F3: nothing is exchanged or stored for a shared demo account
  if (demo) return demo;

  const setupAction = params.get("setup_action");
  const stateRaw = params.get("state");
  if (!stateRaw) {
    // "Redirect on update" from GitHub's own settings page carries no state: nothing to bind, nothing stored.
    return redirect(landing(deps.env, null, setupAction === "update" ? "updated" : "invalid_state"));
  }
  const check = verifyConnectorState(deps.env.CONNECTOR_STATE_SECRET ?? "", stateRaw, deps.now());
  if (!check.ok || check.payload.t !== "oauth" || check.payload.p !== "github" || check.payload.profileId !== actor.profileId) {
    const code = !check.ok ? check.reason : check.payload.t !== "oauth" || check.payload.p !== "github" ? "wrong_kind" : "wrong_user";
    logLine(deps, "callback_refused", { code });
    return redirect(landing(deps.env, null, code === "expired" ? "expired_state" : "invalid_state"));
  }
  const handoverId = check.payload.handoverId;
  const done = (status: string) => redirect(landing(deps.env, handoverId, status));

  if (setupAction === "request") return done("install_requested"); // an org owner must approve first

  // The installation comes from the signed state when Baton already sent the user through the authorization step
  // below (never swapped by a query parameter), otherwise from GitHub's redirect.
  const stateInstallation = check.payload.t === "oauth" ? check.payload.inst : undefined;
  const installationId = stateInstallation ?? params.get("installation_id") ?? "";
  const code = params.get("code") ?? "";
  const clientId = deps.env.GITHUB_APP_CLIENT_ID ?? "";
  const clientSecret = deps.env.GITHUB_APP_CLIENT_SECRET ?? "";

  // App already installed on this account (found 21 Nov): GitHub's install page becomes "Configure" and returns
  // with setup_action=update and the installation id but NO OAuth code, so access can't be proved yet. Send the
  // user through GitHub's authorization step once, carrying the installation id in a fresh signed state; it
  // comes back here with a code. A second return without a code is refused (no loop).
  if (!code && !stateInstallation && /^\d{1,20}$/.test(installationId)) {
    if (!clientId.trim()) {
      logLine(deps, "install_misconfigured", { code: "client_id_missing" });
      return done("unavailable");
    }
    let next: string;
    try {
      next = signConnectorState(deps.env.CONNECTOR_STATE_SECRET ?? "", {
        t: "oauth",
        p: "github",
        profileId: actor.profileId,
        handoverId,
        nonce: deps.nonce ? deps.nonce() : randomBytes(16).toString("base64url"),
        exp: Math.floor(deps.now() / 1000) + OAUTH_STATE_TTL_S,
        inst: installationId,
      });
    } catch {
      logLine(deps, "install_misconfigured", { code: "state_secret" });
      return done("unavailable");
    }
    const authorize = new URL(`${GITHUB_WEB}/login/oauth/authorize`);
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", connectorUrls("github", deps.env).callback);
    authorize.searchParams.set("state", next);
    return redirect(authorize.toString());
  }
  if (!/^\d{1,20}$/.test(installationId) || !/^[A-Za-z0-9_-]{1,512}$/.test(code)) return done("invalid_request");
  const http: GithubHttp = { fetch: deps.fetch, now: deps.now };
  try {
    let userToken = await exchangeOAuthCode(http, clientId, clientSecret, code);
    if (!userToken) {
      logLine(deps, "callback_refused", { code: "authorization_failed" });
      return done("authorization_failed");
    }
    let found: UserInstallation | null;
    try {
      found = await findUserInstallation(http, userToken, installationId);
    } finally {
      await revokeUserToken(http, clientId, clientSecret, userToken);
      userToken = null;
    }
    const appId = deps.env.GITHUB_APP_ID?.trim() ?? null;
    if (!found || (found.appId !== null && appId !== null && found.appId !== appId)) {
      logLine(deps, "callback_refused", { code: "installation_not_accessible" });
      return done("installation_not_accessible");
    }
    await deps.store().upsertInstallation(
      { kind: "user", profileId: actor.profileId },
      { provider: "github", externalAccountId: found.id, accountLabel: found.accountLabel || `installation ${found.id}`, scopes: found.permissions, credentials: null },
    );
    return done("connected");
  } catch (e) {
    const errCode = e instanceof ProviderError ? e.code : e instanceof ConnectorStoreError ? `store_${e.code}` : "internal";
    logLine(deps, "callback_failed", { code: errCode });
    // conflict: this GitHub installation is already connected to Baton by a different person (they must
    // disconnect it first, or link the repository from their own account)
    if (errCode === "store_conflict") return done("connected_by_someone_else");
    return done(errCode === "rate_limited" ? "rate_limited" : "unavailable");
  }
}
