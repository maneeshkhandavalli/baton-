"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { BrandLoader } from "./brand-loader";

const SEEN_KEY = "baton:intro-seen";
/** The fade must start by this point (landing.css's failsafe animation uses the same delay); the fade takes 300 ms. */
const FADE_BY_MS = 600;
/** Long enough for the mark to read, short enough not to hold anyone up. */
const MIN_VISIBLE_MS = 350;

/**
 * Decides, before the first paint, whether the splash shows. Runs inline right after the splash's markup, so the
 * first frame is CSS only (no flash, no wait for hydration). It shows only with JavaScript (no-JS visitors never get
 * `data-show`, so nothing covers the page), only when motion is allowed, and once per tab session; if
 * sessionStorage is unavailable it does not show at all. `data-t` records when it appeared.
 */
const DECIDE = `(function(){try{var e=document.currentScript&&document.currentScript.previousElementSibling;if(!e||!matchMedia("(prefers-reduced-motion: no-preference)").matches)return;if(sessionStorage.getItem("${SEEN_KEY}"))return;sessionStorage.setItem("${SEEN_KEY}","1");e.setAttribute("data-t",String(Math.round(performance.now())));e.setAttribute("data-show","")}catch(_){}})()`;

const subscribeNoop = () => () => {};

/**
 * A brief intro on the first visit to `/` (at most about 900 ms): the landing's loading motif over the page's own
 * paper, fading out once hydration and the GSAP setup are done (LandingMotion's effect runs before this one), or at
 * the latest by the CSS failsafe in landing.css, whichever comes first. It is a fixed overlay, so nothing shifts,
 * the hero (the LCP element) stays rendered underneath, and scrolling is never locked. Decorative, so aria-hidden:
 * the page under it is already complete and readable, and nothing is marked busy.
 */
export function IntroSplash() {
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  // true while server rendering and hydrating; false on a client-side navigation, where an inline script would not
  // run (and React would warn about it), so the splash simply stays hidden
  const fromServer = useSyncExternalStore(
    subscribeNoop,
    () => false,
    () => true,
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || !el.hasAttribute("data-show")) return;
    const onEnd = (e: AnimationEvent) => {
      if (e.target === el) setDone(true);
    };
    el.addEventListener("animationend", onEnd);
    const elapsed = performance.now() - (Number(el.dataset.t) || 0);
    // Before the failsafe fade starts, take over and fade now (after a short minimum); otherwise let the failsafe run.
    const leave = elapsed < FADE_BY_MS ? window.setTimeout(() => el.setAttribute("data-leaving", ""), Math.max(0, MIN_VISIBLE_MS - elapsed)) : 0;
    const cleanup = window.setTimeout(() => setDone(true), 1600);
    return () => {
      el.removeEventListener("animationend", onEnd);
      window.clearTimeout(leave);
      window.clearTimeout(cleanup);
    };
  }, []);

  if (done) return null;
  return (
    <>
      <div ref={ref} data-splash className="lp-splash" aria-hidden="true" suppressHydrationWarning>
        <BrandLoader />
      </div>
      {fromServer ? <script dangerouslySetInnerHTML={{ __html: DECIDE }} /> : null}
    </>
  );
}
