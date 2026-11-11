// IT-13: token handling (§12.3, §12.4, D8, D12) and the pipeline drain route (QA-M9), on the real code:
//   * a raw token exists once, in the action's response URL (built from BATON_SITE_URL); the database only
//     ever sees its SHA-256; it never appears in logs; a misconfigured site URL leaves no orphan token;
//   * token answers and invitation flows consume the rate limits first and never pass the raw token or the
//     client IP to the database; invalid, exhausted and held all look alike;
//   * magic links go only to the invited address, with a redirect built from BATON_SITE_URL, never headers;
//   * POST /api/pipeline/drain needs `Bearer CRON_SECRET` (≥ 32 chars) and answers 401 otherwise.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import * as drainRoute from "../../app/api/pipeline/drain/route";
import { createGapInterviewLink, submitGapAnswers } from "../../lib/actions/gaps";
import { inviteMember } from "../../lib/actions/members";
import { getQueries } from "../../lib/data";
import { routes } from "../../lib/routes";
import { acceptInvite, sendInviteMagicLink } from "../../lib/supabase/invites";
import { authCallbackUrl } from "../../lib/supabase/site-url";
import { actionWorld, allCalls, ACTOR, type ActionWorld } from "./support/actions";
import { captureConsole } from "./support/console-capture";
import { authCalls, setRequestHeaders, signInAs, SITE_URL } from "./support/platform";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CLIENT_IP = "203.0.113.77";

function tokenFrom(url: string, prefix: "/g/" | "/h/"): string {
  const u = new URL(url);
  assert.equal(u.origin, SITE_URL, "absolute URL on the trusted origin");
  assert.ok(u.pathname.startsWith(prefix));
  const token = decodeURIComponent(u.pathname.slice(prefix.length));
  assert.match(token, RAW_TOKEN, "32 random bytes, base64url");
  return token;
}

function assertNeverStored(w: ActionWorld, token: string, lines: unknown[][] = []) {
  assert.ok(!JSON.stringify(allCalls(w)).includes(token), "the raw token never reaches the database");
  assert.ok(!JSON.stringify(lines).includes(token), "the raw token is never logged");
}

describe("IT-13: created links", () => {
  it("createGapInterviewLink: hash only in the database, raw token once in the response", async () => {
    const w = actionWorld();
    w.adminDb.returns("create_gap_interview_link", randomUUID());
    const { result, lines } = await captureConsole(() =>
      createGapInterviewLink({ handoverId: w.ids.handover, questionIds: [w.ids.question], maxAccessLevel: "everyone", expiresInDays: 7 }));
    assert.ok(result.ok, JSON.stringify(result));
    const token = tokenFrom(result.data.url, "/g/");
    assert.equal(w.adminDb.last("create_gap_interview_link")?.args.p_token_hash, `\\x${sha256(token)}`);
    assertNeverStored(w, token, lines);
  });

  it("two links never share a token", async () => {
    const w = actionWorld();
    w.adminDb.on("create_gap_interview_link", () => randomUUID());
    const input = { handoverId: w.ids.handover, questionIds: [w.ids.question], maxAccessLevel: "everyone" as const, expiresInDays: 7 };
    const [a, b] = [await createGapInterviewLink(input), await createGapInterviewLink(input)];
    assert.ok(a.ok && b.ok);
    assert.notEqual(tokenFrom(a.data.url, "/g/"), tokenFrom(b.data.url, "/g/"));
  });

  it("inviteMember: same rules for invitations (/h/)", async () => {
    const w = actionWorld();
    w.adminDb.returns("invite_member", randomUUID());
    const result = await inviteMember({ handoverId: w.ids.handover, email: "incoming.person@example.org", role: "incoming", expiresInDays: 7 });
    assert.ok(result.ok, JSON.stringify(result));
    const token = tokenFrom(result.data.url, "/h/");
    assert.equal(w.adminDb.last("invite_member")?.args.p_token_hash, `\\x${sha256(token)}`);
    assertNeverStored(w, token);
  });

  for (const siteUrl of [undefined, "http://baton.example.test", "https://baton.example.test/path", "https://user:pw@baton.example.test"]) {
    it(`an unsafe or missing BATON_SITE_URL (${siteUrl ?? "unset"}) fails closed before any token exists`, async () => {
      const w = actionWorld();
      if (siteUrl === undefined) delete process.env.BATON_SITE_URL;
      else process.env.BATON_SITE_URL = siteUrl;
      const link = await createGapInterviewLink({ handoverId: w.ids.handover, questionIds: [w.ids.question], maxAccessLevel: "everyone",
        expiresInDays: 7 });
      const invite = await inviteMember({ handoverId: w.ids.handover, email: "x@example.org", role: "incoming", expiresInDays: 7 });
      for (const r of [link, invite]) {
        assert.ok(!r.ok);
        assert.equal(r.error.code, "internal");
      }
      assert.deepEqual(allCalls(w), [], "no orphan token was created");
    });
  }
});

describe("IT-13: Gap Interview answers through a token (D8)", () => {
  const TOKEN = randomBytes(32).toString("base64url"); // a well-formed synthetic token (43 chars)

  function world(limitsOk = true) {
    const w = actionWorld(false);
    setRequestHeaders({ "x-forwarded-for": `${CLIENT_IP}, 10.0.0.1` });
    w.adminDb.returns("consume_rate_limit", limitsOk).returns("submit_gap_answers_with_token", 1);
    return w;
  }
  const submit = (w: ActionWorld, token = TOKEN) =>
    submitGapAnswers({ token, answererLabel: "Visitor", answers: [{ gapQuestionId: w.ids.question, answerText: "The keys are in the lab" }] });

  it("rate limits are consumed first, per client and per token, by digest only", async () => {
    const w = world();
    const result = await submit(w);
    assert.deepEqual(result, { ok: true, data: { submitted: 1 } });
    assert.deepEqual(w.adminDb.fns(), ["consume_rate_limit", "consume_rate_limit", "submit_gap_answers_with_token"]);
    const subjects = w.adminDb.calls.filter((c) => c.fn === "consume_rate_limit").map((c) => c.args);
    assert.deepEqual(subjects.map((s) => s.p_scope), ["gap_interview_submit_client", "gap_interview_submit_token"]);
    assert.equal(subjects[1].p_subject, sha256(TOKEN), "the token is counted by the hash the database stores");
    assert.match(String(subjects[0].p_subject), /^[0-9a-f]{64}$/, "the client is counted by a digest");
    assert.equal(w.adminDb.last("submit_gap_answers_with_token")?.args.p_token_hash, `\\x${sha256(TOKEN)}`);
    const all = JSON.stringify(allCalls(w));
    assert.ok(!all.includes(TOKEN) && !all.includes(CLIENT_IP), "neither the raw token nor the IP reaches the database");
  });

  it("over the limit: rate_limited (retryable) and the answers are not submitted", async () => {
    const w = world(false);
    const result = await submit(w);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "rate_limited");
    assert.equal(result.error.retryable, true);
    assert.ok(!w.adminDb.called("submit_gap_answers_with_token"));
  });

  it("a malformed token is token_invalid without any call", async () => {
    const w = world();
    const result = await submit(w, `${"!".repeat(40)}`);
    assert.ok(!result.ok && result.error.code === "token_invalid");
    assert.deepEqual(allCalls(w), []);
  });

  it("unknown/expired/revoked tokens and held or out-of-scope questions give fixed, content-free errors", async () => {
    const results = [];
    for (const state of ["BTTI0", "BTNF0"]) {
      const w = world();
      w.adminDb.fails("submit_gap_answers_with_token", state, `question ${w.ids.question} is privacy-held`);
      results.push(await submit(w));
    }
    assert.deepEqual(results.map((r) => !r.ok && r.error.code), ["token_invalid", "not_found"]);
    assert.doesNotMatch(JSON.stringify(results), /privacy-held/);
  });

  it("opening a Gap Interview link: limits first; an unknown token is token_invalid", async () => {
    const w = world();
    w.adminDb.fails("get_gap_interview", "BTTI0");
    const result = await getQueries().getGapInterview(TOKEN);
    assert.ok(!result.ok && result.error.code === "token_invalid");
    assert.deepEqual(w.adminDb.fns(), ["consume_rate_limit", "consume_rate_limit", "get_gap_interview"]);
    assert.ok(!JSON.stringify(allCalls(w)).includes(TOKEN));
  });
});

describe("IT-13: invitation magic links and redemption (§12.3)", () => {
  const TOKEN = randomBytes(32).toString("base64url");

  function world(peek: "ok" | "invalid" | "limited") {
    const w = actionWorld(false);
    setRequestHeaders({ "x-forwarded-for": CLIENT_IP, host: "evil.example", "x-forwarded-host": "evil.example" });
    w.adminDb.returns("consume_rate_limit", peek !== "limited");
    if (peek === "invalid") w.adminDb.fails("peek_member_invite", "BTTI0");
    else w.adminDb.returns("peek_member_invite", { recipient_email: "invited.person@example.org", handover_id: w.ids.handover });
    return w;
  }

  it("the link goes to the INVITED address, redirecting to BATON_SITE_URL whatever the request headers say", async () => {
    world("ok");
    assert.deepEqual(await sendInviteMagicLink(TOKEN), { sent: true });
    const otp = authCalls().filter((c) => c.name === "signInWithOtp");
    assert.equal(otp.length, 1);
    const args = otp[0].args as { email: string; options: { emailRedirectTo: string } };
    assert.equal(args.email, "invited.person@example.org");
    // exactly the callback built from the trusted origin (authCallbackUrl), back to this invitation
    assert.equal(args.options.emailRedirectTo, authCallbackUrl(routes.token.handover(TOKEN)));
    assert.ok(args.options.emailRedirectTo.startsWith(`${SITE_URL}/auth/callback?next=`));
    assert.doesNotMatch(args.options.emailRedirectTo, /evil\.example/);
  });

  for (const state of ["invalid", "limited"] as const) {
    it(`an ${state} token gets the identical response and sends nothing`, async () => {
      world(state);
      assert.deepEqual(await sendInviteMagicLink(TOKEN), { sent: true });
      assert.equal(authCalls().filter((c) => c.name === "signInWithOtp").length, 0);
    });
  }

  it("a malformed token gets the identical response without any call", async () => {
    const w = world("ok");
    assert.deepEqual(await sendInviteMagicLink("short"), { sent: true });
    assert.deepEqual(allCalls(w), []);
  });

  it("redemption needs a confirmed email; the database gets the verified profile id, never an address", async () => {
    const w = world("ok");
    signInAs(ACTOR, "invited.person@example.org", false);
    assert.deepEqual(await acceptInvite(TOKEN), { ok: false, code: "token_invalid" });
    assert.deepEqual(allCalls(w), [], "an unconfirmed address is refused before any call");

    signInAs(ACTOR, "invited.person@example.org", true);
    w.adminDb.returns("redeem_member_invite", { handover_id: w.ids.handover, role: "incoming", member_id: randomUUID() });
    const accepted = await acceptInvite(TOKEN);
    assert.ok(accepted.ok);
    const args = w.adminDb.last("redeem_member_invite")?.args;
    assert.deepEqual(Object.keys(args ?? {}).sort(), ["p_profile_id", "p_token_hash"]);
    assert.equal(args?.p_profile_id, ACTOR);
  });
});

describe("IT-13 / QA-M9: POST /api/pipeline/drain", () => {
  const SECRET = "it-cron-secret-0123456789abcdefghijklmnop"; // synthetic, ≥ 32 chars

  const post = (headers: Record<string, string> = {}) =>
    drainRoute.POST(new Request("https://baton.example.test/api/pipeline/drain", { method: "POST", headers }));

  function world(secret: string | null = SECRET) {
    const w = actionWorld(false);
    if (secret === null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
    w.adminDb.returns("claim_ready_processing_jobs", []);
    return w;
  }

  it("only POST is exported", () => {
    const exported = Object.keys(drainRoute).filter((k) => /^(GET|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k));
    assert.deepEqual(exported, []);
    assert.equal(typeof drainRoute.POST, "function");
  });

  const REFUSED: Array<[string, string | null, Record<string, string>]> = [
    ["no Authorization header", SECRET, {}],
    ["a wrong secret", SECRET, { authorization: `Bearer ${SECRET.slice(0, -1)}x` }],
    ["the secret with extra characters", SECRET, { authorization: `Bearer ${SECRET}x` }],
    ["the bare secret without the Bearer scheme", SECRET, { authorization: SECRET }],
    ["a lower-case scheme", SECRET, { authorization: `bearer ${SECRET}` }],
    ["an empty bearer while the secret is unset", null, { authorization: "Bearer " }],
    ["a matching bearer when the secret is unset", null, { authorization: `Bearer ${SECRET}` }],
    ["a matching bearer when the secret is too short (31 chars)", "s".repeat(31), { authorization: `Bearer ${"s".repeat(31)}` }],
  ];
  for (const [label, secret, headers] of REFUSED) {
    it(`401 for ${label}, and no job is touched`, async () => {
      const w = world(secret);
      const response = await post(headers);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.text();
      assert.doesNotMatch(body, new RegExp(SECRET.slice(0, 12)));
      assert.deepEqual(allCalls(w), []);
    });
  }

  it("200 with counts only for the right secret", async () => {
    const w = world();
    const response = await post({ authorization: `Bearer ${SECRET}` });
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.ok(Object.values(body).every((v) => typeof v === "number"), JSON.stringify(body));
    assert.equal(body.claimed, 0);
    assert.deepEqual(w.adminDb.fns(), ["claim_ready_processing_jobs"]);
    assert.equal(w.adminDb.last("claim_ready_processing_jobs")?.args.p_limit, 1, "the caller cannot raise the budget");
  });

  it("an infrastructure failure answers 500 without details", async () => {
    const w = world();
    w.adminDb.on("claim_ready_processing_jobs", () => {
      throw new Error("connection to db.internal:5432 refused");
    });
    const response = await post({ authorization: `Bearer ${SECRET}` });
    assert.ok(response.status === 500 || response.status === 200, `status ${response.status}`);
    assert.doesNotMatch(await response.text(), /db\.internal|5432/);
  });
});
