// Owner self-check (/test): the allow-list gate, production flags, and that no check ever outputs a secret value.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { connectorConfigCheck, forbiddenFlagChecks, identityChecks, secretChecks, siteUrlCheck, aiConfigChecks } from "../env-checks";
import { isOwner, parseOwnerEmails } from "../gate";
import { omegaUsageCheck, pageCheck, telegramWebhookCheck, type FetchLike } from "../remote-checks";
import { guarded, runSelfTest, VERCEL_CRONS_CONFIGURED } from "../run";
import type { SelfTestDb } from "../db-checks";
import { summaryLabel } from "../types";

const confirmed = (email: string | null) => ({ email, emailConfirmed: true });

describe("owner allow-list", () => {
  it("unset or empty denies everyone", () => {
    assert.equal(isOwner(confirmed("owner@example.com"), {}), false);
    assert.equal(isOwner(confirmed("owner@example.com"), { BATON_OWNER_EMAILS: "" }), false);
    assert.equal(isOwner(confirmed("owner@example.com"), { BATON_OWNER_EMAILS: " , ,, " }), false);
    assert.equal(parseOwnerEmails(undefined).size, 0);
  });

  it("trims entries and compares case-insensitively", () => {
    const env = { BATON_OWNER_EMAILS: "  Owner@Example.com , second@example.org ,," };
    assert.deepEqual([...parseOwnerEmails(env.BATON_OWNER_EMAILS)], ["owner@example.com", "second@example.org"]);
    assert.equal(isOwner(confirmed("owner@example.com"), env), true);
    assert.equal(isOwner(confirmed("OWNER@EXAMPLE.COM "), env), true);
    assert.equal(isOwner(confirmed("Second@Example.org"), env), true);
  });

  it("denies non-members, signed-out, unconfirmed and email-less users", () => {
    const env = { BATON_OWNER_EMAILS: "owner@example.com" };
    assert.equal(isOwner(confirmed("someone@example.com"), env), false);
    assert.equal(isOwner(confirmed("owner@example.com.evil.test"), env), false);
    assert.equal(isOwner(confirmed("xowner@example.com"), env), false);
    assert.equal(isOwner(null, env), false);
    assert.equal(isOwner(undefined, env), false);
    assert.equal(isOwner({ email: "owner@example.com", emailConfirmed: false }, env), false);
    assert.equal(isOwner(confirmed(null), env), false);
    assert.equal(isOwner(confirmed(""), env), false);
  });

  it("proxy.ts gates /test with the same allow-list", () => {
    const proxy = readFileSync(new URL("../../../proxy.ts", import.meta.url), "utf8");
    assert.match(proxy, /OWNER_ONLY_PREFIX = "\/test"/);
    assert.match(proxy, /PROTECTED_PREFIXES = \[[^\]]*OWNER_ONLY_PREFIX\]/);
    assert.match(proxy, /!isOwner\(user\)/);
  });

  it("the page re-checks the owner and is noindex", () => {
    const page = readFileSync(new URL("../../../app/(workspace)/test/page.tsx", import.meta.url), "utf8");
    assert.match(page, /if \(!owner\) notFound\(\)/);
    assert.match(page, /robots: \{ index: false, follow: false \}/);
    const action = readFileSync(new URL("../actions.ts", import.meta.url), "utf8");
    assert.match(action, /const owner = await getVerifiedOwner\(\);\n\s*if \(!owner\) return/);
  });
});

describe("forbidden-in-production flags", () => {
  const flags = ["BATON_ALLOW_FAKE_AI", "BATON_ALLOW_EVAL_PROVIDER", "BATON_DEV_WORKER"];
  it("FAIL when set in production", () => {
    for (const flag of flags) {
      const rows = forbiddenFlagChecks({ NODE_ENV: "production", [flag]: "1" });
      assert.equal(rows.find((r) => r.name === flag)?.status, "fail", flag);
    }
    assert.equal(forbiddenFlagChecks({ NODE_ENV: "production", BATON_DEV_WORKER: "0" }).find((r) => r.name === "BATON_DEV_WORKER")?.status, "fail");
  });
  it("OK when unset, WARN when set outside production", () => {
    assert.ok(forbiddenFlagChecks({ NODE_ENV: "production" }).every((r) => r.status === "ok"));
    assert.equal(forbiddenFlagChecks({ NODE_ENV: "development", BATON_ALLOW_FAKE_AI: "1" })[0].status, "warn");
  });
});

// Recognisable fake secrets: none of these may appear anywhere in a serialised result.
const SECRETS = {
  OMEGA_API_KEY: "sk-omega-SECRET-aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  AI_API_KEY: "gemini-SECRET-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  IDENTITY_PEPPER: "pepper-SECRET-cccccccccccccccccccccccccccccccc",
  IDENTITY_MAP_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdee",
  CRON_SECRET: "cron-SECRET-dddddddddddddddddddddddddddddddd",
  CONNECTOR_STATE_SECRET: "state-SECRET-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  CONNECTOR_SECRET_KEY: "conkey-SECRET-ffffffffffffffffffffffffffffff",
  CONNECTOR_SYNC_SECRET: "sync-SECRET-gggggggggggggggggggggggggggggggg",
  TELEGRAM_BOT_TOKEN: "123456:tg-SECRET-hhhhhhhhhhhhhhhhhhhhhhhhhhh",
  TELEGRAM_WEBHOOK_SECRET: "tgwh-SECRET-iiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
  DISCORD_BOT_TOKEN: "discord-SECRET-jjjjjjjjjjjjjjjjjjjjjjjjjjjj",
  DISCORD_CLIENT_SECRET: "discordcs-SECRET-kkkkkkkkkkkkkkkkkkkkkkkk",
  SLACK_CLIENT_SECRET: "slackcs-SECRET-llllllllllllllllllllllllll",
  SLACK_SIGNING_SECRET: "slacksig-SECRET-mmmmmmmmmmmmmmmmmmmmmmmmm",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nghkey-SECRET-nnnnnnnnnnnnnnnnnnnnnnnnnnnn\\n-----END PRIVATE KEY-----",
  GITHUB_APP_CLIENT_SECRET: "ghcs-SECRET-oooooooooooooooooooooooooooooo",
  GITHUB_WEBHOOK_SECRET: "ghwh-SECRET-pppppppppppppppppppppppppppppp",
  SUPABASE_SERVICE_ROLE_KEY: "service-SECRET-qqqqqqqqqqqqqqqqqqqqqqqqqqqq",
};

const ENV = {
  ...SECRETS,
  NODE_ENV: "production",
  AI_PROVIDER: "omega",
  AI_DATA_GOVERNANCE: "omega-owner-approved",
  AI_MODEL_EXTRACT: "claude-sonnet-5-5",
  AI_MODEL_VERIFY: "claude-sonnet-5",
  BATON_SITE_URL: "https://baton.example.com",
  IDENTITY_PEPPER_VERSION: "p1",
  IDENTITY_PEPPER_CANARY: "00".repeat(32),
  IDENTITY_MAP_KEY_VERSION: "k1",
  TELEGRAM_BOT_USERNAME: "baton_bot",
  DISCORD_APPLICATION_ID: "1",
  DISCORD_PUBLIC_KEY: "a".repeat(64),
  SLACK_CLIENT_ID: "1.2",
  GITHUB_APP_ID: "1",
  GITHUB_APP_SLUG: "baton",
  GITHUB_APP_CLIENT_ID: "Iv1",
  VERCEL_GIT_COMMIT_SHA: "3726918abcdef",
  VERCEL_ENV: "production",
};

function assertNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  for (const [name, secret] of Object.entries(SECRETS)) {
    assert.ok(!text.includes(secret), `${name} leaked`);
    for (const part of secret.split(/\\n/)) if (part.length >= 16) assert.ok(!text.includes(part), `${name} (part) leaked`);
  }
  assert.ok(!/SECRET-/.test(text), "a secret marker leaked");
}

/** A fetch that echoes secrets back in every answer (worst case: providers reflecting credentials). */
const echoFetch: FetchLike = async (url, init) => {
  const headers = JSON.stringify(init?.headers ?? {});
  if (url.includes("api.telegram.org")) {
    return Response.json({
      ok: true,
      result: { url: `https://baton.example.com/api/connectors/telegram/webhook?token=${SECRETS.TELEGRAM_BOT_TOKEN}`, pending_update_count: 2, last_error_message: `Wrong response ${url} ${SECRETS.TELEGRAM_WEBHOOK_SECRET}` },
    });
  }
  if (url.endsWith("/v1/usage")) {
    return Response.json({ data: { remaining_tokens: 900, used_tokens: 100, usage_percent: 10, api_key: SECRETS.OMEGA_API_KEY, echo: headers } });
  }
  return new Response(`page ${headers} ${SECRETS.CRON_SECRET}`, { status: 302, headers: { location: `https://evil.example/?k=${SECRETS.CRON_SECRET}` } });
};

/** A database whose errors carry secret-bearing messages. */
function fakeDb(): SelfTestDb {
  const err = { code: "42501", message: `denied for ${SECRETS.SUPABASE_SERVICE_ROLE_KEY}` };
  const query = {
    select: () => query,
    in: () => query,
    eq: () => query,
    gte: () => query,
    order: () => query,
    limit: () => query,
    then: (resolve: (v: unknown) => void) => resolve({ data: null, count: null, error: err }),
  };
  return {
    from: () => query,
    rpc: async () => ({ data: null, error: err }),
    auth: { admin: { listUsers: async () => ({ data: null, error: { status: 401, message: SECRETS.SUPABASE_SERVICE_ROLE_KEY } }) } },
    storage: { getBucket: async () => ({ data: null, error: err }) },
  };
}

describe("checks never output secret values", () => {
  it("environment checks", () => {
    const rows = [
      ...aiConfigChecks(ENV),
      siteUrlCheck(ENV, "https://baton.example.com"),
      ...identityChecks(ENV),
      ...secretChecks(ENV),
      ...forbiddenFlagChecks(ENV),
      ...(["telegram", "discord", "slack", "github"] as const).map((p) => connectorConfigCheck(ENV, p)),
    ];
    assertNoSecrets(rows);
    assert.equal(aiConfigChecks(ENV)[0].status, "ok");
    assert.match(aiConfigChecks(ENV)[1].detail, /claude-sonnet-5-5/);
  });

  it("CONNECTOR_SYNC_SECRET equal to CRON_SECRET fails without printing either", () => {
    const rows = secretChecks({ ...ENV, CONNECTOR_SYNC_SECRET: SECRETS.CRON_SECRET });
    const row = rows.find((r) => r.name === "Sync secret differs from cron secret");
    assert.equal(row?.status, "fail");
    assertNoSecrets(rows);
  });

  it("remote checks (Telegram, Omega usage, pages) with provider answers that echo secrets", async () => {
    const tg = await telegramWebhookCheck(ENV, echoFetch);
    const omega = await omegaUsageCheck(ENV, echoFetch);
    const page = await pageCheck("https://baton.example.com", "/login", echoFetch);
    assert.match(omega.detail, /remaining 900, used 100, usage 10%/);
    assert.match(page.detail, /another host/);
    assertNoSecrets([tg, page, omega]);
    assert.match(tg.detail, /host baton\.example\.com/);
  });

  it("the full report (with the final redaction pass)", async () => {
    const report = await runSelfTest({
      env: ENV,
      now: new Date("2026-11-20T14:20:00Z"),
      requestOrigin: "https://baton.example.com",
      db: fakeDb,
      fetch: echoFetch,
      bucket: "source-uploads",
      serviceKeyPresent: true,
      timeoutMs: 2_000,
    });
    assertNoSecrets(report);
    assert.ok(report.sections.some((s) => s.id === "omega"));
    assert.ok(report.summary.fail > 0); // the fake database refuses everything
    const db = report.sections.find((s) => s.id === "database")!;
    assert.ok(db.rows.every((r) => r.status === "fail" && /code 42501/.test(r.detail)));
  });

  it("a thrown or slow check becomes a FAIL row with a safe message", async () => {
    const thrown = await guarded("X", async () => {
      throw new Error(`boom ${SECRETS.CRON_SECRET}`);
    });
    assert.deepEqual(thrown, [{ name: "X", status: "fail", detail: "check failed (error hidden)" }]);
    const slow = await guarded("Y", () => new Promise(() => {}), 20);
    assert.equal(slow[0].status, "fail");
    assert.match(slow[0].detail, /timed out/);
  });
});

describe("report helpers", () => {
  it("summary label", () => {
    assert.equal(summaryLabel({ ok: 3, warn: 0, fail: 0 }), "All good");
    assert.equal(summaryLabel({ ok: 3, warn: 2, fail: 1 }), "2 warnings, 1 failure");
  });
  it("the Vercel cron constant matches the repository", () => {
    const vercel = new URL("../../../vercel.json", import.meta.url);
    const hasCrons = existsSync(vercel) && /"crons"\s*:\s*\[\s*\{/.test(readFileSync(vercel, "utf8"));
    assert.equal(VERCEL_CRONS_CONFIGURED, hasCrons);
  });
});
