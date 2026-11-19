/** Slack connector webhook (Round 4, Worker 03): raw body, signature first; logic in lib/connectors/providers/slack/routes.ts. */

import { botRouteDeps } from "@/lib/connectors/providers/bots/server-deps";
import { handleSlackWebhook } from "@/lib/connectors/providers/slack/routes";

export async function POST(request: Request): Promise<Response> {
  return handleSlackWebhook(request, botRouteDeps());
}
