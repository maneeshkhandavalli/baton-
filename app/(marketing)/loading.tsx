import { BrandLoader } from "@/components/marketing/brand-loader";

/**
 * Route-level fallback for the marketing routes (the landing page is prerendered, so this mostly shows on a slow
 * first navigation; /demo keeps its own skeleton). The landing's paper, mono type and the Baton mark with its pixel
 * row, which pulses only when motion is allowed. Announced once as a polite status.
 */
export default function Loading() {
  return (
    <div className="lp lp-loading" role="status" aria-live="polite" aria-busy="true">
      <BrandLoader looping />
      <span className="sr-only">Loading Baton…</span>
    </div>
  );
}
