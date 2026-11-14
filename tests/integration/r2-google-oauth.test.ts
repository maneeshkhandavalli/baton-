// Round 2: Google sign-in (Supabase OAuth, PKCE) through the real Server Functions and the real callback route,
// with the @supabase/ssr stub recording auth calls (nothing is sent). Proves: the redirect is built only from
// BATON_SITE_URL (localhost / Preview / Production each come back to their own origin), `next` is sanitised,
// the authorize URL must be our own Supabase project, failures and cancellations are handled with fixed
// messages, and invitations come back to their own page.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { startGoogleSignIn } from "../../app/(auth)/login/actions";
import { startGoogleInviteSignIn } from "../../app/(token)/h/[token]/actions";
import * as callback from "../../app/auth/callback/route";
import { canonicalRestartUrl, isOwnAuthorizeUrl, oauthErrorToken, SIGN_IN_ERROR_MESSAGES } from "../../lib/supabase/oauth-core";
import { captureConsole } from "./support/console-capture";
import { authCalls, resetPlatform, setExchangeError, setOAuthResult, setRequestHeaders, SITE_URL } from "./support/platform";

const TOKEN = "A".repeat(43); // well-formed (43 base64url characters); never redeemed here

type OAuthArgs = { provider: string; options: { redirectTo: string; skipBrowserRedirect: boolean; queryParams?: Record<string, string> } };
const oauthCalls = () => authCalls().filter((c) => c.name === "signInWithOAuth").map((c) => c.args as OAuthArgs);

describe("Google sign-in: starting", () => {
  beforeEach(() => resetPlatform());

  it("asks Supabase for Google with a redirect built only from BATON_SITE_URL, and returns its authorize URL", async () => {
    const r = await startGoogleSignIn("/handover/new?step=2");
    assert.equal(r.status, "redirect");
    assert.ok(r.status === "redirect" && isOwnAuthorizeUrl(r.url, process.env.NEXT_PUBLIC_SUPABASE_URL!));
    const [call] = oauthCalls();
    assert.equal(call.provider, "google");
    assert.equal(call.options.skipBrowserRedirect, true, "the browser navigates; the server never follows the URL");
    const back = new URL(call.options.redirectTo);
    assert.equal(back.origin, SITE_URL);
    assert.equal(back.pathname, "/auth/callback");
    assert.equal(back.searchParams.get("next"), "/handover/new?step=2");
    assert.equal(call.options.queryParams?.prompt, "select_account");
  });

  it("each environment comes back to its own origin (localhost, Preview, Production)", async () => {
    for (const site of ["http://localhost:3000", "https://baton-git-round2-preview.vercel.app", "https://baton.example.com"]) {
      resetPlatform();
      process.env.BATON_SITE_URL = site;
      await startGoogleSignIn(null);
      assert.equal(new URL(oauthCalls()[0].options.redirectTo).origin, site);
      assert.equal(new URL(oauthCalls()[0].options.redirectTo).searchParams.get("next"), null);
    }
  });

  it("an unsafe `next` is dropped (open-redirect guard)", async () => {
    for (const next of ["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      resetPlatform();
      await startGoogleSignIn(next);
      assert.equal(new URL(oauthCalls()[0].options.redirectTo).searchParams.get("next"), null, next);
    }
  });

  it("refuses to send the visitor to an authorize URL that is not our own Supabase project", async () => {
    setOAuthResult({ url: "https://evil.example/auth/v1/authorize?provider=google" });
    const { result: r } = await captureConsole(() => startGoogleSignIn(null));
    assert.equal(r.status, "error");
  });

  it("a provider error gives a fixed message (no provider text) and no redirect", async () => {
    setOAuthResult({ error: { message: "Unsupported provider: provider is not enabled SECRET-DETAIL", status: 400, code: "validation_failed" } });
    const { result: r } = await captureConsole(() => startGoogleSignIn(null));
    assert.equal(r.status, "error");
    assert.ok(r.status === "error" && !r.message.includes("SECRET-DETAIL") && !r.message.includes("provider is not enabled"));
  });

  it("a missing or unsafe BATON_SITE_URL fails closed before calling Supabase", async () => {
    for (const site of [undefined, "http://baton.example.com", "https://baton.example.com/path"]) {
      resetPlatform();
      if (site === undefined) delete process.env.BATON_SITE_URL;
      else process.env.BATON_SITE_URL = site;
      const { result: r } = await captureConsole(() => startGoogleSignIn(null));
      assert.equal(r.status, "error", String(site));
      assert.equal(oauthCalls().length, 0);
    }
  });

  it("an invitation signs in with Google and comes back to that invitation; a malformed token never reaches Supabase", async () => {
    const r = await startGoogleInviteSignIn(TOKEN);
    assert.equal(r.status, "redirect");
    assert.equal(new URL(oauthCalls()[0].options.redirectTo).searchParams.get("next"), `/h/${TOKEN}`);
    resetPlatform();
    const bad = await startGoogleInviteSignIn("not-a-token");
    assert.equal(bad.status, "error");
    assert.equal(oauthCalls().length, 0);
  });
});

describe("Google sign-in: the callback", () => {
  beforeEach(() => resetPlatform());
  // The route reads only `nextUrl` and `url` from the NextRequest.
  const get = (qs: string) => {
    const url = `${SITE_URL}/auth/callback?${qs}`;
    return callback.GET(Object.assign(new Request(url), { nextUrl: new URL(url) }) as never);
  };

  it("cancelling at Google returns to the login page with a clear message, keeping `next`", async () => {
    const res = await get("error=access_denied&error_code=access_denied&error_description=The+user+denied&next=%2Fhandover%2Fnew");
    const to = new URL(res.headers.get("location")!);
    assert.equal(to.pathname, "/login");
    assert.equal(to.searchParams.get("error"), "oauth_cancelled");
    assert.equal(to.searchParams.get("next"), "/handover/new");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.equal(authCalls().filter((c) => c.name === "exchangeCodeForSession").length, 0);
  });

  it("any other provider error returns oauth_failed (provider text is never forwarded)", async () => {
    const res = await get("error=server_error&error_description=Internal+details");
    const to = new URL(res.headers.get("location")!);
    assert.equal(to.searchParams.get("error"), "oauth_failed");
    assert.ok(!to.toString().includes("Internal"));
  });

  it("a code is exchanged through the existing PKCE path and lands on `next`", async () => {
    const res = await get("code=abc123&next=%2Fdashboard");
    assert.equal(new URL(res.headers.get("location")!).pathname, "/dashboard");
    assert.deepEqual(authCalls().filter((c) => c.name === "exchangeCodeForSession").map((c) => c.args), [{ code: "abc123" }]);
  });

  it("every error token the callback can produce has a message on the login page", () => {
    for (const t of ["oauth_cancelled", "oauth_failed", "auth_callback_failed"]) assert.ok(SIGN_IN_ERROR_MESSAGES[t], t);
    assert.equal(oauthErrorToken("access_denied"), "oauth_cancelled");
    assert.equal(oauthErrorToken("temporarily_unavailable"), "oauth_failed");
    assert.equal(oauthErrorToken(null), null);
  });

  it("authorize-URL check: same project origin and path only; https required except local Supabase", () => {
    const project = "https://xyz.supabase.co";
    assert.equal(isOwnAuthorizeUrl("https://xyz.supabase.co/auth/v1/authorize?provider=google", project), true);
    assert.equal(isOwnAuthorizeUrl("https://xyz.supabase.co.evil.io/auth/v1/authorize", project), false);
    assert.equal(isOwnAuthorizeUrl("https://xyz.supabase.co/rest/v1/anything", project), false);
    assert.equal(isOwnAuthorizeUrl("http://xyz.supabase.co/auth/v1/authorize", "http://xyz.supabase.co"), false);
    assert.equal(isOwnAuthorizeUrl("http://127.0.0.1:54321/auth/v1/authorize", "http://127.0.0.1:54321"), true);
    assert.equal(isOwnAuthorizeUrl("not a url", project), false);
  });
});

describe("Google sign-in: same host as the callback", () => {
  beforeEach(() => resetPlatform());

  it("the server never reads the Host header: a forged host changes nothing", async () => {
    setRequestHeaders({ host: "evil.example", "x-forwarded-host": "evil.example" });
    const r = await startGoogleSignIn("/dashboard");
    assert.ok(r.status === "redirect" && isOwnAuthorizeUrl(r.url, process.env.NEXT_PUBLIC_SUPABASE_URL!));
    assert.equal(new URL(oauthCalls()[0].options.redirectTo).origin, SITE_URL);
  });

  it("on another host the browser first moves to the same page on the site origin (canonicalRestartUrl)", () => {
    const u = new URL(canonicalRestartUrl("baton-abc123.vercel.app", SITE_URL, "/login?next=%2Fdashboard")!);
    assert.equal(u.origin, SITE_URL);
    assert.equal(u.pathname, "/login");
    assert.equal(u.searchParams.get("next"), "/dashboard");
    assert.equal(u.searchParams.get("continue"), "google");
    const inv = new URL(canonicalRestartUrl("127.0.0.1:3000", SITE_URL, `/h/${TOKEN}`)!);
    assert.equal(inv.origin + inv.pathname, `${SITE_URL}/h/${TOKEN}`);
  });

  it("canonicalRestartUrl only compares hosts and always builds from the trusted origin", () => {
    assert.equal(canonicalRestartUrl(null, SITE_URL, "/login"), null);
    assert.equal(canonicalRestartUrl(new URL(SITE_URL).host.toUpperCase(), SITE_URL, "/login"), null);
    assert.equal(canonicalRestartUrl("evil.example", "not a url", "/login"), null);
    for (const path of ["//evil.example/x", "https://evil.example/x"]) {
      assert.equal(new URL(canonicalRestartUrl("other.example", SITE_URL, path)!).origin, SITE_URL, path);
    }
  });

  it("a missing PKCE verifier sends the visitor back to start again, with a specific message and no secrets logged", async () => {
    setExchangeError({ message: "PKCE code verifier not found in storage", status: 400, code: "pkce_code_verifier_not_found" });
    const url = `${SITE_URL}/auth/callback?code=secret-code-value&next=%2Fdashboard`;
    const req = Object.assign(new Request(url), { nextUrl: new URL(url), cookies: { getAll: () => [] } });
    const { result: res, lines } = await captureConsole(() => callback.GET(req as never));
    const loc = new URL(res.headers.get("location")!);
    assert.equal(loc.pathname, "/login");
    assert.equal(loc.searchParams.get("error"), "auth_restart");
    assert.equal(loc.searchParams.get("next"), "/dashboard");
    assert.match(SIGN_IN_ERROR_MESSAGES.auth_restart, /same browser/);
    assert.ok(!JSON.stringify(lines).includes("secret-code-value"), "the authorization code is never logged");
  });
});
