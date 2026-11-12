// Resolve hook for the integration acceptance tests (Node's built-in runner, node:test). Never loaded by the app.
//
//   node --import ./tests/integration/support/resolve.mjs --test "tests/integration/**/*.test.ts"
//
// - "@/x" resolves to "<repo>/x"; extensionless relative specifiers retry with ".ts", ".tsx", then "/index.ts".
// - Framework and platform modules ONLY are replaced by tiny stubs (QA decision 2, interfaces.md):
//   "server-only", "next/*", "@supabase/ssr" and "@supabase/supabase-js". Application logic (lib/db,
//   lib/privacy, lib/parsers, lib/ai, lib/pipeline, lib/actions) is never stubbed; tests drive it through its
//   injected DbClient / StorageClient / AiProvider interfaces instead. Stub state lives on globalThis.__batonIt
//   (see platform.ts).
// - ".tsx" components are transpiled on load with the project's own TypeScript (a devDependency already in
//   package.json; JSX → react-jsx) so the §12.10 UI checks can render real components to static markup.

import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const stub = (name) => pathToFileURL(path.join(here, "stubs", name)).href;

const stubs = {
  "server-only": stub("server-only.mjs"),
  "next/server": stub("next-server.mjs"),
  "next/headers": stub("next-headers.mjs"),
  "next/cache": stub("next-cache.mjs"),
  "next/navigation": stub("next-navigation.mjs"),
  "next/link": stub("next-link.mjs"), // render tests (r3-preview-guard, r3-render-determinism)
  "@supabase/ssr": stub("supabase-ssr.mjs"),
  "@supabase/supabase-js": stub("supabase-js.mjs"), // approved by the lead (W1): forwards to Recording* fakes
};

let ts = null;
function typescript() {
  ts ??= createRequire(path.join(root, "package.json"))("typescript");
  return ts;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(stubs, specifier)) return { url: stubs[specifier], shortCircuit: true };
    let target = specifier;
    if (specifier.startsWith("@/")) target = pathToFileURL(path.join(root, specifier.slice(2))).href;
    const isRelative = target.startsWith("./") || target.startsWith("../") || target.startsWith("file:");
    if (isRelative && !/\.[cm]?[jt]sx?$/.test(target)) {
      // bundler resolution: "./x" → "./x.ts", "./x.tsx", then the directory's "./x/index.ts"
      for (const candidate of [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) {
        try {
          return nextResolve(candidate, context);
        } catch {
          // try the next candidate, then the default resolution
        }
      }
    }
    return nextResolve(target, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return nextLoad(url, context);
    const file = fileURLToPath(url);
    const t = typescript();
    const out = t.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { jsx: t.JsxEmit.ReactJSX, module: t.ModuleKind.ESNext, target: t.ScriptTarget.ES2022, verbatimModuleSyntax: false },
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  },
});
