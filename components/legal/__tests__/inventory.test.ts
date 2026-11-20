/**
 * The cookie, storage and third-party inventory (components/legal/inventory.ts) against the real source tree.
 * Drift fails here: a new localStorage/sessionStorage user, a new cookie, an analytics package, an external script
 * or a consent banner without a matching update to the inventory and the /cookies page.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { BROWSER_STORAGE, COOKIES, NON_ESSENTIAL_TRACKING } from "../inventory";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const SCAN_DIRS = ["app", "components", "lib", "public", "config", "hooks"];
const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next"]);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      if (SKIP_DIRS.has(name)) continue;
      const childRel = `${rel}/${name}`;
      const st = statSync(path.join(root, childRel));
      if (st.isDirectory()) walk(childRel);
      else if (/\.(?:[cm]?[jt]sx?)$/.test(name)) out.push(childRel);
    }
  };
  for (const d of SCAN_DIRS) walk(d);
  return out.filter((f) => !f.startsWith("components/legal/"));
}

const FILES = sourceFiles();

/** A real call (not a comment that mentions storage). */
const STORAGE_USE = /\b(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem|clear|key)\s*\(|window\.(?:localStorage|sessionStorage)\b/;

describe("inventory: browser storage", () => {
  it("every file that uses localStorage or sessionStorage is in the inventory", () => {
    const users = FILES.filter((f) => STORAGE_USE.test(read(f)));
    assert.ok(users.length >= 5, "the scan found the known users");
    const documented = new Set(BROWSER_STORAGE.flatMap((s) => s.usedIn));
    for (const f of users) {
      assert.ok(documented.has(f), `${f} uses browser storage but is not in components/legal/inventory.ts (update it and /cookies)`);
    }
  });

  // Integration (21 Nov): a file already listed could add a NEW key unnoticed (baton:gap-sent: slipped past the
  // file-level check above). Every "baton:" / "baton-" storage key prefix in the code must be documented.
  it("every baton storage key prefix in the code is documented (key level, not just file level)", () => {
    const KEY = /["'`](baton[:-][a-z0-9-]+[:-]?)/g;
    const documented = BROWSER_STORAGE.map((s) => s.sourceLiteral);
    const cookieNames = COOKIES.map((c) => ("name" in c ? String((c as { name: string }).name) : ""));
    for (const f of FILES) {
      const text = read(f);
      if (!STORAGE_USE.test(text) && !/StorageKey|storage key/i.test(text)) continue;
      for (const m of text.matchAll(KEY)) {
        const literal = m[1];
        // in-page event names (e.g. SHOW_CHECKLIST_EVENT = "baton:show-checklist", new Event("baton:…")) are not storage
        const line = text.slice(text.lastIndexOf("\n", m.index ?? 0) + 1, text.indexOf("\n", m.index ?? 0));
        if (/Event\b|_EVENT\b|addEventListener|dispatchEvent/.test(line)) continue;
        const known = documented.some((d) => d.startsWith(literal) || literal.startsWith(d)) || cookieNames.some((c) => c.startsWith(literal));
        assert.ok(known, `${f}: storage key ${literal} is not in components/legal/inventory.ts (update it and /cookies)`);
      }
    }
  });

  it("every documented key appears in the code it names, and each named file exists", () => {
    for (const s of BROWSER_STORAGE) {
      for (const f of s.usedIn) assert.ok(existsSync(path.join(root, f)), `${s.key}: ${f} exists`);
      assert.ok(
        s.usedIn.some((f) => read(f).includes(s.sourceLiteral)),
        `${s.key}: the literal ${s.sourceLiteral} appears in ${s.usedIn.join(", ")}`,
      );
    }
  });

  it("browser storage is only ever functional (never strictly necessary for sign-in, never tracking)", () => {
    for (const s of BROWSER_STORAGE) assert.equal(s.category, "functional", s.key);
  });
});

describe("inventory: cookies", () => {
  it("every cookie name the code sets is documented", () => {
    const named = new Set<string>();
    for (const f of FILES) {
      const src = read(f);
      // cookie-name constants anywhere (a constant may live apart from the code that sets it); paths are not names
      for (const m of src.matchAll(/const\s+\w*COOKIE\w*\s*=\s*["'`]([A-Za-z0-9_.-]+)["'`]/g)) named.add(m[1]);
      if (!/cookies\(\)|\.cookies\.set\(|Set-Cookie/i.test(src)) continue;
      for (const m of src.matchAll(/(?:jar|cookieStore|cookies)\.set\(\s*["'`]([A-Za-z0-9_.-]+)["'`]\s*,/g)) named.add(m[1]);
      for (const m of src.matchAll(/Set-Cookie["'`]\s*,\s*[`"']([A-Za-z0-9_.-]+)=/gi)) named.add(m[1]);
    }
    const documented = new Set(COOKIES.map((c) => c.sourceLiteral).filter((v): v is string => v !== null));
    for (const name of named) assert.ok(documented.has(name), `cookie ${name} is set in code but not documented in components/legal/inventory.ts`);
  });

  it("each documented cookie is really set where the inventory says", () => {
    for (const c of COOKIES) {
      for (const f of c.setIn) assert.ok(existsSync(path.join(root, f)), `${c.name}: ${f} exists`);
      if (c.sourceLiteral) assert.ok(c.setIn.some((f) => read(f).includes(c.sourceLiteral as string)), c.name);
    }
  });

  it("Supabase session cookies are HttpOnly, SameSite=Lax and Secure in production", () => {
    const src = read("lib/supabase/cookie-options.ts");
    assert.match(src, /return \{ httpOnly: true, sameSite: "lax", secure: env\.NODE_ENV === "production", path: "\/" \}/);
  });

  it("every cookie is strictly necessary", () => {
    for (const c of COOKIES) assert.equal(c.category, "strictly_necessary", c.name);
  });
});

describe("inventory: no optional tracking, so no consent banner", () => {
  it("the inventory records no non-essential tracking", () => {
    assert.deepEqual([...NON_ESSENTIAL_TRACKING], []);
  });

  it("no analytics, tag-manager or tracking package is a dependency", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const TRACKING = /analytics|speed-insights|gtag|google-tag|tagmanager|posthog|plausible|mixpanel|segment|amplitude|hotjar|fullstory|sentry|datadog|logrocket|clarity|heap|matomo|umami|fathom|intercom|hubspot|facebook|meta-pixel|linkedin|twitter-pixel|tiktok/i;
    const found = deps.filter((d) => TRACKING.test(d));
    assert.deepEqual(found, [], `tracking packages: ${found.join(", ")}`);
  });

  it("no source file loads an external script, tracking pixel or analytics call", () => {
    const SCRIPT_COMPONENT = /<Script\b|from "next\/script"/; // case-sensitive: the next/script component
    const EXTERNAL = /<script[^>]+src=\{?["'`]https?:|googletagmanager|google-analytics|gtag\(|dataLayer|fbq\(|posthog|plausible\.io|@vercel\/analytics|@vercel\/speed-insights|<img[^>]+src=["'`]https?:\/\/[^"'`]*(?:pixel|track|collect)/i;
    for (const f of FILES) {
      if (f.startsWith("public/")) continue; // checked below as plain scripts
      assert.doesNotMatch(read(f), EXTERNAL, f);
      assert.doesNotMatch(read(f), SCRIPT_COMPONENT, f);
    }
    for (const f of FILES.filter((x) => x.startsWith("public/"))) {
      assert.doesNotMatch(read(f), /https?:\/\/|fetch\(|XMLHttpRequest|sendBeacon|document\.cookie/, `${f} contacts nothing and sets no cookie`);
    }
  });

  it("the root layout loads only Baton's own theme script", () => {
    const layout = read("app/layout.tsx");
    const scripts = layout.match(/<script\b[^>]*>/g) ?? [];
    assert.deepEqual(scripts, ["<script src={THEME_INIT_SRC} />"]);
    assert.doesNotMatch(read("lib/theme.ts"), /THEME_INIT_SRC = ["'`]https?:/);
  });

  it("fonts are self-hosted by next/font (no runtime request to a font service)", () => {
    const fonts = read("lib/fonts.ts");
    assert.match(fonts, /from "next\/font\/google"/);
    for (const f of FILES) assert.doesNotMatch(read(f), /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net/, f);
  });

  it("the Content Security Policy allows scripts only from Baton itself", () => {
    const headers = read("lib/security/headers.ts");
    const m = headers.match(/"script-src": \[([^\]]*)\]/);
    assert.ok(m, "script-src is defined");
    assert.doesNotMatch(m[1], /https?:|\*/, "no external script origin");
  });

  it("no consent banner or preference store exists, because nothing optional is set", () => {
    const consentDir = path.join(root, "components/consent");
    const files = existsSync(consentDir) ? readdirSync(consentDir) : [];
    assert.deepEqual(files, [], "add a consent UI only together with optional tracking, and test it");
    assert.ok(!FILES.some((f) => /cookie-?banner|consent-?banner/i.test(f)));
  });
});
