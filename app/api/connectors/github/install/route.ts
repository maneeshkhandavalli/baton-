/**
 * Starts the GitHub App installation for a handover (Round 4 contract §5): signed-in creator only, signed `state`,
 * redirect to github.com/apps/<slug>/installations/new. Logic and tests: lib/connectors/providers/github/routes.ts.
 */

import { handleGithubInstall } from "@/lib/connectors/providers/github/routes";
import { connectorStore } from "@/lib/connectors/server";
import { getVerifiedActor } from "@/lib/db/actor";

export async function GET(request: Request): Promise<Response> {
  return handleGithubInstall(request, {
    env: process.env,
    now: () => Date.now(),
    store: connectorStore,
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    getActor: getVerifiedActor,
  });
}
