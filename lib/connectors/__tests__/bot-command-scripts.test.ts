// Owner-run command registration scripts (2026-11-21): Discord /handover registration and Telegram setMyCommands.
// Tested through their pure module with a FAKE fetch: no Discord or Telegram API is ever called, and importing the
// scripts themselves runs nothing (they only run when started directly by the owner).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BOT_COMMAND_ACTIONS, parseCommandAction } from "../providers/bots/commands";
import { DISCORD_ACTION_OPTION, DISCORD_COMMAND_NAME } from "../providers/discord/routes";
import { ourCommandAction } from "../providers/telegram/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = any;
const mod = (): Promise<Mod> => import("../../../scripts/connectors/bot-commands.mjs" as string);

const APP_ID = "900000000000000001";
const DISCORD_TOKEN = "discord-synthetic-token-never-printed";
const TG_TOKEN = "123456:telegram-synthetic-token-never-printed";

function fakeFetch(answer: (url: string, init: RequestInit) => { status: number; json: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answer(url, init);
    return new Response(JSON.stringify(a.json), { status: a.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("Discord /handover registration (scripts/connectors/discord-register-commands.mjs)", () => {
  it("payload: one global guild-only chat command named like the route expects, with the action choices the route parses", async () => {
    const m = await mod();
    assert.equal(m.DISCORD_COMMANDS.length, 1);
    const c = m.DISCORD_COMMANDS[0];
    assert.equal(c.name, DISCORD_COMMAND_NAME);
    assert.equal(c.type, 1);
    assert.deepEqual(c.contexts, [0]);
    assert.deepEqual(c.integration_types, [0]);
    assert.equal(c.default_member_permissions, undefined, "any member may ask; the creator check happens in Baton");
    assert.ok(c.description.length <= 100, "Discord limit");
    const opt = c.options[0];
    assert.equal(opt.name, DISCORD_ACTION_OPTION);
    assert.equal(opt.type, 3);
    assert.equal(opt.required, false, "/handover alone still means connect");
    const values = opt.choices.map((x: { value: string }) => x.value);
    assert.deepEqual([...values].sort(), [...BOT_COMMAND_ACTIONS].sort());
    for (const v of values) assert.equal(parseCommandAction(v), v);
  });

  it("registers with PUT (bulk overwrite) to the application's global commands, bot auth, and prints ids only", async () => {
    const m = await mod();
    const f = fakeFetch(() => ({ status: 200, json: [{ id: "123", name: "handover" }] }));
    const r = await m.registerDiscordCommands({ env: { DISCORD_APPLICATION_ID: APP_ID, DISCORD_BOT_TOKEN: DISCORD_TOKEN }, fetch: f.fn });
    assert.equal(r.ok, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, `https://discord.com/api/v10/applications/${APP_ID}/commands`);
    assert.equal(f.calls[0].init.method, "PUT");
    assert.equal(new Headers(f.calls[0].init.headers).get("authorization"), `Bot ${DISCORD_TOKEN}`);
    assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), JSON.parse(JSON.stringify(m.DISCORD_COMMANDS)));
    assert.deepEqual(r.lines, ["Registered /handover (id 123). Global commands can take a few minutes to appear."]);
    assert.ok(!r.lines.join("").includes(DISCORD_TOKEN));
  });

  it("refuses a missing or non-numeric application id without calling Discord; failures print status only", async () => {
    const m = await mod();
    const f = fakeFetch(() => ({ status: 401, json: { message: `bad token ${DISCORD_TOKEN}` } }));
    assert.equal((await m.registerDiscordCommands({ env: { DISCORD_BOT_TOKEN: DISCORD_TOKEN }, fetch: f.fn })).ok, false);
    assert.equal((await m.registerDiscordCommands({ env: { DISCORD_APPLICATION_ID: "Iv1.abc", DISCORD_BOT_TOKEN: DISCORD_TOKEN }, fetch: f.fn })).ok, false);
    assert.equal(f.calls.length, 0);
    const r = await m.registerDiscordCommands({ env: { DISCORD_APPLICATION_ID: APP_ID, DISCORD_BOT_TOKEN: DISCORD_TOKEN }, fetch: f.fn });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /HTTP 401/);
    assert.ok(!r.lines.join("").includes(DISCORD_TOKEN), "the response body is never printed");
  });
});

describe("Telegram command menu (scripts/connectors/telegram-set-commands.mjs, setMyCommands)", () => {
  it("payload: group chats get /handover, /status, /pause, /help; private chats get /help; all valid Telegram commands", async () => {
    const m = await mod();
    const reqs = m.telegramSetCommandsRequests();
    assert.deepEqual(reqs.map((r: { method: string; body: { scope: { type: string } } }) => [r.method, r.body.scope.type]), [["setMyCommands", "all_group_chats"], ["setMyCommands", "all_private_chats"]]);
    assert.deepEqual(reqs[0].body.commands.map((c: { command: string }) => c.command), ["handover", "status", "pause", "help"]);
    assert.deepEqual(reqs[1].body.commands.map((c: { command: string }) => c.command), ["help"]);
    for (const r of reqs) {
      for (const c of r.body.commands) {
        assert.match(c.command, /^[a-z0-9_]{1,32}$/, "Telegram: 1-32 lowercase letters, digits, underscores");
        assert.ok(c.description.length >= 1 && c.description.length <= 256);
        assert.doesNotMatch(c.description, /[–—]/);
        // every menu entry is a command the webhook handles
        assert.notEqual(ourCommandAction(`/${c.command}`, "BatonHandoverBot"), undefined, c.command);
      }
    }
  });

  it("calls setMyCommands once per scope with the token only in the URL path, and prints no token", async () => {
    const m = await mod();
    const f = fakeFetch(() => ({ status: 200, json: { ok: true, result: true } }));
    const r = await m.setTelegramCommands({ env: { TELEGRAM_BOT_TOKEN: TG_TOKEN }, fetch: f.fn });
    assert.equal(r.ok, true);
    assert.deepEqual(f.calls.map((c) => c.url), [`https://api.telegram.org/bot${TG_TOKEN}/setMyCommands`, `https://api.telegram.org/bot${TG_TOKEN}/setMyCommands`]);
    for (const c of f.calls) {
      assert.equal(c.init.method, "POST");
      assert.ok(!String(c.init.body).includes(TG_TOKEN));
    }
    assert.equal(r.lines.length, 2);
    assert.ok(!r.lines.join("").includes(TG_TOKEN));
  });

  it("a refusal stops with the HTTP status and Telegram's error code only; no token means no call", async () => {
    const m = await mod();
    const f = fakeFetch(() => ({ status: 401, json: { ok: false, error_code: 401, description: `Unauthorized ${TG_TOKEN}` } }));
    const r = await m.setTelegramCommands({ env: { TELEGRAM_BOT_TOKEN: TG_TOKEN }, fetch: f.fn });
    assert.equal(r.ok, false);
    assert.equal(f.calls.length, 1);
    assert.match(r.lines.join(""), /HTTP 401, code 401/);
    assert.ok(!r.lines.join("").includes(TG_TOKEN));
    const none = fakeFetch(() => ({ status: 200, json: { ok: true } }));
    assert.equal((await m.setTelegramCommands({ env: {}, fetch: none.fn })).ok, false);
    assert.equal(none.calls.length, 0);
  });

  it("importing the runnable scripts calls nothing (they only run when started directly)", async () => {
    const realFetch = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (async () => { called++; throw new Error("no network"); }) as typeof fetch;
    try {
      await import("../../../scripts/connectors/telegram-set-commands.mjs" as string);
      await import("../../../scripts/connectors/discord-register-commands.mjs" as string);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(called, 0);
  });
});
