// Test-only resolve hook for lib/pipeline tests (Node's built-in runner).
//
// - "server-only" resolves to an empty module (Next.js aliases it at build time; plain Node cannot
//   resolve it). Framework marker only (QA decision 2); no lib/db, lib/ai, lib/parsers or lib/privacy
//   logic is ever stubbed here.
// - Extensionless relative specifiers retry with ".ts".
//
// Run: node --import ./lib/pipeline/__tests__/resolve-pipeline.mjs --test "lib/pipeline/__tests__/*.test.ts"

import { registerHooks } from "node:module";

const EMPTY_MODULE = "data:text/javascript,export%20%7B%7D%3B";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY_MODULE, shortCircuit: true };
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (isRelative && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // fall through to the default resolution
      }
    }
    return nextResolve(specifier, context);
  },
});
