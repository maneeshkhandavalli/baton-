import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Host_Grotesk } from "next/font/google";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SmoothScroll } from "@/components/marketing/smooth-scroll";

import "./identity.css";

/**
 * Identity preview (scoped): the marketing routes use the proposed "Graphite & Highlighter" tokens and fonts via
 * `.brand-identity` (identity.css). The application keeps app/globals.css until the user approves the direction.
 * Host Grotesk (display), Atkinson Hyperlegible Next (text and UI), Atkinson Hyperlegible Mono (references and data):
 * all SIL OFL, variable weight, latin subset, self-hosted by next/font.
 */
const display = Host_Grotesk({ subsets: ["latin"], variable: "--font-host-grotesk", display: "swap" });
const text = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-atkinson-next", display: "swap" });
const mono = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], variable: "--font-atkinson-mono", display: "swap" });

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`brand-identity ${display.variable} ${text.variable} ${mono.variable} flex min-h-dvh flex-col`}>
      <SmoothScroll />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
