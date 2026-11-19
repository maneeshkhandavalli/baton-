// Connector sync and pipeline drain use separate secrets; neither credential works on the other endpoint.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { authenticateWorkerRequest, signDispatch } from "../../pipeline/worker-auth";
import { authenticateConnectorSync } from "../sync-auth";

const CRON = "pipeline-cron-secret-0123456789abcdef-xyz";
const SYNC = "connector-sync-secret-0123456789abcdef-xyz";
const ENV = { CRON_SECRET: CRON, CONNECTOR_SYNC_SECRET: SYNC };
const NOW = 1_800_000_000_000;
const T = NOW / 1000;
const h = (o: Record<string, string>) => new Headers(o);
const bearer = (s: string) => h({ authorization: `Bearer ${s}` });
const dispatch = (secret: string, purpose: "drain" | "connector_sync") => h({ "x-baton-dispatch": `v1.${T}.7.${signDispatch(secret, T, 7, purpose)}` });

describe("connector sync authentication", () => {
  it("accepts its own secret (bearer and connector_sync dispatch)", () => {
    assert.deepEqual(authenticateConnectorSync(bearer(SYNC), ENV, NOW), { ok: true, via: "bearer" });
    assert.deepEqual(authenticateConnectorSync(dispatch(SYNC, "connector_sync"), ENV, NOW), { ok: true, via: "dispatch" });
  });

  it("refuses the pipeline's CRON_SECRET and pipeline dispatches", () => {
    for (const headers of [bearer(CRON), dispatch(CRON, "drain"), dispatch(CRON, "connector_sync"), dispatch(SYNC, "drain")]) {
      const r = authenticateConnectorSync(headers, ENV, NOW);
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.status, 401);
    }
  });

  it("the pipeline drain refuses the connector sync secret and sync dispatches", () => {
    for (const headers of [bearer(SYNC), dispatch(SYNC, "connector_sync"), dispatch(SYNC, "drain"), dispatch(CRON, "connector_sync")]) {
      assert.equal(authenticateWorkerRequest(headers, CRON, NOW).ok, false);
    }
    assert.equal(authenticateWorkerRequest(bearer(CRON), CRON, NOW).ok, true, "the drain still accepts CRON_SECRET");
  });

  it("fails closed with an operational 503 when the secret is unset, short or reused; never echoes a value", () => {
    for (const env of [{ CRON_SECRET: CRON } as Record<string, string>, { ...ENV, CONNECTOR_SYNC_SECRET: "" }, { ...ENV, CONNECTOR_SYNC_SECRET: "s".repeat(31) }, { CRON_SECRET: CRON, CONNECTOR_SYNC_SECRET: CRON }]) {
      const r = authenticateConnectorSync(bearer(env.CONNECTOR_SYNC_SECRET || "x".repeat(40)), env, NOW);
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.status, 503);
      assert.match(!r.ok && r.status === 503 ? r.message : "", /CONNECTOR_SYNC_SECRET/);
      assert.doesNotMatch(JSON.stringify(r), new RegExp(CRON));
    }
  });

  it("anonymous probes and malformed credentials are plain 401s", () => {
    assert.equal((authenticateConnectorSync(h({}), ENV, NOW) as { status: number }).status, 401);
    assert.equal((authenticateConnectorSync(h({ authorization: "Basic abc" }), ENV, NOW) as { status: number }).status, 401);
    assert.equal((authenticateConnectorSync(h({ "x-baton-dispatch": "v1.garbage" }), ENV, NOW) as { status: number }).status, 401);
  });
});
