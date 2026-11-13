// Dark mode (docs/design/design-system.md → 3.2): light is the default, an explicit choice is kept on the
// device, and the <head> script (public/theme-init.js) applies it before first paint. The script is executed
// here in a sandbox against fake document/localStorage objects; the wiring is checked statically.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { DEFAULT_THEME, parseTheme, THEME_COLOR, THEME_INIT_SRC, THEME_STORAGE_KEY, themeInitScript } from "@/lib/theme";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function runInitScript(stored: string | null | Error) {
  const classes = new Set<string>();
  const meta = { content: THEME_COLOR.light, setAttribute(_: string, v: string) { this.content = v; } };
  let onReady: (() => void) | null = null;
  const sandbox = {
    localStorage: {
      getItem(key: string) {
        if (stored instanceof Error) throw stored;
        return key === THEME_STORAGE_KEY ? stored : null;
      },
    },
    document: {
      documentElement: { classList: { add: (c: string) => classes.add(c) } },
      addEventListener: (_: string, fn: () => void) => { onReady = fn; },
      querySelector: () => meta,
    },
  };
  vm.runInNewContext(themeInitScript, sandbox);
  (onReady as (() => void) | null)?.();
  return { classes, meta };
}

describe("theme preference", () => {
  it("defaults to light for anything but an explicit dark choice", () => {
    assert.equal(DEFAULT_THEME, "light");
    assert.equal(parseTheme("dark"), "dark");
    for (const v of ["light", null, undefined, "", "DARK", "system", 1, {}]) assert.equal(parseTheme(v), "light");
  });

  it("theme colours match --background in globals.css", () => {
    const css = read("app/globals.css");
    const bg = (sel: string) => {
      const block = css.slice(css.indexOf(`\n${sel} {`));
      return /--background:\s*(#[0-9a-f]{6})/i.exec(block)?.[1];
    };
    assert.equal(bg(":root"), THEME_COLOR.light);
    assert.equal(bg(".dark"), THEME_COLOR.dark);
  });
});

describe("theme init script (runs before first paint)", () => {
  it("applies a saved dark choice and the dark browser-chrome colour", () => {
    const { classes, meta } = runInitScript("dark");
    assert.deepEqual([...classes], ["dark"]);
    assert.equal(meta.content, THEME_COLOR.dark);
  });

  it("leaves the page light when nothing, light, or garbage is stored", () => {
    for (const v of [null, "light", "nonsense"]) assert.equal(runInitScript(v).classes.size, 0);
  });

  it("never throws when storage is blocked", () => {
    assert.doesNotThrow(() => runInitScript(new Error("SecurityError")));
    assert.equal(runInitScript(new Error("SecurityError")).classes.size, 0);
  });
});

describe("theme wiring", () => {
  it("the root layout loads the script as a blocking <script src> in <head>, never as inline HTML", () => {
    const layout = read("app/layout.tsx");
    const head = /<head>([\s\S]*?)<\/head>/.exec(layout)?.[1] ?? "";
    assert.match(head, /<script src=\{THEME_INIT_SRC\} \/>/);
    assert.doesNotMatch(head, /\b(async|defer)\b|dangerouslySetInnerHTML/);
    assert.match(layout, /<html[^>]*suppressHydrationWarning/);
  });

  it("public/theme-init.js is exactly themeInitScript (regenerate it after changing lib/theme.ts)", () => {
    assert.equal(THEME_INIT_SRC, "/theme-init.js");
    assert.equal(read("public/theme-init.js").replace(/\r?\n$/, ""), themeInitScript);
  });

  it("the proxy skips the script, so first paint never waits on a session refresh", () => {
    const matcher = /matcher:\s*\[\s*(?:\/\/[^\n]*\n\s*)*"([^"]+)"/.exec(read("proxy.ts"))?.[1];
    assert.ok(matcher, "proxy matcher found");
    const re = new RegExp(`^${matcher.replace(/\\\\/g, "\\")}$`);
    assert.equal(re.test(THEME_INIT_SRC), false, "theme-init.js bypasses the proxy");
    for (const page of ["/", "/login", "/dashboard", "/handover/x/review"]) assert.equal(re.test(page), true, `${page} still runs the proxy`);
  });

  it("every frame without the sidebar, and the sidebar itself, offers the toggle", () => {
    for (const f of [
      "components/layout/app-sidebar.tsx", // workspace, desktop
      "components/layout/mobile-header.tsx", // workspace, below lg
      "components/layout/site-header.tsx", // public pages
      "app/(auth)/layout.tsx", // login
      "components/layout/shared-link-shell.tsx", // token links
    ]) assert.match(read(f), /<ThemeToggle\b/, f);
  });

  it("the toaster follows the app theme instead of a fixed light theme", () => {
    const sonner = read("components/ui/sonner.tsx");
    assert.match(sonner, /useTheme\(\)/);
    assert.doesNotMatch(sonner, /theme = "light"/);
  });
});
