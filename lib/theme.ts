/**
 * Colour theme (docs/design/design-system.md → 3.2 Colour — dark).
 *
 * Light is the default. A visitor's explicit choice is kept in localStorage on this device only (no
 * cookie, no database column), and applied as the `dark` class on <html>, which switches every token in
 * app/globals.css. `themeInitScript` runs in <head> before first paint, so a saved dark choice never
 * flashes light; the root layout marks <html> with suppressHydrationWarning because that class is added
 * before React hydrates.
 *
 * The script is served as a static file (`THEME_INIT_SRC`, public/theme-init.js) and loaded with a blocking
 * <script src>, not inlined: rendering code never uses raw-HTML escape hatches (IT-04). The public file is
 * generated from `themeInitScript` and a test keeps the two byte-identical.
 *
 * Isomorphic: nothing here touches the DOM at import time, so server layouts and node tests can use it.
 */

export const THEME_STORAGE_KEY = "baton-theme";

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "light";

/** Browser chrome colour per theme; equals `--background` in app/globals.css. */
export const THEME_COLOR: Record<Theme, string> = { light: "#f7f4ee", dark: "#0f1320" };

/** Anything other than an explicit "dark" (missing, corrupted, unknown) is the default light theme. */
export function parseTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : DEFAULT_THEME;
}

/** Where the init script is served from (public/theme-init.js). */
export const THEME_INIT_SRC = "/theme-init.js";

/**
 * Source of truth for public/theme-init.js, a blocking script in <head>. Kept tiny and dependency-free:
 * it must run before the body paints. Storage can throw (private mode, blocked site data); then the page
 * simply stays light. After changing it, regenerate the file:
 *   node --import ./lib/mocks/__tests__/resolve-ui.mjs -e "import('@/lib/theme').then(m=>require('fs').writeFileSync('public/theme-init.js',m.themeInitScript+'\n'))"
 */
export const themeInitScript = `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="dark"){document.documentElement.classList.add("dark");document.addEventListener("DOMContentLoaded",function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",${JSON.stringify(THEME_COLOR.dark)})})}}catch{}})();`;

/** Applies a theme to the live document. Client only. */
export function applyTheme(theme: Theme, { animate = false }: { animate?: boolean } = {}): void {
  const root = document.documentElement;
  // Switch every surface in the same frame: without this, elements with colour transitions (buttons,
  // nav items) fade while the rest snaps, which reads as a glitch.
  let freeze: HTMLStyleElement | null = null;
  if (!animate) {
    freeze = document.createElement("style");
    freeze.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(freeze);
  }
  root.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  if (freeze) {
    void window.getComputedStyle(root).color; // flush styles while transitions are off
    const node = freeze;
    window.requestAnimationFrame(() => node.remove());
  }
}

/** Reads the saved choice; storage failures fall back to the default. Client only. */
export function readStoredTheme(): Theme {
  try {
    return parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** Saves the choice; returns false when storage is unavailable (the theme still applies for this page). */
export function storeTheme(theme: Theme): boolean {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
