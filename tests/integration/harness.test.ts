// Self-tests of the integration harness: the scanner is not vacuous, the Recording* fakes behave like the
// boundaries they replace, and the platform stubs mint actors only through lib/db/actor's real code.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";

import { getVerifiedActor } from "../../lib/db/actor";
import { DbError, isDbError } from "../../lib/db/errors";
import { callRpc } from "../../lib/db/rpc";
import { requestClientIp } from "../../lib/supabase/request-ip";
import { captureConsole } from "./support/console-capture";
import { flushAfter, pendingAfter, resetPlatform, setRequestHeaders, signInAs, signOut, failAuth, authCalls } from "./support/platform";
import { RecordingDb } from "./support/recording-db";
import { RecordingStorage } from "./support/recording-storage";
import { recordProvider } from "./support/recording-provider";
import { ALL_LITERALS, PII_CHAT_LITERALS, PII_PATTERNS, PLANTED, assertNoLeaks, findLeaks } from "./support/sentinels";

const PII_CHAT = readFileSync(new URL("../../fixtures/parser/whatsapp/pii-chat.txt", import.meta.url), "utf8");
const ANN = "0b6a1c1e-1f00-4c3b-9d7a-000000000001";

beforeEach(() => resetPlatform());

describe("sentinel scanner", () => {
  it("finds every planted literal in the raw fixture", () => {
    const found = new Set(findLeaks(PII_CHAT, PII_CHAT_LITERALS).filter((l) => l.kind === "literal").map((l) => l.match));
    assert.deepEqual([...found].sort(), [...PII_CHAT_LITERALS].sort());
  });

  it("its generic patterns flag every raw PII line of the fixture without the literal list", () => {
    for (const line of PII_CHAT.split("\n").filter(Boolean)) {
      assert.ok(findLeaks(line, []).length > 0, `no pattern matched: ${line}`);
    }
    for (const value of Object.values(PLANTED)) assert.ok(findLeaks(value, []).length > 0, `no pattern matched planted ${value}`);
  });

  it("does not flag masked text, tokens, timestamps, uuids or hashes", () => {
    assertNoLeaks(
      {
        body: "Treasurer UPI is [UPI_1], call [PHONE_2], wifi password: [PASSWORD], key [API_KEY], [EXCLUDED_PARTICIPANT] said hi",
        sentAt: "2024-02-10T12:30:00.000Z",
        id: "0b6a1c1e-1f00-4c3b-9d7a-123456789012",
        identityHash: "1234567890123456789012345678901234567890123456789012345678901234",
        attempt: { outcome: "timed_out", httpStatus: 429, latencyMs: 1234 },
      },
      "masked sample",
    );
  });

  it("walks keys, arrays and bytes", () => {
    const leaks = findLeaks({ [PLANTED.email]: [1, { bytes: new TextEncoder().encode(PLANTED.phone) }] }, ALL_LITERALS);
    assert.ok(leaks.some((l) => l.path.endsWith("{key}")));
    assert.ok(leaks.some((l) => l.path.includes(".bytes")));
    assert.ok(PII_PATTERNS.length >= 10);
  });
});

describe("RecordingDb / RecordingStorage", () => {
  it("records calls in order and maps scripted SQLSTATEs through the real DbError mapping", async () => {
    const events: string[] = [];
    const db = new RecordingDb(events).returns("a", { ok: 1 }).fails("b", "BTNF0", "secret detail 99999 00004");
    assert.deepEqual(await callRpc(db, "a", { x: 1 }), { ok: 1 });
    await assert.rejects(callRpc(db, "b"), (e) => isDbError(e) && e.code === "not_found" && !e.message.includes("99999"));
    await assert.rejects(callRpc(db, "unplanned"), (e) => isDbError(e) && e.code === "internal");
    assert.deepEqual(db.fns(), ["a", "b", "unplanned"]);
    assert.deepEqual(db.unexpected, ["unplanned"]);
    assert.deepEqual(events, ["db:a", "db:b", "db:unplanned"]);
  });

  it("storage keeps objects, logs operations into the shared event list and can fail", async () => {
    const events: string[] = [];
    const storage = new RecordingStorage(events).put("b", "p", new Uint8Array([1, 2, 3]));
    const got = await storage.from("b").download("p");
    assert.equal(got.data?.size, 3);
    await storage.from("b").remove(["p"]);
    assert.equal(storage.has("b", "p"), false);
    storage.failOn("remove");
    assert.ok((await storage.from("b").remove(["q"])).error);
    assert.deepEqual(events, ["storage:download:p", "storage:remove:p", "storage:remove:q"]);
  });

  it("RecordingProvider keeps deep copies of requests", async () => {
    const inner = {
      id: "fake",
      displayName: "Test adapter",
      extract: async (req: { messages: string[] }) => ({ ok: true, data: req.messages.length }),
      verifySupport: async () => ({ ok: true, data: null }),
    };
    const p = recordProvider(inner);
    const req = { messages: ["a"] };
    await p.extract(req);
    req.messages.push("mutated later");
    assert.deepEqual(p.requests, [{ kind: "extract", request: { messages: ["a"] } }]);
    assert.equal(p.id, "fake");
  });
});

describe("platform stubs", () => {
  it("getVerifiedActor uses the (stubbed) Auth server and never getSession", async () => {
    assert.equal(await getVerifiedActor(), null, "signed out → null");
    signInAs(ANN.toUpperCase());
    const actor = await getVerifiedActor();
    assert.equal(actor?.profileId, ANN, "the profile id is the verified user id, lower-cased");
    assert.equal(actor?.emailConfirmed, true);
    assert.ok(Object.isFrozen(actor));
    failAuth();
    assert.equal(await getVerifiedActor(), null, "an auth error → null");
    signOut();
    assert.ok(authCalls().every((c) => c.name === "getUser"));
  });

  it("an id that is not a uuid never becomes an actor", async () => {
    signInAs("not-a-uuid-but-long-enough-for-the-stub");
    assert.equal(await getVerifiedActor(), null);
  });

  it("request headers and after() are controllable", async () => {
    setRequestHeaders({ "X-Forwarded-For": "203.0.113.7, 10.0.0.1" });
    assert.equal(await requestClientIp(), "203.0.113.7");
    const { after } = await import("next/server");
    let ran = 0;
    after(() => void ran++);
    assert.equal(pendingAfter(), 1);
    assert.equal(ran, 0, "after() never runs implicitly");
    assert.equal(await flushAfter(), 1);
    assert.equal(ran, 1);
  });

  it("console capture restores the console", async () => {
    const original = console.error;
    const { lines } = await captureConsole(() => console.error("x", 1));
    assert.deepEqual(lines, [["x", 1]]);
    assert.equal(console.error, original);
    assert.ok(new DbError("internal").message.length > 0);
  });
});
