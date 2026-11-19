/** Slack connector install (Round 4, Worker 03): thin wrapper; logic in lib/connectors/providers/slack/routes.ts. */

import { connection } from "next/server";

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleSlackInstall } from "@/lib/connectors/providers/slack/routes";

export async function GET(request: Request): Promise<Response> {
  await connection(); // request-time only: reads the query string and the session (never prerendered)
  return handleSlackInstall(request, botRouteDeps());
}
