/** Owner-only Gmail OAuth callback (Round 4): state + CSRF cookie check, server-side code exchange, sealed storage. */

import { connection } from "next/server";

import { handleGmailCallback } from "@/lib/email/gmail-routes";
import { gmailRouteDeps } from "@/lib/email/gmail-server";

export async function GET(request: Request): Promise<Response> {
  await connection(); // request-time only: reads the query string, the cookie and the session (never prerendered)
  return handleGmailCallback(request, gmailRouteDeps());
}
