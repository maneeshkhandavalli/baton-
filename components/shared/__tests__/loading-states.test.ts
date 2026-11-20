// Round 4 audit 1.18 (loading states, previously unverified): every signed-in and token page shows an accessible
// skeleton while its data loads, either through a route loading.tsx or a <Suspense fallback> around the data.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

describe("loading states", () => {
  const all = [...pages(path.join(ROOT, "app/(workspace)")), ...pages(path.join(ROOT, "app/(token)")), path.join(ROOT, "app/(marketing)/demo/workspace/page.tsx")];

  it("every page streams its data behind a skeleton (loading.tsx or Suspense fallback)", () => {
    assert.ok(all.length >= 15);
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      const hasLoading = existsSync(path.join(path.dirname(p), "loading.tsx"));
      const hasSuspense = /<Suspense fallback=\{<[A-Z]\w*/.test(src);
      // the dev-only /test page and the redirect-only connect page render no data list
      const exempt = /[\/](test|connect)[\/]page\.tsx$/.test(p);
      assert.ok(hasLoading || hasSuspense || exempt, `${path.relative(ROOT, p)} has a loading state`);
    }
  });

  it("the shared skeleton announces itself to screen readers", () => {
    const sk = readFileSync(path.join(ROOT, "components/shared/skeletons.tsx"), "utf8");
    assert.match(sk, /role="status" aria-live="polite"/);
    assert.match(sk, /<span className="sr-only">\{label\}<\/span>/);
  });

  it("every loading.tsx renders a skeleton component", () => {
    for (const p of all) {
      const l = path.join(path.dirname(p), "loading.tsx");
      if (!existsSync(l)) continue;
      assert.match(readFileSync(l, "utf8"), /Skeleton/, path.relative(ROOT, l));
    }
  });
});
