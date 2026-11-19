/**
 * Connector sync endpoint (Round 4 contract §5): pulls new messages for pull-based providers (Discord) and flushes
 * buffered messages into chat_import sources. Same authentication as /api/pipeline/drain (CRON_SECRET bearer or a
 * signed dispatch header); fails closed. Counts only in the response; nothing about content is logged.
 */

import { connectorConfigured } from "@/lib/connectors/config";
import { providerAdapter } from "@/lib/connectors/providers";
import { adapterContext, connectorStore } from "@/lib/connectors/server";
import { createSourceWriter } from "@/lib/connectors/source-writer";
import { runConnectorSync } from "@/lib/connectors/sync";
import { serverDb, serverStorage } from "@/lib/db";
import { callRpc } from "@/lib/db/rpc";
import { authenticateWorkerRequest } from "@/lib/pipeline/worker-auth";

export const maxDuration = 300;

const BUDGET = { maxLinks: 50, deadlineMs: 200_000 } as const;
const NO_STORE = { "cache-control": "no-store" };

async function sync(request: Request): Promise<Response> {
  const auth = authenticateWorkerRequest(request.headers, process.env.CRON_SECRET);
  if (!auth.ok) {
    if (auth.reason !== "no_credentials") console.warn(JSON.stringify({ scope: "connector", event: "sync_unauthorized", reason: auth.reason }));
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const store = connectorStore();
  try {
    const counts = await runConnectorSync(
      {
        store,
        adapter: providerAdapter,
        ctx: adapterContext(store),
        writer: createSourceWriter({ db: serverDb, storage: serverStorage }),
        enabled: (p) => connectorConfigured(p),
        now: () => Date.now(),
      },
      BUDGET,
    );
    const pruned = Number(await callRpc(serverDb(), "connector_prune_events", { p_days: 30 }).catch(() => 0)) || 0;
    console.info(JSON.stringify({ scope: "connector", event: "sync", ...counts, pruned }));
    return Response.json({ ...counts, pruned }, { headers: NO_STORE });
  } catch {
    console.warn(JSON.stringify({ scope: "connector", event: "sync_failed" }));
    return Response.json({ error: "internal" }, { status: 500, headers: NO_STORE });
  }
}

export const POST = sync;
export const GET = sync;
