import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { HelpMenu } from "@/components/onboarding/help-menu";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { routes } from "@/lib/routes";

import { MobileNav } from "./mobile-nav";

/** Compact workspace top bar below `lg`, drawn as the landing's floating header pill: logo, the theme switch, and a
 *  menu button that opens the navigation drawer. */
export function MobileHeader() {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5 lg:hidden">
      <div className="flex h-14 items-center justify-between gap-4 rounded-full border border-foreground/40 bg-background/85 pr-1 pl-5 backdrop-blur-md">
        <Link href={routes.dashboard} aria-label="Baton dashboard" className="rounded-md outline-none focus-ring">
          <BatonLogo size="md" />
        </Link>
        <div className="flex items-center gap-1">
          <HelpMenu size="lg" />
          <ThemeToggle size="icon-lg" />
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
