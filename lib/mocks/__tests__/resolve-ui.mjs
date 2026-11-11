// Test-only resolve hook for the UI agent's tests (Node's built-in runner, node:test).
//
// - "@/x" resolves to "<repo>/x" (tsconfig paths), trying ".ts" for extensionless specifiers.
// - Extensionless relative specifiers retry with ".ts" (as lib/contracts/__tests__/resolve-ts.mjs).
// - "next/cache" and "next/server" resolve to tiny stubs: the mocks only call `refresh()` and
//   `connection()`, which have no meaning outside a Next.js request.
// It is never loaded by the app.
//
// Run: node --import ./lib/mocks/__tests__/resolve-ui.mjs --test "lib/mocks/__tests__/*.test.ts" "components/shared/__tests__/*.test.ts"

import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const stubs = {
  "next/cache": pathToFileURL(path.join(root, "lib/mocks/__tests__/stubs/next-cache.mjs")).href,
  "next/server": pathToFileURL(path.join(root, "lib/mocks/__tests__/stubs/next-server.mjs")).href,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in stubs) return { url: stubs[specifier], shortCircuit: true };
    let target = specifier;
    if (specifier.startsWith("@/")) target = pathToFileURL(path.join(root, specifier.slice(2))).href;
    const isRelative = target.startsWith("./") || target.startsWith("../") || target.startsWith("file:");
    if (isRelative && !/\.[cm]?[jt]sx?$/.test(target)) {
      try {
        return nextResolve(`${target}.ts`, context);
      } catch {
        // fall through
      }
    }
    return nextResolve(target, context);
  },
});
