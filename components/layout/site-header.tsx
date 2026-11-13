import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** Public marketing header: translucent paper, sticky, one primary action. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href={routes.home} aria-label="Baton home" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <BatonLogo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <Link href={routes.demo} className={cn(buttonVariants({ variant: "ghost" }), "px-2.5 sm:px-3")}>
            Demo
          </Link>
          <Link href={routes.login} className={cn(buttonVariants({ variant: "ghost" }), "px-2.5 sm:px-3")}>
            Sign in
          </Link>
          <ThemeToggle />
          <Link href={routes.dashboard} className={cn(buttonVariants(), "hidden sm:inline-flex")}>
            Open workspace
          </Link>
        </nav>
      </div>
    </header>
  );
}
