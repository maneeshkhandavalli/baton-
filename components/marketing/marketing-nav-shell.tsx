"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll state for the floating header: `data-compact` once the page has scrolled past the top (the pill narrows to
 * the centre, `max-width .9s`), and `data-tone="dark"` while a section marked `data-header-tone="dark"` sits under
 * the pill (its colours invert). Both are plain attributes; the header is complete and usable without them.
 */
export function MarketingNavShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setCompact(window.scrollY > 40);
      const probeY = (ref.current?.getBoundingClientRect().bottom ?? 60) - 20;
      let isDark = false;
      for (const el of document.querySelectorAll<HTMLElement>("[data-header-tone='dark']")) {
        const r = el.getBoundingClientRect();
        if (r.top <= probeY && r.bottom >= probeY) {
          isDark = true;
          break;
        }
      }
      setDark(isDark);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header ref={ref} className="lp-nav" data-compact={compact} data-tone={dark ? "dark" : "light"}>
      {children}
    </header>
  );
}
