// Test-only resolve hook for Node's built-in test runner (node:test).
//
// The contract modules use extensionless relative imports (bundler resolution, as Next.js and
// tsconfig expect). Node's native TypeScript support needs explicit extensions, so this hook
// retries an extensionless relative specifier with ".ts". It is never loaded by the app.
//
// Run: node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/contracts/__tests__/*.test.ts"

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
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
