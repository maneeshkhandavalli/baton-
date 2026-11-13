// The dev-only design previews (app/(preview)/**) must 404 outside development and stay out of
// search indexes. Static check: every page and layout starts its default export with the guard,
// exports robots noindex metadata, and never imports server actions, Supabase or the live data facade.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const previewDir = path.join(root, "app", "(preview)");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /(page|layout)\.tsx$/.test(name) ? [p] : [];
  });
}

const GUARD = 'if (process.env.NODE_ENV !== "development") notFound();';

describe("dev-only preview routes", () => {
  const all = files(previewDir);

  it("exist (layout, index and the five previews)", () => {
    assert.ok(all.length >= 7, `found ${all.length}`);
  });

  for (const file of all) {
    const rel = path.relative(root, file);
    const src = readFileSync(file, "utf8");

    it(`${rel}: the default export's first statement is the NODE_ENV guard`, () => {
      const m = /export default (?:async )?function \w+\([^)]*\)[^{]*\{\s*([^\n]+)/.exec(src);
      assert.ok(m, "default export function not found");
      assert.equal(m[1].trim(), GUARD);
    });

    it(`${rel}: robots noindex`, () => {
      assert.match(src, /robots:\s*\{\s*index:\s*false/);
    });

    it(`${rel}: a title only in development (a production 404 must not name the preview)`, () => {
      const meta = /export const metadata: Metadata = (.*);/.exec(src)?.[1] ?? "";
      assert.ok(meta, "metadata export not found");
      const unconditional = meta.replace(/\.\.\.\(process\.env\.NODE_ENV === "development" \? \{ title: "[^"]*" \} : \{\}\)/, "");
      assert.doesNotMatch(unconditional, /title/, "unconditional metadata title");
    });

    it(`${rel}: no server actions, Supabase or live queries`, () => {
      assert.doesNotMatch(src, /@\/lib\/actions|@\/lib\/supabase|@\/lib\/data["/]/);
    });
  }
});
