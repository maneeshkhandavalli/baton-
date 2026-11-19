/** Discord connector install (Round 4, Worker 03): thin wrapper; logic in lib/connectors/providers/discord/routes.ts. */

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleDiscordInstall } from "@/lib/connectors/providers/discord/routes";

export async function GET(request: Request): Promise<Response> {
  return handleDiscordInstall(request, botRouteDeps());
}
