// R3 Task 02 (PRIV-4): dispatch purpose binding, session cookie options and the Content Security Policy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { contentSecurityPolicy, securityHeaders } from "../../security/headers";
import { sessionCookieOptions } from "../../supabase/cookie-options";
import { authenticateWorkerRequest, signDispatch } from "../worker-auth";

const SECRET = "synthetic-cron-secret-0123456789-abcdef";

describe("signed dispatch purpose (drain vs retention)", () => {
  const now = 1_700_000_000_000;
  const at = Math.floor(now / 1000);
  const header = (purpose: "drain" | "retention") => new Headers({ "x-baton-dispatch": `v1.${at}.7.${signDispatch(SECRET, at, 7, purpose)}` });

  it("the drain signature is unchanged (Task 01B golden vector) and purposes differ", () => {
    assert.equal(
      signDispatch("golden-signing-key-0123456789abcdefghijkl", 1700000000, 42),
      "cad025ed6baec0a3cad64bdb7cda827e45f8b690811d29e6a4e51ea0afd92b0f",
    );
    assert.notEqual(signDispatch(SECRET, at, 7, "retention"), signDispatch(SECRET, at, 7));
  });

  it("each endpoint accepts only its own purpose", () => {
    assert.equal(authenticateWorkerRequest(header("drain"), SECRET, now).ok, true);
    assert.equal(authenticateWorkerRequest(header("retention"), SECRET, now, "retention").ok, true);
    assert.deepEqual(authenticateWorkerRequest(header("drain"), SECRET, now, "retention"), { ok: false, reason: "bad_dispatch" });
    assert.deepEqual(authenticateWorkerRequest(header("retention"), SECRET, now), { ok: false, reason: "bad_dispatch" });
  });
});

describe("session cookies", () => {
  it("are httpOnly and SameSite=Lax everywhere, Secure in production", () => {
    assert.deepEqual(sessionCookieOptions({ NODE_ENV: "production" }), { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
    assert.equal(sessionCookieOptions({ NODE_ENV: "development" }).httpOnly, true);
    assert.equal(sessionCookieOptions({ NODE_ENV: "development" }).secure, false);
  });

  it("both server clients pass them, and no browser code creates a session client", () => {
    for (const f of ["lib/supabase/server.ts", "lib/supabase/proxy.ts"]) {
      assert.match(readFileSync(f, "utf8"), /cookieOptions: sessionCookieOptions\(\)/, f);
    }
    const client = readFileSync("lib/supabase/client.ts", "utf8");
    assert.doesNotMatch(client, /createBrowserClient/);
    assert.match(client, /persistSession: false/);
    assert.doesNotMatch(readFileSync("components/wizard/new-handover-wizard.tsx", "utf8"), /createSupabaseBrowserClient/);
  });
});

describe("Content Security Policy", () => {
  const prod = contentSecurityPolicy({ supabaseUrl: "https://abc.supabase.co/rest/v1", dev: false });
  const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("allows only this origin and the Supabase project; blocks framing, plugins and base hijacking", () => {
    assert.equal(directive(prod, "default-src"), "default-src 'self'");
    assert.equal(directive(prod, "connect-src"), "connect-src 'self' https://abc.supabase.co");
    assert.equal(directive(prod, "frame-ancestors"), "frame-ancestors 'none'");
    assert.equal(directive(prod, "object-src"), "object-src 'none'");
    assert.equal(directive(prod, "base-uri"), "base-uri 'self'");
    assert.equal(directive(prod, "form-action"), "form-action 'self'");
    assert.ok(prod.includes("upgrade-insecure-requests"));
    assert.doesNotMatch(prod, /unsafe-eval|ws:|https:\/\/\*|\*\s/);
  });

  it("development adds only what hot reload needs; a bad Supabase URL is never allowed", () => {
    const dev = contentSecurityPolicy({ supabaseUrl: "http://evil.example", dev: true });
    assert.match(directive(dev, "script-src"), /'unsafe-eval'/);
    assert.equal(directive(dev, "connect-src"), "connect-src 'self' ws: wss:");
    assert.equal(directive(contentSecurityPolicy({ dev: false }), "connect-src"), "connect-src 'self'");
  });

  it("is sent with nosniff, frame and permissions headers", () => {
    const keys = securityHeaders({ dev: false }).map((h) => h.key);
    assert.deepEqual(keys, ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Permissions-Policy"]);
    assert.match(readFileSync("next.config.ts", "utf8"), /securityHeaders\(/);
  });
});
