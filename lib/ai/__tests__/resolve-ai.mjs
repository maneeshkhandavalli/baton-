// Test-only resolve hook for lib/ai tests (Node's built-in runner, node:test).
//
// - "server-only" resolves to an empty module. Next.js aliases it at build time; plain Node cannot
//   resolve it. This stubs the framework marker only (QA decision 2), never lib/ai logic.
// - Extensionless relative specifiers retry with ".ts" (as lib/contracts/__tests__/resolve-ts.mjs).
// It is never loaded by the app.
//
// Run: node --import ./lib/ai/__tests__/resolve-ai.mjs --test "lib/ai/__tests__/*.test.ts"

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
