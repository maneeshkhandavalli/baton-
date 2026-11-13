"use client";

import { useCallback, useSyncExternalStore } from "react";

import { applyTheme, DEFAULT_THEME, parseTheme, storeTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

/**
 * The current theme, read from the `dark` class on <html> (set before paint by `themeInitScript`).
 * Every consumer (each toggle, the toaster) stays in step through one MutationObserver, and a choice
 * made in another tab is applied here through the `storage` event.
 */

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) applyTheme(parseTheme(e.newValue));
  };
  window.addEventListener("storage", onStorage);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
// The server cannot know a device-local choice. Hydration uses this value, then React re-renders with
// the real one, so there is no mismatch warning; toggles render their icons from CSS meanwhile.
const getServerSnapshot = (): Theme => DEFAULT_THEME;

export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    storeTheme(next);
  }, []);
  return { theme, setTheme };
}
