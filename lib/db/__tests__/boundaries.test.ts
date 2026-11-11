// Source-boundary checks for rules that in-process TypeScript cannot enforce on its own (N1, N5, M1, H1).
// These run with the unit tests and fail the build if the codebase drifts.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SKIP_ANYWHERE = new Set(["node_modules", ".next", ".git"]);
const SKIP_AT_ROOT = new Set(["supabase", "docs", "public", "graphify-out"]);

function sourceFiles(dir = ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_ANYWHERE.has(name) || (dir === ROOT && SKIP_AT_ROOT.has(name))) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const files = sourceFiles().map((f) => ({ path: relative(ROOT, f).split(sep).join("/"), text: readFileSync(f, "utf8") }));
const isTest = (p: string) => p.includes("/__tests__/");

function offenders(pattern: RegExp, allowed: (path: string) => boolean): string[] {
  return files.filter((f) => !isTest(f.path) && !allowed(f.path) && pattern.test(f.text)).map((f) => f.path);
}

describe("source boundaries", () => {
  it("scans the application source", () => {
    assert.ok(files.some((f) => f.path === "lib/db/recovery-gate.ts"));
    assert.ok(files.some((f) => f.path === "proxy.ts"));
  });

  it("N5: only lib/recovery may register the manifest receipt verifier", () => {
    assert.deepEqual(
      offenders(/registerManifestReceiptVerifier/, (p) => p === "lib/db/recovery-gate.ts" || p.startsWith("lib/recovery/")),
      [],
    );
  });

  it("N5: production code has no way to reset or replace the verifier", () => {
    const gate = files.find((f) => f.path === "lib/db/recovery-gate.ts")!.text;
    assert.doesNotMatch(gate, /export function __reset|verifier\s*=\s*null\s*;?\s*\n\s*}/);
    assert.equal((gate.match(/verifier = fn/g) ?? []).length, 1);
  });

  it("N1: VerifiedActor values are minted only in lib/db/actor.ts", () => {
    assert.deepEqual(offenders(/as\s+(?:unknown\s+as\s+)?VerifiedActor\b/, (p) => p === "lib/db/actor.ts"), []);
  });

  it("N1: lib/db/actor.ts is server-only and exports no constructor that accepts a user object", () => {
    const actor = files.find((f) => f.path === "lib/db/actor.ts")!.text;
    assert.match(actor, /^import "server-only";/);
    assert.match(actor, /auth\.getUser\(\)/);
    assert.doesNotMatch(actor, /export function \w+\(\s*user/);
    assert.doesNotMatch(actor, /auth\.getSession\(/);
  });

  it("M1: redirect destinations are never built from request headers", () => {
    // any read of the Host / X-Forwarded-Host request headers
    assert.deepEqual(offenders(/\.get\(\s*["'](?:x-forwarded-host|host)["']\s*\)/i, () => false), []);
    for (const f of files.filter((x) => !isTest(x.path) && /emailRedirectTo/.test(x.text))) {
      assert.match(f.text, /authCallbackUrl/, `${f.path} must build emailRedirectTo with authCallbackUrl`);
    }
  });

  it("H1: the service-role key is read only by lib/supabase/admin.ts", () => {
    assert.deepEqual(
      offenders(/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/, (p) => p === "lib/supabase/admin.ts"),
      [],
    );
    const admin = files.find((f) => f.path === "lib/supabase/admin.ts")!.text;
    assert.match(admin, /^import "server-only";/);
  });
});
