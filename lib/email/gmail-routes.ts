/**
 * Owner-only Gmail connection routes (Round 4, Agent E). app/api/email/google/{start,callback}/route.ts are thin
 * wrappers that build `GmailRouteDeps` (lib/email/gmail-server.ts) and call these, so tests run them with a
 * constructed Request and fakes.
 *
 *   GET /api/email/google/start     owner only (BATON_OWNER_EMAILS + confirmed email) → signed state + httpOnly CSRF
 *                                   cookie → Google consent (gmail.send only, offline access, prompt=consent)
 *   GET /api/email/google/callback  owner only → state signature, expiry, same profile, cookie nonce → server-side code
 *                                   exchange → refresh token sealed and stored → a plain status page
 *
 * Everyone who is not the owner gets a 404 (the routes do not reveal that they exist). Logs carry event codes only:
 * never the code, a token, the state or an email address.
 */

import { getConnectorSecretKey } from "../connectors/secrets";
import { isOwner } from "../selftest/gate";
import {
  GMAIL_CSRF_COOKIE,
  GMAIL_STATE_TTL_S,
  exchangeGmailCode,
  gmailAuthorizeUrl,
  missingGmailVariables,
  newNonce,
  resolveGmailConfig,
  safeEqualText,
  signGmailState,
  verifyGmailState,
  type FetchFn,
  type GmailTokenStore,
} from "./gmail-core";
import { escapeHtml } from "./core";
import { sealGmailRefreshToken } from "./gmail-store";

export interface GmailRouteActor {
  profileId: string;
  email: string | null;
  emailConfirmed: boolean;
}

export interface GmailRouteDeps {
  env: Readonly<Record<string, string | undefined>>;
  getActor(): Promise<GmailRouteActor | null>;
  store: () => GmailTokenStore;
  fetch: FetchFn;
  now(): number;
  log(event: string, details?: Record<string, string>): void;
  nonce?: () => string;
}

const COOKIE_PATH = "/api/email/google";

function baseHeaders(extra: Record<string, string> = {}): Headers {
  const h = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", ...extra });
  return h;
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: baseHeaders({ "Content-Type": "text/plain; charset=utf-8" }) });
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return [`${GMAIL_CSRF_COOKIE}=${value}`, `Path=${COOKIE_PATH}`, `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}

/** A small self-contained status page (no external resources). Always clears the CSRF cookie. */
function page(status: number, title: string, body: string, secure: boolean): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.5"><h1 style="font-size:20px">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body></html>`;
  const headers = baseHeaders({ "Content-Type": "text/html; charset=utf-8" });
  headers.append("Set-Cookie", cookie("", 0, secure));
  return new Response(html, { status, headers });
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

async function ownerOrNull(deps: GmailRouteDeps): Promise<GmailRouteActor | null> {
  let actor: GmailRouteActor | null = null;
  try {
    actor = await deps.getActor();
  } catch {
    return null;
  }
  return actor && isOwner({ email: actor.email, emailConfirmed: actor.emailConfirmed }, deps.env) ? actor : null;
}

/** What the routes need beyond the Gmail variables: the state secret and the sealing key. */
function setup(deps: GmailRouteDeps) {
  const config = resolveGmailConfig(deps.env);
  const stateSecret = deps.env.CONNECTOR_STATE_SECRET ?? "";
  const key = getConnectorSecretKey(deps.env as Record<string, string | undefined>);
  const missing = missingGmailVariables(deps.env);
  if (stateSecret.length < 32) missing.push("CONNECTOR_STATE_SECRET");
  if (!key.ok) missing.push("CONNECTOR_SECRET_KEY");
  return config && stateSecret.length >= 32 && key.ok ? { ok: true as const, config, stateSecret, key: key.key } : { ok: false as const, missing };
}

const secureFor = (deps: GmailRouteDeps) => (deps.env.GMAIL_REDIRECT_URI ?? "").trim().startsWith("https:");

export async function handleGmailStart(_request: Request, deps: GmailRouteDeps): Promise<Response> {
  const owner = await ownerOrNull(deps);
  if (!owner) return notFound();
  const secure = secureFor(deps);
  const s = setup(deps);
  if (!s.ok) {
    deps.log("gmail_connect_not_configured", { missing: s.missing.join(",") });
    return page(503, "Gmail sending isn't set up", `Set these server variables first: ${s.missing.join(", ")}.`, secure);
  }
  const nonce = (deps.nonce ?? newNonce)();
  const state = signGmailState(s.stateSecret, { v: 1, profileId: owner.profileId, nonce, exp: Math.floor(deps.now() / 1000) + GMAIL_STATE_TTL_S });
  const headers = baseHeaders({ Location: gmailAuthorizeUrl(s.config, state) });
  headers.append("Set-Cookie", cookie(nonce, GMAIL_STATE_TTL_S, secure));
  deps.log("gmail_connect_started");
  return new Response(null, { status: 302, headers });
}

export async function handleGmailCallback(request: Request, deps: GmailRouteDeps): Promise<Response> {
  const owner = await ownerOrNull(deps);
  if (!owner) return notFound();
  const secure = secureFor(deps);
  const s = setup(deps);
  if (!s.ok) return page(503, "Gmail sending isn't set up", `Set these server variables first: ${s.missing.join(", ")}.`, secure);

  const url = new URL(request.url);
  const check = verifyGmailState(s.stateSecret, url.searchParams.get("state"), deps.now());
  if (!check.ok) {
    deps.log("gmail_callback_refused", { reason: `state_${check.reason}` });
    return page(400, "This connection link isn't valid", "It is invalid or has expired. Start again from /api/email/google/start.", secure);
  }
  if (check.payload.profileId !== owner.profileId) {
    deps.log("gmail_callback_refused", { reason: "state_wrong_user" });
    return page(403, "This connection was started by someone else", "Start again while signed in as the owner.", secure);
  }
  const cookieNonce = readCookie(request, GMAIL_CSRF_COOKIE);
  if (!cookieNonce || !safeEqualText(cookieNonce, check.payload.nonce)) {
    deps.log("gmail_callback_refused", { reason: "csrf_cookie_mismatch" });
    return page(400, "This connection link isn't valid", "It was not started in this browser. Start again from /api/email/google/start.", secure);
  }
  if (url.searchParams.get("error")) {
    deps.log("gmail_callback_refused", { reason: "denied" });
    return page(400, "Gmail access wasn't granted", "Nothing was changed. You can start again at any time.", secure);
  }
  const code = url.searchParams.get("code");
  if (!code || code.length > 1024 || /\s/.test(code)) {
    deps.log("gmail_callback_refused", { reason: "invalid_request" });
    return page(400, "This connection link isn't valid", "Google did not return an authorisation code. Start again.", secure);
  }

  const exchanged = await exchangeGmailCode(s.config, code, deps.fetch);
  if (!exchanged.ok) {
    deps.log("gmail_callback_refused", { reason: exchanged.reason });
    const why: Record<typeof exchanged.reason, string> = {
      failed: "Google refused the authorisation code. Start again.",
      no_refresh_token: "Google did not return offline access. Remove Baton's access in your Google account settings, then start again.",
      missing_permissions: "The send permission was not granted. Start again and allow sending email.",
      unexpected_scope: "Google granted more than the send-only permission, so nothing was stored. Remove Baton's access in your Google account settings, then start again.",
    };
    return page(400, "Gmail sending wasn't connected", why[exchanged.reason], secure);
  }
  try {
    await deps.store().put({
      senderEmail: s.config.senderEmail,
      sealedRefreshToken: sealGmailRefreshToken(s.key, s.config.senderEmail, exchanged.refreshToken),
      scopes: exchanged.scopes,
      connectedBy: owner.profileId,
    });
  } catch {
    deps.log("gmail_callback_refused", { reason: "store_failed" });
    return page(500, "Gmail sending wasn't connected", "The authorisation could not be saved. Nothing was sent. Try again later.", secure);
  }
  deps.log("gmail_connected");
  return page(
    200,
    "Gmail sending is connected",
    "Invitation emails will now be sent through Gmail with the send-only permission. While the Google app is in Testing, Google may expire this connection after 7 days; connect again if invitations stop being emailed.",
    secure,
  );
}
