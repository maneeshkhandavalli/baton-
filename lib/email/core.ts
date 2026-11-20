/**
 * Email transport for invitation emails (R3 Task 06, docs/history/round3/task06-contract.md §5, D5). Pure: no environment reads,
 * no logging, no module state. lib/email/index.ts builds the server's transport from the environment.
 *
 *   * The ONLY production transport is the Resend HTTP API, through `fetch` (no package). It exists only when BOTH
 *     RESEND_API_KEY and BATON_EMAIL_FROM are set (server-only variables; never NEXT_PUBLIC_).
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

export type EmailSendResult = { ok: true; ref: string | null } | { ok: false; kind: "failed" | "rate_limited" };

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

/** Plain text + minimal HTML. Every user-controlled value is escaped; no images, tracking or external resources. */
export function renderInvitationEmail(input: InvitationEmailInput): EmailMessage {
  const inviter = oneLine(input.inviterName, 80) || "Someone";
  const title = oneLine(input.handoverTitle, 120);
  const role = ROLE_LABEL[input.role] ?? "a member";
  const expires = new Date(input.expiresAt).toUTCString().replace(/:\d\d GMT$/, " UTC");
  const subject = `${inviter} invited you to a Baton handover`;
  const text = [
    `${inviter} invited you to join "${title}" on Baton as ${role}.`,
    "",
    "Open the invitation:",
    input.url,
    "",
    `The link works once and expires on ${expires}. Sign in with this email address to accept it.`,
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");
  const html = [
    `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(title)}</strong> on Baton as ${escapeHtml(role)}.</p>`,
    `<p><a href="${escapeHtml(input.url)}">Open the invitation</a></p>`,
    `<p>The link works once and expires on ${escapeHtml(expires)}. Sign in with this email address to accept it.</p>`,
    "<p>If you weren't expecting this, you can ignore this email.</p>",
  ].join("\n");
  return { to: input.to, subject, text, html };
}
