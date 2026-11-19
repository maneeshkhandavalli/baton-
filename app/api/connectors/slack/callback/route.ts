/** Slack OAuth callback (Round 4, Worker 03): state check, server-side code exchange; logic in lib/connectors/providers/slack/routes.ts. */

import { connection } from "next/server";

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleSlackCallback } from "@/lib/connectors/providers/slack/routes";

export async function GET(request: Request): Promise<Response> {
  await connection(); // request-time only: reads the query string and the session (never prerendered)
  return handleSlackCallback(request, botRouteDeps());
}
