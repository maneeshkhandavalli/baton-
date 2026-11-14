// Resolve hook for the opt-in LIVE tests (tests/live). Never loaded by the app or by `npm test`.
// - "server-only" → empty module (Next.js aliases it at build time).
// - "next/<name>" → "next/<name>.js" (Next's subpath entry points have no "exports" map, so plain Node ESM
//   needs the extension). The real modules are used; nothing is stubbed beyond the framework marker.
// - Extensionless relative specifiers retry with ".ts", then "/index.ts" (directory imports such as "../db").
import { registerHooks } from "node:module";

const EMPTY_MODULE = "data:text/javascript,export%20%7B%7D%3B";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: EMPTY_MODULE, shortCircuit: true };
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // try the next candidate
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
