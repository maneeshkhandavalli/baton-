// Account deletion: revocation (audit 3.9a, S7, F17). lib/actions/core/account.ts deleteAccount with fakes only:
// no network, no provider, synthetic ids and tokens.
//   * provider tokens are revoked at the provider with the existing adapters, only AFTER the data purge committed,
//     using credentials read BEFORE the purge (the purge deletes them locally);
//   * a provider failure or a hanging provider never blocks the deletion, and is logged without secrets;
//   * every session of the account (all devices) is ended after the auth user is soft-deleted.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { InstallationRecord } from "../../connectors/types";
import * as account from "../core/account";
import { ACTOR_ID, H, OTHER_ID, fakeDeps } from "./helpers";

const SLACK_TOKEN = "xoxb-synthetic-not-a-real-token-0001";

function inst(id: string, provider: InstallationRecord["provider"], over: Partial<InstallationRecord> = {}): InstallationRecord {
  return {
    id,
    provider,
    externalAccountId: `${provider.toUpperCase()}1`,
    accountLabel: "Synthetic workspace",
    status: "active",
    statusReason: null,
    installedByProfileId: ACTOR_ID,
    scopes: [],
    hasCredentials: provider === "slack",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...over,
  };
}

const SLACK = inst("aaaaaaaa-0000-4000-8000-000000000001", "slack");
const DISCORD = inst("bbbbbbbb-0000-4000-8000-000000000002", "discord");
const TELEGRAM = inst("cccccccc-0000-4000-8000-000000000003", "telegram");
const GITHUB = inst("dddddddd-0000-4000-8000-000000000004", "github");

interface WorldOptions {
  installations?: InstallationRecord[];
  listError?: boolean;
  revoke?: Partial<Record<InstallationRecord["provider"], (credentials: string | null) => Promise<void>>>;
  noRevoke?: InstallationRecord["provider"][];
  rpc?: NonNullable<Parameters<typeof fakeDeps>[0]>["rpc"];
  revokeTimeoutMs?: number;
  storageListError?: boolean;
}

/** The deletion world plus a connector side that records every step into the same event list. */
function world(o: WorldOptions = {}) {
  const f = fakeDeps({
    rpc: {
      check_account_deletion: { data: { purgeHandoverIds: [H] } },
      delete_own_account: { data: { purgedHandovers: 1, memberships: 0 } },
      revoke_deleted_account_sessions: { data: { sessions: 2, refreshTokens: 3 } },
      ...(o.rpc ?? {}),
    },
    storage: { folders: { [`raw/${H}`]: ["s-1"] }, ...(o.storageListError ? { listError: true } : {}) },
  });
  // The local store: credentials exist until the purge (delete_own_account) runs, like the SQL trigger.
  const purged = () => f.events.includes("delete_own_account");
  const revoked: Array<{ provider: string; id: string; credentials: string | null; afterPurge: boolean }> = [];
  const connectors: account.AccountConnectorDeps = {
    revokeTimeoutMs: o.revokeTimeoutMs ?? 50,
    store: () =>
      ({
        async listInstallationsForProfile(profileId: string) {
          f.events.push("connectors.list");
          if (o.listError) throw Object.assign(new Error("db down with secret detail"), { code: "internal" });
          assert.equal(profileId, ACTOR_ID, "only the actor's own installations");
          return o.installations ?? [SLACK, DISCORD, TELEGRAM, GITHUB];
        },
      }) as never,
    adapterContext: () =>
      ({
        env: {},
        now: () => 0,
        async credentials(i: InstallationRecord) {
          if (purged()) return null; // the purge deleted the sealed credentials
          return i.provider === "slack" ? SLACK_TOKEN : null;
        },
      }) as never,
    adapter: async (provider) => {
      if (o.noRevoke?.includes(provider)) return {} as never;
      return {
        async revokeAtProvider(ctx: { credentials(i: InstallationRecord): Promise<string | null> }, installation: InstallationRecord) {
          const credentials = await ctx.credentials(installation);
          f.events.push(`revoke:${provider}`);
          revoked.push({ provider, id: installation.id, credentials, afterPurge: purged() });
          const custom = o.revoke?.[provider];
          if (custom) await custom(credentials);
        },
      } as never;
    },
  };
  return { ...f, connectors, revoked };
}

const input = { confirm: "DELETE" as const, purgeHandoverIds: [H] };

describe("deleteAccount: provider revocation", () => {
  it("revokes every live installation at its provider, only after the purge committed, with credentials read before it", async () => {
    const w = world();
    const r = await account.deleteAccount(w.deps, input, w.connectors);
    assert.deepEqual(r, { ok: true, data: null });
    const order = w.events.filter((e) => e !== "check_account_deletion");
    assert.equal(order[0], "connectors.list", "installations are listed before the purge");
    const purge = order.indexOf("delete_own_account");
    for (const p of ["slack", "discord", "telegram", "github"]) assert.ok(order.indexOf(`revoke:${p}`) > purge, `${p} is revoked after the purge`);
    assert.ok(order.indexOf("softDeleteUser") > Math.max(...["slack", "discord", "telegram", "github"].map((p) => order.indexOf(`revoke:${p}`))));
    assert.deepEqual(order.slice(-3), ["softDeleteUser", "revoke_deleted_account_sessions", "endSession"]);
    const slack = w.revoked.find((x) => x.provider === "slack")!;
    assert.equal(slack.credentials, SLACK_TOKEN, "Slack auth.revoke gets the token read before the purge deleted it");
    assert.ok(w.revoked.every((x) => x.afterPurge));
    assert.deepEqual(w.issues, []);
  });

  it("skips installations that are already revoked or were connected by someone else", async () => {
    const w = world({ installations: [SLACK, inst("eeeeeeee-0000-4000-8000-000000000005", "discord", { status: "revoked" }), inst("ffffffff-0000-4000-8000-000000000006", "telegram", { installedByProfileId: OTHER_ID })] });
    const r = await account.deleteAccount(w.deps, input, w.connectors);
    assert.ok(r.ok);
    assert.deepEqual(w.revoked.map((x) => x.provider), ["slack"]);
  });

  it("the purge fails: nothing is revoked at any provider, so every connection keeps working", async () => {
    const w = world({ rpc: { delete_own_account: { error: { code: "55P03", message: "lock timeout" } } } });
    const r = await account.deleteAccount(w.deps, input, w.connectors);
    assert.ok(!r.ok);
    assert.deepEqual(w.revoked, []);
    assert.ok(!w.events.some((e) => e.startsWith("revoke")));
  });

  it("the request is refused or Storage fails: the connector side is not even read", async () => {
    const refused = world({ rpc: { check_account_deletion: { error: { code: "BTPF0", message: "incomplete" } } } });
    assert.ok(!(await account.deleteAccount(refused.deps, input, refused.connectors)).ok);
    assert.ok(!refused.events.includes("connectors.list"));
    assert.deepEqual(refused.revoked, []);

    const storageDown = world({ storageListError: true });
    assert.ok(!(await account.deleteAccount(storageDown.deps, input, storageDown.connectors)).ok);
    assert.ok(!storageDown.events.includes("connectors.list"));
    assert.deepEqual(storageDown.revoked, []);
  });

  it("a provider failure is logged with provider, short reference and error class only; deletion still completes", async () => {
    const w = world({
      revoke: {
        slack: async (token) => {
          throw Object.assign(new Error(`slack said no for ${token} and someone@example.test`), { code: "unavailable" });
        },
        telegram: async () => {
          throw new Error("free text that must never be logged");
        },
      },
    });
    const r = await account.deleteAccount(w.deps, input, w.connectors);
    assert.deepEqual(r, { ok: true, data: null });
    assert.deepEqual(
      w.issues.sort((a, b) => String(a.details.provider).localeCompare(String(b.details.provider))),
      [
        { event: "connector not revoked at the provider after account deletion", details: { provider: "slack", installation: "aaaaaaaa", error: "unavailable" } },
        { event: "connector not revoked at the provider after account deletion", details: { provider: "telegram", installation: "cccccccc", error: "Error" } },
      ],
    );
    const logged = JSON.stringify(w.issues);
    assert.ok(!logged.includes(SLACK_TOKEN) && !logged.includes("xoxb") && !logged.includes("@example.test") && !logged.includes("free text"));
    assert.ok(w.events.includes("softDeleteUser") && w.events.includes("endSession"), "the auth step still runs");
  });

  it("a provider that never answers is cut off by the timeout; the deletion completes and logs 'timeout'", async () => {
    const w = world({ revokeTimeoutMs: 30, revoke: { discord: () => new Promise<void>(() => {}) } });
    const started = Date.now();
    const r = await account.deleteAccount(w.deps, input, w.connectors);
    assert.ok(r.ok);
    assert.ok(Date.now() - started < 2_000, "bounded");
    assert.deepEqual(w.issues, [{ event: "connector not revoked at the provider after account deletion", details: { provider: "discord", installation: "bbbbbbbb", error: "timeout" } }]);
  });

  it("listing the installations fails: logged (error class only) and the deletion goes on; the purge still deletes credentials locally", async () => {
    const w = world({ listError: true });
    const r = await account.deleteAccount(w.deps, input, w.connectors);
    assert.ok(r.ok);
    assert.deepEqual(w.issues, [{ event: "connector installations not listed before account deletion", details: { error: "internal" } }]);
    assert.ok(w.events.includes("delete_own_account"));
    assert.deepEqual(w.revoked, []);
  });

  it("an adapter without revokeAtProvider is skipped silently", async () => {
    const w = world({ installations: [GITHUB], noRevoke: ["github"] });
    const r = await account.deleteAccount(w.deps, input, w.connectors);
    assert.ok(r.ok);
    assert.deepEqual(w.issues, []);
  });

  it("without the connector side (older wiring) the deletion behaves as before", async () => {
    const w = world();
    const r = await account.deleteAccount(w.deps, input);
    assert.ok(r.ok);
    assert.ok(!w.events.includes("connectors.list"));
  });
});

describe("deleteAccount: sessions on every device", () => {
  it("ends every session of the account after the auth user is soft-deleted, then this browser's", async () => {
    const w = world();
    await account.deleteAccount(w.deps, input, w.connectors);
    const call = w.calls.find((c) => c.fn === "revoke_deleted_account_sessions")!;
    assert.equal(call.client, "admin");
    assert.deepEqual(call.args, { p_actor_profile_id: ACTOR_ID });
    const e = w.events;
    assert.ok(e.indexOf("softDeleteUser") < e.indexOf("revoke_deleted_account_sessions"));
    assert.ok(e.indexOf("revoke_deleted_account_sessions") < e.indexOf("endSession"));
  });

  it("the global revocation fails: logged with the database code, the deletion still succeeds and this browser is signed out", async () => {
    const w = world({ rpc: { revoke_deleted_account_sessions: { error: { code: "42501", message: "permission denied for table sessions" } } } });
    const r = await account.deleteAccount(w.deps, input, w.connectors);
    assert.deepEqual(r, { ok: true, data: null });
    assert.deepEqual(w.issues, [{ event: "sessions on other devices not revoked", details: { profileId: ACTOR_ID, error: "42501" } }]);
    assert.ok(!JSON.stringify(w.issues).includes("permission denied"));
    assert.equal(w.events.at(-1), "endSession");
  });

  it("the auth user cannot be soft-deleted: sessions are NOT ended (the retry needs this one)", async () => {
    const w = fakeDeps({
      rpc: { check_account_deletion: { data: { purgeHandoverIds: [] } }, delete_own_account: { data: { purgedHandovers: 0, memberships: 0 } } },
      softDeleteUser: async () => {
        throw new Error("admin api down");
      },
    });
    const r = await account.deleteAccount(w.deps, { confirm: "DELETE", purgeHandoverIds: [] });
    assert.ok(!r.ok);
    assert.ok(!w.events.includes("revoke_deleted_account_sessions"));
  });
});
