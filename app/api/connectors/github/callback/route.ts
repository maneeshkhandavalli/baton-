/**
 * GitHub App installation callback (Round 4 contract §5): verifies `state` against the signed-in user, exchanges the
 * code server-side, proves the user can access the installation, records it (no credentials), then redirects to
 * the handover's settings. Logic and tests: lib/connectors/providers/github/routes.ts.
 */

import { handleGithubCallback } from "@/lib/connectors/providers/github/routes";
import { connectorStore } from "@/lib/connectors/server";
import { getVerifiedActor } from "@/lib/db/actor";

export async function GET(request: Request): Promise<Response> {
  return handleGithubCallback(request, {
    env: process.env,
    now: () => Date.now(),
    store: connectorStore,
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    getActor: getVerifiedActor,
  });
}
