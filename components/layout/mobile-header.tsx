import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { routes } from "@/lib/routes";

import { MobileNav } from "./mobile-nav";

/** Compact workspace top bar below `lg`: logo + a menu button that opens the navigation drawer. */
export function MobileHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-sidebar-border bg-background/90 backdrop-blur-md supports-backdrop-filter:bg-background/75 lg:hidden">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <Link href={routes.dashboard} aria-label="Baton dashboard" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <BatonLogo size="sm" />
        </Link>
        <MobileNav />
      </div>
    </header>
  );
}
