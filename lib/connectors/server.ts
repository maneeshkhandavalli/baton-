import "server-only";

/**
 * Real connector dependencies (server only). Provider routes use `connectorStore()` and `adapterContext()`;
 * Main's actions use `connectorDeps()`. Built per call (cheap); no module state holds credentials.
 */

import type { ConnectorDeps } from "../actions/core/connectors";
import { serverDb, serverStorage } from "../db";
import { callRpc } from "../db/rpc";
import { providerAdapter } from "./providers";
import type { AdapterContext } from "./providers/adapter";
import { getConnectorSecretKey, openCredentials } from "./secrets";
import { createSourceWriter } from "./source-writer";
import { createDbConnectorStore } from "./store-db";
import type { ConnectorStore } from "./types";

export function connectorStore(): ConnectorStore {
  return createDbConnectorStore(serverDb);
}

export function adapterContext(store: ConnectorStore = connectorStore()): AdapterContext {
  const key = getConnectorSecretKey();
  const secretKey = key.ok ? key.key : null;
  return {
    store,
    env: process.env,
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    now: () => Date.now(),
    secretKey,
    async credentials(installation) {
      if (!secretKey) return null;
      return openCredentials(secretKey, installation.provider, installation.externalAccountId, await store.getInstallationCredentials(installation.id));
    },
  };
}

export function connectorDeps(): ConnectorDeps {
  const store = connectorStore();
  return {
    store: () => store,
    adapter: providerAdapter,
    adapterContext: () => adapterContext(store),
    writer: () => createSourceWriter({ db: serverDb, storage: serverStorage }),
    env: process.env,
    now: () => Date.now(),
    // code-only lines (provider, event, fixed code): notice and revocation failures become visible in the logs
    log: (entry) => console.warn(JSON.stringify(entry)),
    async creatorHandovers(profileId) {
      const r = await callRpc(serverDb(), "connector_creator_handovers", { p_actor_profile_id: profileId });
      return Array.isArray(r) ? (r as Array<{ id: string; title: string }>).map((h) => ({ id: String(h.id), title: String(h.title) })) : [];
    },
    async displayName(profileId) {
      const r = await callRpc(serverDb(), "connector_actor_display_name", { p_profile_id: profileId });
      return typeof r === "string" && r.trim() !== "" ? r : null;
    },
  };
}
