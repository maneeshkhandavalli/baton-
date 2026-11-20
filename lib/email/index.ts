import "server-only";

/**
 * The server's email transport, built once. Round 4: Gmail API (gmail.send only) when the GMAIL_* variables are set
 * and a refresh token can exist (lib/email/gmail-server.ts); Resend when RESEND_API_KEY and BATON_EMAIL_FROM are
 * both set (R3 Task 06, D5). With both, Gmail is tried first on every send and Resend is used only when Gmail is
 * not connected yet (withNotConnectedFallback), so connecting Gmail later takes over without a restart. With
 * neither, nothing is ever sent and invitations fall back to the creator's copyable link. Logic and the invitation
 * template: lib/email/core.ts and lib/email/gmail-core.ts.
 */

import { emailTransportFor, withNotConnectedFallback, type EmailTransport } from "./core";
import { gmailServerTransport } from "./gmail-server";

let transport: EmailTransport | null = null;

export function serverEmailTransport(): EmailTransport {
  if (!transport) {
    const gmail = gmailServerTransport(process.env);
    const resend = emailTransportFor(process.env);
    transport = gmail ? withNotConnectedFallback(gmail, resend) : resend;
  }
  return transport;
}

export type { EmailMessage, EmailSendResult, EmailTransport } from "./core";
