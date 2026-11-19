/** Discord OAuth callback (Round 4, Worker 03): state check, server-side code exchange; logic in lib/connectors/providers/discord/routes.ts. */

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleDiscordCallback } from "@/lib/connectors/providers/discord/routes";

export async function GET(request: Request): Promise<Response> {
  return handleDiscordCallback(request, botRouteDeps());
}
