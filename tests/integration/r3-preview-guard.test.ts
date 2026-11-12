// Round 3 QA (Agent 5): the dev-only design previews (app/(preview)/**, Agent 1 b5464f5 + 95423e9) must never
// be served outside `next dev`. components/shared/__tests__/preview-guard.test.ts checks the guard's TEXT,
// noindex and DIRECT imports. This file checks what that test cannot:
//   1. only page.tsx / layout.tsx live in the group (a route.ts would bypass the layout and is not scanned);
//   2. the guard's BEHAVIOUR: every page and the layout throw notFound() under NODE_ENV production / test /
//      unset, and render under development (Next inlines NODE_ENV at build time, so this is the shipped check);
//   3. the TRANSITIVE import graph never reaches the live data facade, the DB layer or server Supabase;
//      server actions are reachable only through "use client" modules (action references; previews pass
//      preview/disabled flags and never call them).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREVIEW = path.join(ROOT, "app", "(preview)");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

const FILES = listFiles(PREVIEW);
const ROUTE_FILES = FILES.filter((f) => /[\\/](page|layout)\.tsx$/.test(f));

function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Value imports only (`import type` is erased). Returns every reachable file with the chain that reaches it. */
function importGraph(start: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const stack: Array<[string, string[]]> = [[start, []]];
  while (stack.length) {
    const [file, chain] = stack.pop()!;
    if (seen.has(file)) continue;
    seen.set(file, chain);
    const src = readFileSync(file, "utf8");
    // A "use server" module is a boundary: what it imports runs only inside the action, never in the page.
    if (/^\s*["']use server["']/.test(src)) continue;
    for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"|^\s*import\s+"([^"]+)"/gm)) {
      if (m[2]) continue;
      const target = resolveImport(m[3] ?? m[4], file);
      if (target) stack.push([target, [...chain, file]]);
    }
  }
  return seen;
}

const isClient = (f: string) => /^\s*["']use client["']/.test(readFileSync(f, "utf8"));

describe("QA: dev-only preview routes stay dev-only", () => {
  it("app/(preview) contains only page.tsx and layout.tsx files (no route handlers, templates or metadata routes)", () => {
    const others = FILES.filter((f) => !ROUTE_FILES.includes(f)).map(rel);
    assert.deepEqual(others, []);
    assert.ok(ROUTE_FILES.length >= 7, `found ${ROUTE_FILES.length} route files`);
  });

  // process.env.NODE_ENV is typed read-only (Next's types); tests switch it through a plain record.
  const env = process.env as Record<string, string | undefined>;
  const savedEnv = env.NODE_ENV;
  after(() => {
    if (savedEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = savedEnv;
  });

  const props = { searchParams: Promise.resolve({}), params: Promise.resolve({}), children: null };

  for (const file of ROUTE_FILES) {
    it(`${rel(file)}: notFound() outside development, renders in development`, async () => {
      const mod = (await import(pathToFileURL(file).href)) as { default: (p: unknown) => unknown };
      for (const value of ["production", "test", undefined]) {
        if (value === undefined) delete env.NODE_ENV;
        else env.NODE_ENV = value;
        assert.throws(() => mod.default(props), /notFound/, `NODE_ENV=${value ?? "(unset)"} must 404`);
      }
      env.NODE_ENV = "development";
      assert.ok(mod.default(props), "renders an element in development");
    });
  }

  for (const file of ROUTE_FILES) {
    it(`${rel(file)}: never reaches lib/data, lib/db or server Supabase; actions only via "use client" modules`, () => {
      const graph = importGraph(file);
      const forbidden = [...graph.keys()].map(rel).filter((f) => /^lib\/(data|db)\/|^lib\/supabase\/(server|admin|middleware)/.test(f));
      assert.deepEqual(forbidden, [], "the preview graph reaches live data");
      for (const [target, chain] of graph) {
        if (!rel(target).startsWith("lib/actions/")) continue;
        // The importer of a "use server" module must be a client module (an action reference, not a server call).
        const importer = chain[chain.length - 1];
        if (rel(importer).startsWith("lib/actions/")) continue;
        assert.ok(isClient(importer), `${rel(importer)} (server) imports ${rel(target)}: chain ${chain.map(rel).join(" → ")}`);
      }
    });
  }
});
