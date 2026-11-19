/** Discord OAuth callback (Round 4, Worker 03): state check, server-side code exchange; logic in lib/connectors/providers/discord/routes.ts. */

import { connection } from "next/server";

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleDiscordCallback } from "@/lib/connectors/providers/discord/routes";

export async function GET(request: Request): Promise<Response> {
  await connection(); // request-time only: reads the query string and the session (never prerendered)
  return handleDiscordCallback(request, botRouteDeps());
}
