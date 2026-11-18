import "server-only";

/**
 * The server's email transport (R3 Task 06, D5). Built once from RESEND_API_KEY and BATON_EMAIL_FROM (server-only
 * variables). Without both, nothing is ever sent and invitations fall back to the creator's copyable link.
 * Logic and the invitation template: lib/email/core.ts.
 */

import { emailTransportFor, type EmailTransport } from "./core";

let transport: EmailTransport | null = null;

export function serverEmailTransport(): EmailTransport {
  transport ??= emailTransportFor(process.env);
  return transport;
}

export type { EmailMessage, EmailSendResult, EmailTransport } from "./core";
