/** Owner-only Gmail connection start (Round 4): thin wrapper; logic in lib/email/gmail-routes.ts. */

import { connection } from "next/server";

import { handleGmailStart } from "@/lib/email/gmail-routes";
import { gmailRouteDeps } from "@/lib/email/gmail-server";

export async function GET(request: Request): Promise<Response> {
  await connection(); // request-time only: reads the session (never prerendered)
  return handleGmailStart(request, gmailRouteDeps());
}
