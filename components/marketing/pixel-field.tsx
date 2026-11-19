"use client";

import { useEffect, useRef } from "react";

/**
 * The outro's pixel field: small squares in the evidence sky blue that get denser towards the bottom, where the
 * closing section's solid sky takes over (reference: the dithered field behind the outro). Drawn once to a canvas
 * per resize with a fixed seed, so it is static (no animation) and identical on every visit. Decorative.
 */
export function PixelField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const styles = getComputedStyle(canvas);
      const sky = styles.getPropertyValue("--t-sky").trim() || "#c3dcf3";
      const lime = styles.getPropertyValue("--t-lime").trim() || "#e3ee6b";
      const apricot = styles.getPropertyValue("--t-apricot").trim() || "#f1cf8d";
      const cell = width < 768 ? 7 : 9;
      let seed = 1337;
      const rand = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      const cols = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      for (let y = 0; y < rows; y++) {
        const t = y / rows;
        const density = Math.max(0, t * t * 1.15 - 0.04);
        for (let x = 0; x < cols; x++) {
          const r = rand();
          if (r > density) continue;
          const accent = rand();
          ctx.fillStyle = accent > 0.985 ? apricot : accent > 0.97 ? lime : sky;
          ctx.globalAlpha = 0.55 + rand() * 0.45;
          ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
        }
      }
    };
    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  return <canvas ref={ref} aria-hidden="true" />;
}
