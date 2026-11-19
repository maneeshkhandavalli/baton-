/** Telegram connector webhook (Round 4, Worker 03): raw body, signature first; logic in lib/connectors/providers/telegram/routes.ts. */

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleTelegramWebhook } from "@/lib/connectors/providers/telegram/routes";

export async function POST(request: Request): Promise<Response> {
  return handleTelegramWebhook(request, botRouteDeps());
}
