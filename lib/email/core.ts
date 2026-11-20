/**
 * Email transport for invitation emails (R3 Task 06, docs/history/round3/task06-contract.md §5, D5). Pure: no environment reads,
 * no logging, no module state. lib/email/index.ts builds the server's transport from the environment.
 *
 *   * Round 4: the preferred transport is the Gmail API (lib/email/gmail-core.ts, gmail.send scope only), chosen by
 *     lib/email/index.ts when the GMAIL_* variables are set. The Resend HTTP API below remains the fallback: it exists
 *     only when BOTH RESEND_API_KEY and BATON_EMAIL_FROM are set (server-only variables; never NEXT_PUBLIC_).
 *   * Otherwise the transport is "not configured": nothing is ever sent, and the creator copies the link (D6).
 *   * There is deliberately no dev outbox that logs messages: an invitation email contains the raw token.
 *   * Results carry no provider text: `ref` is the provider's message id (checked against a strict pattern), failures
 *     are only "failed" or "rate_limited".
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * `not_connected` (Gmail only): no usable refresh token (never connected, revoked, or expired while the Google app is
 * in Testing). Delivery treats it like "email not configured": the creator copies the link.
 */
export type EmailSendResult = { ok: true; ref: string | null } | { ok: false; kind: "failed" | "rate_limited" | "not_connected" };

export interface EmailTransport {
  /** false = nothing can be sent on this server (no provider configured). */
  readonly configured: boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export const NOT_CONFIGURED_TRANSPORT: EmailTransport = Object.freeze({
  configured: false,
  send: async (): Promise<EmailSendResult> => ({ ok: false, kind: "failed" }),
});

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;
const PROVIDER_REF = /^[A-Za-z0-9._:-]{1,200}$/;
/** "Baton <invites@example.com>" or "invites@example.com"; no line breaks (header injection). */
const FROM = /^(?:[^<>\r\n"]{1,80} <[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;

export interface EmailConfig {
  apiKey: string;
  from: string;
}

/** The provider configuration, or null when email is not set up (missing or malformed values fail closed). */
export function resolveEmailConfig(env: Readonly<Record<string, string | undefined>>): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  const from = env.BATON_EMAIL_FROM?.trim() ?? "";
  if (apiKey.length < 10 || /\s/.test(apiKey) || !FROM.test(from)) return null;
  return { apiKey, from };
}

type FetchFn = (input: string, init: RequestInit) => Promise<Pick<Response, "status" | "ok" | "json">>;

export function createResendTransport(config: EmailConfig, fetchFn: FetchFn = fetch): EmailTransport {
  return Object.freeze({
    configured: true,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      if (/[\r\n]/.test(message.to) || /[\r\n]/.test(message.subject)) return { ok: false, kind: "failed" };
      try {
        const response = await fetchFn(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          redirect: "error",
        });
        if (response.status === 429) return { ok: false, kind: "rate_limited" };
        if (!response.ok) return { ok: false, kind: "failed" };
        const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
        const ref = typeof body?.id === "string" && PROVIDER_REF.test(body.id) ? body.id : null;
        return { ok: true, ref };
      } catch {
        return { ok: false, kind: "failed" };
      }
    },
  });
}

/** The server's transport for an environment: Resend when configured, otherwise not configured. */
export function emailTransportFor(env: Readonly<Record<string, string | undefined>>, fetchFn?: FetchFn): EmailTransport {
  const config = resolveEmailConfig(env);
  return config ? createResendTransport(config, fetchFn) : NOT_CONFIGURED_TRANSPORT;
}

/**
 * The preferred transport (Gmail), falling back to another one (Resend) ONLY when the preferred one answers
 * `not_connected`: no usable refresh token, or Gmail refused the token, so nothing was sent and a second provider
 * cannot deliver the message twice. Every other result (sent, failed, rate limited, or a thrown error, where the
 * message may have gone out) is final. The preferred transport is asked on every send, so connecting Gmail later
 * takes over without a restart. Without a configured fallback this is the preferred transport unchanged.
 */
export function withNotConnectedFallback(preferred: EmailTransport, fallback: EmailTransport): EmailTransport {
  if (!fallback.configured) return preferred;
  return Object.freeze({
    configured: true,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const first = await preferred.send(message);
      if (first.ok || first.kind !== "not_connected") return first;
      return fallback.send(message);
    },
  });
}

// ── invitation email ───────────────────────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  incoming: "the incoming member",
  lead: "a lead",
  reviewer: "a reviewer",
  outgoing: "an outgoing member",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Collapses whitespace and control characters (user-controlled values in a subject or a plain-text line). */
function oneLine(value: string, max: number): string {
  const flat = value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface InvitationEmailInput {
  to: string;
  handoverTitle: string;
  inviterName: string;
  role: string;
  url: string;
  expiresAt: string;
}

/** "25 November 2026 at 10:00 UTC" (no dashes; an unparseable date falls back to the raw value, one line). */
export function formatExpiry(expiresAt: string): string {
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return oneLine(expiresAt, 60);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date} at ${time} UTC`;
}

/**
 * Plain text + simple HTML (inline styles only). Every user-controlled value is escaped; no images, tracking pixels,
 * scripts or external resources. The plain-text part carries the same facts and the full link.
 */
export function renderInvitationEmail(input: InvitationEmailInput): EmailMessage {
  const inviter = oneLine(input.inviterName, 80) || "Someone";
  const title = oneLine(input.handoverTitle, 120) || "a handover";
  const role = ROLE_LABEL[input.role] ?? "a member";
  const expires = formatExpiry(input.expiresAt);
  const subject = `${inviter} invited you to a Baton handover`;
  const text = [
    "Hello,",
    "",
    `${inviter} has invited you to join the handover "${title}" on Baton as ${role}.`,
    "",
    "Open the invitation:",
    input.url,
    "",
    `This link can be used once and expires on ${expires}.`,
    "Sign in with this email address to accept it.",
    "",
    "If you weren't expecting this invitation, you can ignore this email. Nothing happens unless you open the link and accept.",
    "",
    "Baton",
  ].join("\n");
  const p = 'style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933"';
  const small = 'style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#52606d"';
  const html = [
    '<div style="max-width:560px;margin:0 auto;padding:24px">',
    `<p ${p}>Hello,</p>`,
    `<p ${p}>${escapeHtml(inviter)} has invited you to join the handover <strong>${escapeHtml(title)}</strong> on Baton as ${escapeHtml(role)}.</p>`,
    `<p ${p}><a href="${escapeHtml(input.url)}" style="display:inline-block;padding:10px 18px;background:#1f2933;color:#ffffff;text-decoration:none;border-radius:6px">Open the invitation</a></p>`,
    `<p ${small}>This link can be used once and expires on ${escapeHtml(expires)}. Sign in with this email address to accept it.</p>`,
    `<p ${small}>If the button doesn't work, copy this link into your browser:<br>${escapeHtml(input.url)}</p>`,
    `<p ${small}>If you weren't expecting this invitation, you can ignore this email. Nothing happens unless you open the link and accept.</p>`,
    "</div>",
  ].join("\n");
  return { to: input.to, subject, text, html };
}
