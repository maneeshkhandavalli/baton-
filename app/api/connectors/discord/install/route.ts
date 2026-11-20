/** Discord connector install (Round 4, Worker 03): thin wrapper; logic in lib/connectors/providers/discord/routes.ts. */

import { connection } from "next/server";

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleDiscordInstall } from "@/lib/connectors/providers/discord/routes";

export async function GET(request: Request): Promise<Response> {
  await connection(); // request-time only: reads the query string and the session (never prerendered)
  return handleDiscordInstall(request, botRouteDeps());
}
