// R3 Task 06 (D1): the demo can never reach a backend. Static checks over the source text of lib/demo/** and every
// module it imports, and of the demo pages (read-only scan; this test never edits UI files).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const FORBIDDEN_MODULES = [
  /^@\/lib\/supabase/, /^@\/lib\/db/, /^@\/lib\/actions/, /^@\/lib\/ai/, /^@\/lib\/pipeline/, /^@\/lib\/email/, /^@\/lib\/data/,
  /^@\/lib\/mocks\/store$/, /^@\/lib\/mocks\/actions$/, /^@\/lib\/mocks\/queries$/, /^@\/lib\/parsers/, /^@\/lib\/privacy/,
  /^server-only$/, /^next\//, /^@supabase\//, /^node:/,
];
const FORBIDDEN_TEXT = [/\bfetch\s*\(/, /XMLHttpRequest/, /process\.env/, /WebSocket/, /navigator\.sendBeacon/, /globalThis\./, /localStorage|sessionStorage/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" ? [] : files(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

const importsOf = (text: string) => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/g)].map((m) => m[1]);

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) if (existsSync(c)) return c;
  return null;
}

/** Every local module the engine reaches, transitively, with the import that brought it in. */
function closure(entry: string) {
  const seen = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    const specs = importsOf(readFileSync(f, "utf8"));
    seen.set(f, specs);
    for (const s of specs) {
      const r = resolveImport(f, s);
      if (r) queue.push(r);
    }
  }
  return seen;
}

const toAlias = (f: string, spec: string) => {
  if (!spec.startsWith(".")) return spec;
  return `@/${relative(ROOT, resolve(dirname(f), spec)).replace(/\\/g, "/")}`;
};

describe("demo boundaries (D1)", () => {
  const engine = join(ROOT, "lib/demo/engine/index.ts");
  const reach = closure(engine);

  it("the engine and everything it imports reach no backend, network, environment or global store", () => {
    const problems: string[] = [];
    for (const [f, specs] of reach) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      for (const s of specs) {
        const alias = toAlias(f, s).replace(/\/index$/, "");
        if (FORBIDDEN_MODULES.some((re) => re.test(alias))) problems.push(`${rel} imports ${s}`);
      }
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      for (const re of FORBIDDEN_TEXT) if (re.test(text)) problems.push(`${rel} uses ${re}`);
    }
    assert.deepEqual(problems, []);
    assert.ok([...reach.keys()].some((f) => f.endsWith(join("mocks", "store-queries.ts"))), "sanity: the closure was walked");
  });

  it("lib/demo/** has no Server Function, client directive or server-only module", () => {
    for (const f of files(join(ROOT, "lib/demo"))) {
      const text = readFileSync(f, "utf8");
      assert.doesNotMatch(text, /^"use (server|client)"/m, f);
    }
  });

  it("the demo pages never import Server Functions, Supabase or the database (read-only scan of UI files)", () => {
    const pages = ["app/(marketing)/demo"].map((d) => join(ROOT, d)).filter(existsSync).flatMap(files);
    for (const f of pages) {
      for (const s of importsOf(readFileSync(f, "utf8"))) {
        assert.doesNotMatch(s, /^@\/lib\/(actions|supabase|db|email|ai|pipeline)/, `${relative(ROOT, f)} imports ${s}`);
      }
    }
  });

  it("proxy.ts lets /demo skip the session refresh", () => {
    const proxy = readFileSync(join(ROOT, "proxy.ts"), "utf8");
    assert.match(proxy, /DEMO_PREFIX = "\/demo"/);
    const demoLine = proxy.indexOf("DEMO_PREFIX}/`)) return NextResponse.next();");
    assert.ok(demoLine > 0 && demoLine < proxy.indexOf("await updateSession(request)"), "the demo returns before updateSession");
  });
});
