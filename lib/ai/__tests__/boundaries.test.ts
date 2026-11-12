// Static boundary checks for lib/ai (§11.8 rule 4, §12.5, §12.10, interfaces.md I1).
// Run: node --import ./lib/ai/__tests__/resolve-ai.mjs --test "lib/ai/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const AI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(AI_ROOT).map((full) => ({
  rel: path.relative(AI_ROOT, full).split(path.sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

/** Code without comments, so documentation may mention forbidden names. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function importSpecifiers(text: string): string[] {
  const specs: string[] = [];
  for (const m of code(text).matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g)) {
    specs.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  }
  return specs;
}

describe("lib/ai boundaries", () => {
  it("found the lib/ai sources", () => {
    const names = files.map((f) => f.rel);
    for (const expected of [
      "provider.ts",
      "config.ts",
      "quote-check.ts",
      "providers/fake.ts",
      "prompts/versions.ts",
      "prompts/payload.ts",
      "prompts/extract.ts",
      "prompts/support.ts",
      "extract.ts",
      "verify-support.ts",
      "stage.ts",
    ]) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
  });

  it("every module except quote-check.ts starts with import \"server-only\"", () => {
    for (const f of files) {
      if (f.rel === "quote-check.ts") continue;
      assert.match(f.text, /^import "server-only";\r?\n/, `${f.rel} must start with import "server-only"`);
    }
  });

  it("quote-check.ts is pure: no server-only, no env, no I/O, only the contracts import", () => {
    const qc = files.find((f) => f.rel === "quote-check.ts")!;
    assert.deepEqual(importSpecifiers(qc.text), ["../contracts/parser"]);
    assert.doesNotMatch(code(qc.text), /process\.|server-only|fetch\(|Date\.now|Math\.random/);
  });

  it("only config.ts reads the environment", () => {
    for (const f of files) {
      if (f.rel === "config.ts") continue;
      assert.doesNotMatch(code(f.text), /process\.env|import\.meta\.env/, `${f.rel} must not read env`);
    }
  });

  it("no NEXT_PUBLIC_ AI variable is used", () => {
    for (const f of files) assert.doesNotMatch(code(f.text), /NEXT_PUBLIC_/, f.rel);
  });

  it("never logs (prompts, text, output, credentials and provider bodies stay out of logs)", () => {
    for (const f of files) assert.doesNotMatch(code(f.text), /\bconsole\s*\.|\bdebugger\b/, f.rel);
  });

  it("imports only contracts, privacy, zod, server-only and lib/ai itself (no SDK, no network)", () => {
    for (const f of files) {
      for (const spec of importSpecifiers(f.text)) {
        const relative = spec.startsWith("./") || spec.startsWith("../");
        assert.ok(spec === "server-only" || spec === "zod" || relative, `${f.rel} imports ${spec}`);
        if (relative) {
          const resolved = path.posix.normalize(path.posix.join("lib/ai", path.posix.dirname(f.rel), spec));
          assert.ok(
            resolved.startsWith("lib/ai/") || resolved.startsWith("lib/contracts/") || resolved.startsWith("lib/privacy/"),
            `${f.rel} imports ${spec} (${resolved})`,
          );
        }
      }
      assert.doesNotMatch(code(f.text), /\bfetch\s*\(|XMLHttpRequest|WebSocket|child_process|\beval\s*\(|new Function\s*\(/, f.rel);
    }
  });

  it("no rendering of model output as HTML", () => {
    for (const f of files) assert.doesNotMatch(f.text, /dangerouslySetInnerHTML|innerHTML/, f.rel);
  });

  it("no hard-coded credentials", () => {
    for (const f of files) assert.doesNotMatch(code(f.text), /\b(sk-[A-Za-z0-9]{8,}|sk_live_|AKIA[0-9A-Z]{8,}|AIza[0-9A-Za-z_-]{10,}|ghp_[A-Za-z0-9]{10,})/, f.rel);
  });

  it("declares no tools or function calling (§12.10 rule 2)", () => {
    for (const f of files) assert.doesNotMatch(code(f.text), /\b(tools|tool_choice|functions|function_call)\s*:/, `${f.rel} declares tools`);
  });
});

describe("fixtures/ai synthetic data", () => {
  const FIXTURES = path.resolve(AI_ROOT, "../../fixtures/ai");
  const all = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]));

  it("uses only synthetic phone numbers and example domains", () => {
    for (const file of all(FIXTURES)) {
      const text = readFileSync(file, "utf8").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>");
      for (const m of text.matchAll(/\+?\d[\d\s-]{8,}\d/g)) {
        const digits = m[0].replace(/\D/g, "");
        if (digits.length >= 10) assert.match(digits, /^(91)?999990000\d$/, `${file}: non-synthetic number ${m[0]}`);
      }
      for (const m of text.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)) {
        assert.match(m[1], /^example\.(org|com)$/, `${file}: non-example email domain ${m[1]}`);
      }
      for (const m of text.matchAll(/https?:\/\/([^/\s"?]+)/g)) {
        assert.match(m[1], /^example\.(org|com)$/, `${file}: non-example URL host ${m[1]}`);
      }
    }
  });
});
