/** Slack OAuth callback (Round 4, Worker 03): state check, server-side code exchange; logic in lib/connectors/providers/slack/routes.ts. */

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleSlackCallback } from "@/lib/connectors/providers/slack/routes";

export async function GET(request: Request): Promise<Response> {
  return handleSlackCallback(request, botRouteDeps());
}
