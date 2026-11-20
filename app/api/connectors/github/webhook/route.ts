/**
 * GitHub App webhook (Round 4 contract §5). Signature over the raw body first, then de-duplication by
 * X-GitHub-Delivery, lifecycle (uninstall / suspend / repository removed) and the consent gate in ingestEvent.
 * Logic and tests: lib/connectors/providers/github/routes.ts.
 */

import { handleGithubWebhook } from "@/lib/connectors/providers/github/routes";
import { connectorStore } from "@/lib/connectors/server";

export async function POST(request: Request): Promise<Response> {
  return handleGithubWebhook(request, { env: process.env, now: () => Date.now(), store: connectorStore });
}
