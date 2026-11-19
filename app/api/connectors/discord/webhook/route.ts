/** Discord connector webhook (Round 4, Worker 03): raw body, signature first; logic in lib/connectors/providers/discord/routes.ts. */

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleDiscordWebhook } from "@/lib/connectors/providers/discord/routes";

export async function POST(request: Request): Promise<Response> {
  return handleDiscordWebhook(request, botRouteDeps());
}
