// Main (integration finding): with cacheComponents, a GET route handler that never touches a request-time API is
// PRERENDERED at build time. Install and callback routes read the query string and the session, so each must call
// `await connection()` first. This guards every connector GET route.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = new URL("../../../app/api/connectors/", import.meta.url);

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? routes(p) : n === "route.ts" ? [p] : [];
  });
}

describe("connector GET routes run at request time", () => {
  const files = routes(ROOT.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  it("finds the install and callback routes", () => assert.ok(files.filter((f) => /install|callback/.test(f)).length >= 7));
  for (const f of files.filter((f) => /[\/](install|callback)[\/]route\.ts$/.test(f))) {
    it(f.split(/[\/]api[\/]/)[1], () => {
      const src = readFileSync(f, "utf8");
      assert.match(src, /export async function GET\([^)]*\)[^{]*\{\s*\n\s*await connection\(\);/);
    });
  }
});
