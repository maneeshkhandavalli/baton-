import { Caveat } from "next/font/google";

import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { SmoothScroll } from "@/components/marketing/smooth-scroll";
import { fontDisplay as display, fontMono as mono, fontSans as text } from "@/lib/fonts";

import "./identity.css";
import "./landing.css";

/**
 * Identity preview (scoped): the marketing routes use the proposed "Graphite & Highlighter" tokens and fonts via
 * `.brand-identity` (identity.css). The app shares the same tokens and faces (app/globals.css, lib/fonts.ts).
 * Host Grotesk (display), Atkinson Hyperlegible Next (text and UI), Atkinson Hyperlegible Mono (references and data):
 * all SIL OFL, variable weight, latin subset, self-hosted by next/font. Caveat (SIL OFL) is the landing page's handwritten
 * margin voice: short annotations that point at product UI, never body copy (.bi-hand).
 * Header and footer are the marketing-only floating pill and footer card (components/marketing; landing.css); the
 * workspace keeps components/layout.
 */
const hand = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`brand-identity ${display.variable} ${text.variable} ${mono.variable} ${hand.variable} flex min-h-dvh flex-col`}>
      <SmoothScroll />
      <MarketingHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
