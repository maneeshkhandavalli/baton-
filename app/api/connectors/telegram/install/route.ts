/** Telegram connector install (Round 4, Worker 03): thin wrapper; logic in lib/connectors/providers/telegram/routes.ts. */

import { connection } from "next/server";

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleTelegramInstall } from "@/lib/connectors/providers/telegram/routes";

export async function GET(request: Request): Promise<Response> {
  await connection(); // request-time only: reads the query string and the session (never prerendered)
  return handleTelegramInstall(request, botRouteDeps());
}
