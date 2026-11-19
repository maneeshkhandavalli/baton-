"use client";

import { useEffect, useState } from "react";

/**
 * The hero's last phrase (reference: the cycling last word of the headline). Starts on the first word, rolls once
 * through the others and comes back to it, then rests: one pass of about four seconds, so it never needs a pause
 * control (WCAG 2.2.2), and none at all under reduced motion. The outgoing word slides up, the incoming one rises
 * from below. Visual only: the heading's accessible name is the full sentence, given by the parent.
 */
export function RotatingWord({ words }: { words: readonly string[] }) {
  const [{ i, prev }, setState] = useState({ i: 0, prev: -1 });

  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      setState((s) => ({ i: step % words.length, prev: s.i }));
      if (step >= words.length) window.clearInterval(timer);
    }, 1100);
    return () => window.clearInterval(timer);
  }, [words.length]);

  return (
    <span aria-hidden="true" className="lp-word">
      {words.map((w, j) => (
        <span key={w} data-state={j === i ? "in" : j === prev ? "out" : "next"}>
          {w}
        </span>
      ))}
    </span>
  );
}
