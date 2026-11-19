import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Suspense } from "react";

import { HeaderAccount } from "@/components/layout/header-account";
import { BatonLogo } from "@/components/shared/baton-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { routes } from "@/lib/routes";

import { MarketingNavShell } from "./marketing-nav-shell";

/** In-page sections of the landing page. Absolute (`/#…`) so they also work from /demo. */
const SECTIONS = [
  { href: `${routes.home}#how-it-works`, label: "How it works" },
  { href: `${routes.home}#evidence`, label: "Evidence" },
  { href: `${routes.home}#privacy`, label: "Privacy" },
  { href: `${routes.home}#for-the-nerds`, label: "For the nerds" },
  { href: routes.demo, label: "Demo" },
] as const;

/**
 * The marketing routes' header (reference: a floating pill, fixed, blurred, full width at the top of the page and a
 * compact centred pill once scrolled, light-on-dark over the dark band; see marketing-nav-shell.tsx). The section
 * links show from 1024 px; below that the pill keeps the logo, the theme toggle, the account menu and the primary
 * action, as the reference does. "Open workspace" sends a signed-out visitor to sign in. A signed-in visitor also
 * sees their account menu (HeaderAccount, streamed in; nothing while it loads or when signed out).
 * The workspace keeps its own header (components/layout); this one is only used by app/(marketing)/layout.tsx.
 */
export function MarketingHeader() {
  return (
    <MarketingNavShell>
      <a
        href="#main"
        className="sr-only pointer-events-auto focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-raised"
      >
        Skip to content
      </a>
      <div className="lp-nav__body">
        <Link href={routes.home} aria-label="Baton home" className="shrink-0 rounded-md outline-none focus-ring">
          <BatonLogo size="lg" />
        </Link>
        <nav aria-label="Main" className="lp-nav__links">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href}>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Suspense fallback={null}>
            <HeaderAccount />
          </Suspense>
          <Link href={routes.dashboard} className="lp-cta ml-1">
            <span aria-hidden="true" className="lp-cta__disc max-sm:hidden">
              <ArrowUpRight className="size-4" />
            </span>
            <span className="lp-cta__label">
              <span className="sm:hidden">Workspace</span>
              <span className="hidden sm:inline">Open workspace</span>
            </span>
          </Link>
        </div>
      </div>
    </MarketingNavShell>
  );
}
