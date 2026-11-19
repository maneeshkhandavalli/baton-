/** Telegram connector install (Round 4, Worker 03): thin wrapper; logic in lib/connectors/providers/telegram/routes.ts. */

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleTelegramInstall } from "@/lib/connectors/providers/telegram/routes";

export async function GET(request: Request): Promise<Response> {
  return handleTelegramInstall(request, botRouteDeps());
}
