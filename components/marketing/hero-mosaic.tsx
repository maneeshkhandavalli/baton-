"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero mosaic: flat geometric tiles in Baton's evidence palette (sky = sourced, apricot = inferred, mauve =
 * conflicting, stone = missing) and the highlighter lime, with a few Baton glyphs (a quote mark, a check, a question
 * mark). The centre cell of the middle row is left empty: the Baton disc (in the page's sticky stage) sits there and
 * rides down into the next section.
 *
 * Motion (pointer devices, motion allowed): a few tiles reshape for about four seconds after load, then the mosaic
 * rests; a tile reshapes when the pointer passes over it. Decorative, so the whole grid is aria-hidden. The layout is
 * deterministic (no randomness during render), so server and client markup match.
 */

type Shape = "square" | "circle" | "arch" | "arch-down" | "quarter" | "quarter-r" | "leaf" | "tri" | "tri-r" | "diamond" | "half" | "empty";
type Tone = "sky" | "apricot" | "mauve" | "stone" | "lime" | "lime-2" | "lime-3";
type Tile = { s: Shape; c: Tone; g?: "“" | "✓" | "?" };

const SHAPES: Shape[] = ["square", "circle", "arch", "arch-down", "quarter", "quarter-r", "leaf", "tri", "tri-r", "diamond", "half"];
const TONES: Tone[] = ["sky", "apricot", "mauve", "stone", "lime", "lime-2", "lime-3"];

/** 11 × 3 on desktop; phones and tablets show the middle 7 columns (columns 3–9). Index 16 (row 2, col 6) is the hole. */
const DESKTOP: Tile[] = [
  { s: "square", c: "sky" }, { s: "square", c: "stone" }, { s: "tri-r", c: "apricot" }, { s: "empty", c: "sky" }, { s: "square", c: "lime-2" }, { s: "square", c: "stone", g: "“" }, { s: "square", c: "lime" }, { s: "diamond", c: "apricot" }, { s: "square", c: "mauve" }, { s: "empty", c: "sky" }, { s: "quarter", c: "sky" },
  { s: "empty", c: "sky" }, { s: "circle", c: "lime-2" }, { s: "square", c: "apricot" }, { s: "tri", c: "mauve" }, { s: "square", c: "sky", g: "✓" }, { s: "empty", c: "sky" }, { s: "square", c: "sky" }, { s: "arch-down", c: "stone" }, { s: "quarter-r", c: "stone" }, { s: "square", c: "lime" }, { s: "empty", c: "sky" },
  { s: "square", c: "stone" }, { s: "square", c: "lime-3" }, { s: "empty", c: "sky" }, { s: "square", c: "stone" }, { s: "square", c: "mauve" }, { s: "arch", c: "stone" }, { s: "square", c: "lime-3", g: "?" }, { s: "square", c: "sky" }, { s: "leaf", c: "lime-2" }, { s: "empty", c: "sky" }, { s: "square", c: "lime-3" },
];
const HOLE = 16;
const COLS = 11;

const toneVar = (c: Tone) => `var(--t-${c})`;

export function HeroMosaic() {
  const [tiles, setTiles] = useState(DESKTOP);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const motionOk = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    if (!motionOk) return;
    let n = 0;
    let seed = 7;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const timer = window.setInterval(() => {
      n += 1;
      setTiles((prev) =>
        prev.map((t, i) => {
          if (i === HOLE || t.g || rand() > 0.22) return t;
          return { s: SHAPES[Math.floor(rand() * SHAPES.length)], c: TONES[Math.floor(rand() * TONES.length)] };
        }),
      );
      if (n >= 3) window.clearInterval(timer); // rests after about four seconds (WCAG 2.2.2)
    }, 1400);
    return () => window.clearInterval(timer);
  }, []);

  const reshape = (i: number) => {
    if (i === HOLE || !root.current || !window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) return;
    setTiles((prev) => prev.map((t, j) => (j === i && !t.g ? { s: SHAPES[(SHAPES.indexOf(t.s) + 3) % SHAPES.length], c: TONES[(TONES.indexOf(t.c) + 2) % TONES.length] } : t)));
  };

  return (
    <div ref={root} aria-hidden="true" className="lp-mosaic" data-mosaic>
      {tiles.map((t, i) => {
        const col = i % COLS;
        const narrowHidden = col < 2 || col > 8; // phones and tablets show the 7 middle columns
        return (
          <span
            key={i}
            data-shape={t.s}
            data-tile
            onPointerEnter={() => reshape(i)}
            className={`lp-tile${i === HOLE ? " lp-tile--hole" : ""}${narrowHidden ? " max-lg:hidden" : ""}`}
            style={{ ["--c" as string]: toneVar(t.c) }}
          >
            <i />
            {t.g ? <b>{t.g}</b> : null}
          </span>
        );
      })}
      {["0 0", "100% 0", "0 100%", "100% 100%"].map((at) => {
        const [left, top] = at.split(" ");
        return <span key={at} className="lp-tick" style={{ left, top }} />;
      })}
    </div>
  );
}
