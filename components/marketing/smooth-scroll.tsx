"use client";

import "lenis/dist/lenis.css";

import Lenis from "lenis";
import { useEffect } from "react";

/**
 * Lenis smooth scrolling for the public marketing pages only. Never started when the visitor prefers reduced
 * motion (and stopped if that preference turns on). Same-page `#section` links scroll smoothly to their target,
 * update the URL and move keyboard focus there; everything else (other pages, new tabs, modified clicks) is left
 * to the browser and Next.js. Elements marked `data-lenis-prevent` keep their own native scrolling.
 */
export function SmoothScroll() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lenis: Lenis | null = null;

    const onAnchorClick = (event: MouseEvent) => {
      if (!lenis || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
      const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      // Handle it before Next.js' Link does, so there is one smooth scroll instead of a jump.
      event.preventDefault();
      event.stopPropagation();
      history.pushState(history.state, "", url.hash);
      lenis.scrollTo(target); // Lenis honours `scroll-padding-top` (globals.css), which clears the sticky header
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    };

    const start = () => {
      if (lenis || media.matches) return;
      lenis = new Lenis({ autoRaf: true, lerp: 0.12, wheelMultiplier: 1, smoothWheel: true, syncTouch: false });
    };
    const stop = () => {
      lenis?.destroy();
      lenis = null;
    };
    const onPreference = () => (media.matches ? stop() : start());

    start();
    media.addEventListener("change", onPreference);
    document.addEventListener("click", onAnchorClick, { capture: true });
    return () => {
      media.removeEventListener("change", onPreference);
      document.removeEventListener("click", onAnchorClick, { capture: true });
      stop();
    };
  }, []);

  return null;
}
