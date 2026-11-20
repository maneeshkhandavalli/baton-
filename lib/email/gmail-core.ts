/**
 * Gmail API invitation delivery (Round 4, Agent E). Pure: the environment is passed in, `fetch` is injected, nothing
 * is logged and nothing is read from disk. The only state is what one transport instance keeps in memory (its cached
 * access token). lib/email/gmail-server.ts builds the server's instance; the routes live in gmail-routes.ts.
 *
 *   * Scope: ONLY https://www.googleapis.com/auth/gmail.send. Baton can send mail as the connected account and can
 *     never read, list, search or delete its mail.
 *   * The refresh token is server-side only: either sealed in the database (AES-256-GCM with the connector sealing
 *     helper, lib/connectors/secrets.ts, bound to the sender address) or read from GMAIL_REFRESH_TOKEN.
 *   * While the Google OAuth app is in "Testing", Google can expire refresh tokens after 7 days. A send then answers
 *     `not_connected` and the owner must reconnect (/api/email/google/start). This is documented, not solved.
 *   * Results never carry provider text, the recipient, the token or the message body.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { EmailMessage, EmailSendResult, EmailTransport } from "./core";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const GMAIL_CALLBACK_PATH = "/api/email/google/callback";
export const GMAIL_START_PATH = "/api/email/google/start";
/** AAD "provider" for the sealing helper: an envelope sealed for Gmail never opens as a connector credential. */
export const GMAIL_SEAL_PROVIDER = "gmail-sender";
export const GMAIL_STATE_TTL_S = 10 * 60;
export const GMAIL_CSRF_COOKIE = "baton_gmail_oauth";

const HTTP_TIMEOUT_MS = 10_000;
const EMAIL = /^[^\s<>@",;:()\\[\]]+@[^\s<>@",;:()\\[\]]+\.[^\s<>@",;:()\\[\]]+$/;
const PROVIDER_REF = /^[A-Za-z0-9._:-]{1,200}$/;
const OPAQUE_TOKEN = /^[A-Za-z0-9._~+/=-]{10,4096}$/;

type Env = Readonly<Record<string, string | undefined>>;
export type FetchFn = (input: string, init: RequestInit) => Promise<Pick<Response, "status" | "ok" | "json">>;

// ── configuration ────────────────────────────────────────────────────────────────────────────────────────

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  senderEmail: string;
}

const opaque = (v: string | undefined, min: number) => {
  const s = v?.trim() ?? "";
  return s.length >= min && s.length <= 4096 && !/\s/.test(s) ? s : null;
};

/** https anywhere, or http only on localhost; the path must be exactly the callback route. */
export function isValidRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.pathname !== GMAIL_CALLBACK_PATH || url.search || url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

/** The Gmail configuration, or null when any of the four variables is missing or malformed (fail closed). */
export function resolveGmailConfig(env: Env): GmailConfig | null {
  const clientId = opaque(env.GMAIL_CLIENT_ID, 10);
  const clientSecret = opaque(env.GMAIL_CLIENT_SECRET, 10);
  const redirectUri = env.GMAIL_REDIRECT_URI?.trim() ?? "";
  const senderEmail = env.GMAIL_SENDER_EMAIL?.trim().toLowerCase() ?? "";
  if (!clientId || !clientSecret || !isValidRedirectUri(redirectUri) || !isEmailAddress(senderEmail)) return null;
  return { clientId, clientSecret, redirectUri, senderEmail };
}

/** Names of the Gmail variables that are missing or malformed (names only, never values). */
export function missingGmailVariables(env: Env): string[] {
  const out: string[] = [];
  if (!opaque(env.GMAIL_CLIENT_ID, 10)) out.push("GMAIL_CLIENT_ID");
  if (!opaque(env.GMAIL_CLIENT_SECRET, 10)) out.push("GMAIL_CLIENT_SECRET");
  if (!isValidRedirectUri(env.GMAIL_REDIRECT_URI?.trim() ?? "")) out.push("GMAIL_REDIRECT_URI");
  if (!isEmailAddress(env.GMAIL_SENDER_EMAIL?.trim().toLowerCase() ?? "")) out.push("GMAIL_SENDER_EMAIL");
  return out;
}

/** GMAIL_REFRESH_TOKEN, when set and well formed (the env fallback when nothing is sealed in the database). */
export function envRefreshToken(env: Env): string | null {
  const t = opaque(env.GMAIL_REFRESH_TOKEN, 20);
  return t && OPAQUE_TOKEN.test(t) ? t : null;
}

// ── OAuth state and CSRF ─────────────────────────────────────────────────────────────────────────────────

export interface GmailStatePayload {
  v: 1;
  /** The profile that started the flow; the callback must be completed by the same signed-in owner. */
  profileId: string;
  /** Also stored in the httpOnly CSRF cookie: the callback needs both to match. */
  nonce: string;
  exp: number;
}

const STATE_DOMAIN = "baton:gmail-oauth-state:v1:";
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, body: string) => b64u(createHmac("sha256", secret).update(STATE_DOMAIN + body).digest());

export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function safeEqualText(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signGmailState(secret: string, payload: GmailStatePayload): string {
  if (!secret || secret.length < 32) throw new Error("state secret missing or too short");
  const body = b64u(JSON.stringify(payload));
  return `${body}.${mac(secret, body)}`;
}

export type GmailStateCheck = { ok: true; payload: GmailStatePayload } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyGmailState(secret: string, token: string | null | undefined, nowMs: number): GmailStateCheck {
  if (!secret || secret.length < 32 || typeof token !== "string" || token.length > 2048) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  if (!safeEqualText(token.slice(dot + 1), mac(secret, body))) return { ok: false, reason: "bad_signature" };
  let p: GmailStatePayload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!p || p.v !== 1 || typeof p.profileId !== "string" || typeof p.nonce !== "string" || p.nonce.length < 16 || typeof p.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (p.exp * 1000 < nowMs) return { ok: false, reason: "expired" };
  return { ok: true, payload: p };
}

/** The Google consent URL: gmail.send only, offline access (a refresh token), consent forced, the sender preselected. */
export function gmailAuthorizeUrl(config: GmailConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_SEND_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    login_hint: config.senderEmail,
    state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${q}`;
}

// ── token endpoint ───────────────────────────────────────────────────────────────────────────────────────

function scopesOf(raw: unknown): string[] {
  return typeof raw === "string" ? raw.split(/\s+/).filter(Boolean) : [];
}

async function postForm(fetchFn: FetchFn, params: Record<string, string>) {
  return fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    redirect: "error",
  });
}

export type CodeExchange =
  | { ok: true; refreshToken: string; scopes: string[] }
  | { ok: false; reason: "failed" | "no_refresh_token" | "missing_permissions" | "unexpected_scope" };

/** Server-side code exchange. Refuses a grant without gmail.send, with any other scope, or without a refresh token. */
export async function exchangeGmailCode(config: GmailConfig, code: string, fetchFn: FetchFn): Promise<CodeExchange> {
  let body: Record<string, unknown> | null;
  try {
    const res = await postForm(fetchFn, {
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    });
    if (!res.ok) return { ok: false, reason: "failed" };
    body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (!body) return { ok: false, reason: "failed" };
  const scopes = scopesOf(body.scope);
  if (!scopes.includes(GMAIL_SEND_SCOPE)) return { ok: false, reason: "missing_permissions" };
  if (scopes.some((s) => s !== GMAIL_SEND_SCOPE)) return { ok: false, reason: "unexpected_scope" };
  const refresh = typeof body.refresh_token === "string" ? body.refresh_token : "";
  if (!OPAQUE_TOKEN.test(refresh)) return { ok: false, reason: "no_refresh_token" };
  return { ok: true, refreshToken: refresh, scopes: [GMAIL_SEND_SCOPE] };
}

export type AccessToken = { ok: true; accessToken: string; expiresAtMs: number } | { ok: false; kind: "not_connected" | "failed" | "rate_limited" };

/** A fresh access token. `invalid_grant` (revoked, or expired after 7 days while the app is in Testing) is not_connected. */
export async function refreshGmailAccessToken(config: GmailConfig, refreshToken: string, fetchFn: FetchFn, nowMs: number): Promise<AccessToken> {
  try {
    const res = await postForm(fetchFn, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status === 429) return { ok: false, kind: "rate_limited" };
    if (!res.ok) return { ok: false, kind: body?.error === "invalid_grant" ? "not_connected" : "failed" };
    const token = typeof body?.access_token === "string" ? body.access_token : "";
    if (!OPAQUE_TOKEN.test(token)) return { ok: false, kind: "failed" };
    const granted = scopesOf(body?.scope);
    if (granted.length > 0 && !granted.includes(GMAIL_SEND_SCOPE)) return { ok: false, kind: "not_connected" };
    const ttl = typeof body?.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
    return { ok: true, accessToken: token, expiresAtMs: nowMs + ttl * 1000 };
  } catch {
    return { ok: false, kind: "failed" };
  }
}

// ── RFC 2822 / MIME message ──────────────────────────────────────────────────────────────────────────────

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

/** RFC 2047 encoded words (UTF-8, base64), split on character boundaries so each word stays short. */
export function encodeHeaderText(value: string): string {
  if (ASCII_PRINTABLE.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 42) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n");

export interface MimeInput {
  fromName: string;
  fromEmail: string;
  message: EmailMessage;
  date: Date;
  boundary: string;
}

/**
 * A multipart/alternative message (plain text first, then HTML), CRLF line endings, base64 bodies. Null when any
 * header value could inject a header (CR or LF) or an address is not a plain address.
 */
export function buildMimeMessage(input: MimeInput): string | null {
  const { message } = input;
  if ([message.to, message.subject, input.fromName, input.fromEmail].some((v) => /[\r\n]/.test(v))) return null;
  if (!isEmailAddress(message.to) || !isEmailAddress(input.fromEmail)) return null;
  if (!/^[A-Za-z0-9]{8,70}$/.test(input.boundary)) return null;
  const date = input.date.toUTCString().replace(/GMT$/, "+0000");
  const fromName = ASCII_PRINTABLE.test(input.fromName) ? `"${input.fromName.replace(/["\\]/g, "")}"` : encodeHeaderText(input.fromName);
  const b = input.boundary;
  return [
    `From: ${fromName} <${input.fromEmail}>`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeaderText(message.subject)}`,
    `Date: ${date}`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    `Content-Type: multipart/alternative; boundary="${b}"`,
    "",
    `--${b}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(message.text, "utf8").toString("base64")),
    `--${b}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(message.html, "utf8").toString("base64")),
    `--${b}--`,
    "",
  ].join("\r\n");
}

/** Gmail's `raw` field: the whole RFC 2822 message, base64url without padding. */
export function toGmailRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}

// ── refresh token sources ────────────────────────────────────────────────────────────────────────────────

/** The sealed refresh token as stored (lib/email/gmail-store.ts). */
export interface StoredGmailSender {
  senderEmail: string;
  sealedRefreshToken: string;
}

export interface GmailTokenStore {
  get(): Promise<StoredGmailSender | null>;
  put(row: { senderEmail: string; sealedRefreshToken: string; scopes: string[]; connectedBy: string }): Promise<void>;
}

/**
 * Where the refresh token comes from: the sealed database row for THIS sender (when it opens), else
 * GMAIL_REFRESH_TOKEN, else null (not connected). A row for another sender address is ignored.
 */
export function refreshTokenSource(options: {
  config: GmailConfig;
  store: GmailTokenStore | null;
  open: ((senderEmail: string, sealed: string) => string | null) | null;
  envToken: string | null;
}): () => Promise<string | null> {
  return async () => {
    if (options.store && options.open) {
      try {
        const row = await options.store.get();
        if (row && row.senderEmail.toLowerCase() === options.config.senderEmail) {
          const opened = options.open(options.config.senderEmail, row.sealedRefreshToken);
          if (opened) return opened;
        }
      } catch {
        // fall through to the environment
      }
    }
    return options.envToken;
  };
}

// ── transport ────────────────────────────────────────────────────────────────────────────────────────────

const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "quotaExceeded"]);

function isRateLimited(status: number, body: unknown): boolean {
  if (status === 429) return true;
  if (status !== 403 || !body || typeof body !== "object") return false;
  const errors = (body as { error?: { errors?: { reason?: unknown }[] } }).error?.errors;
  return Array.isArray(errors) && errors.some((e) => typeof e?.reason === "string" && RATE_REASONS.has(e.reason));
}

export interface GmailTransportOptions {
  fetchFn?: FetchFn;
  now?: () => number;
  boundary?: () => string;
  fromName?: string;
}

/**
 * The Gmail transport. One send = at most one access-token refresh and one Gmail call, plus exactly one retry when
 * Gmail answers 401 (the request was refused, so nothing was sent). Network errors, timeouts and 5xx answers are NOT
 * retried: the message may have been sent, and a retry could deliver it twice.
 */
export function createGmailTransport(config: GmailConfig, getRefreshToken: () => Promise<string | null>, options: GmailTransportOptions = {}): EmailTransport {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const boundary = options.boundary ?? (() => `baton${randomBytes(16).toString("hex")}`);
  const fromName = options.fromName ?? "Baton";
  let cached: { accessToken: string; expiresAtMs: number } | null = null;
  let inflight: Promise<AccessToken> | null = null;

  async function accessToken(force: boolean): Promise<AccessToken> {
    if (!force && cached && cached.expiresAtMs - 60_000 > now()) return { ok: true, ...cached };
    if (force) cached = null;
    inflight ??= (async () => {
      const refresh = await getRefreshToken().catch(() => null);
      if (!refresh) return { ok: false as const, kind: "not_connected" as const };
      const t = await refreshGmailAccessToken(config, refresh, fetchFn, now());
      if (t.ok) cached = { accessToken: t.accessToken, expiresAtMs: t.expiresAtMs };
      return t;
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function post(token: string, raw: string) {
    const res = await fetchFn(GMAIL_SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      redirect: "error",
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  }

  return Object.freeze({
    configured: true,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const mime = buildMimeMessage({ fromName, fromEmail: config.senderEmail, message, date: new Date(now()), boundary: boundary() });
      if (!mime) return { ok: false, kind: "failed" };
      const raw = toGmailRaw(mime);
      try {
        let token = await accessToken(false);
        if (!token.ok) return { ok: false, kind: token.kind };
        let res = await post(token.accessToken, raw);
        if (res.status === 401) {
          token = await accessToken(true);
          if (!token.ok) return { ok: false, kind: token.kind };
          res = await post(token.accessToken, raw);
          if (res.status === 401) {
            cached = null;
            return { ok: false, kind: "not_connected" };
          }
        }
        if (isRateLimited(res.status, res.body)) return { ok: false, kind: "rate_limited" };
        if (!res.ok) return { ok: false, kind: "failed" };
        const id = (res.body as { id?: unknown } | null)?.id;
        return { ok: true, ref: typeof id === "string" && PROVIDER_REF.test(id) ? `gmail:${id}` : null };
      } catch {
        return { ok: false, kind: "failed" };
      }
    },
  });
}
