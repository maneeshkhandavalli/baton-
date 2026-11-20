import type { CSSProperties } from "react";

/** The four evidence colours, in the order the Baton mark shows them. */
const SEGMENTS = ["bg-status-sourced", "bg-status-inferred", "bg-status-conflicting", "bg-status-missing"] as const;
/** A short row of pixels under the mark (the landing's pixel motif), cycling the same four colours. */
const PIXELS = [0, 1, 2, 3, 0, 1, 2] as const;

/**
 * The landing's loading motif, shared by the route fallback (app/(marketing)/loading.tsx) and the first-visit splash
 * (intro-splash.tsx): the Baton mark drawn large (four segments: sourced, inferred, conflicting, missing), the
 * wordmark in the landing's mono voice, and a row of pixels. Purely decorative; callers own the semantics. Its
 * motion lives in landing.css under `prefers-reduced-motion: no-preference`, so it is a still mark otherwise.
 */
export function BrandLoader({ looping = false }: { looping?: boolean }) {
  return (
    <span aria-hidden="true" className="lp-loader" data-looping={looping || undefined}>
      <span className="lp-loader__mark">
        {SEGMENTS.map((c, i) => (
          <span key={c} className={c} style={{ "--i": i } as CSSProperties} />
        ))}
      </span>
      <span className="lp-mono lp-loader__word">Baton</span>
      <span className="lp-loader__pixels">
        {PIXELS.map((c, i) => (
          <span key={i} className={SEGMENTS[c]} style={{ "--i": i } as CSSProperties} />
        ))}
      </span>
    </span>
  );
}
