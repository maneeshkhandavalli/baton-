import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** In-page sections of the landing page. Absolute (`/#…`) so they also work from /demo. */
const SECTIONS = [
  { href: `${routes.home}#how-it-works`, label: "How it works" },
  { href: `${routes.home}#evidence`, label: "Evidence" },
  { href: `${routes.home}#privacy`, label: "Privacy" },
] as const;

/** Public marketing header: translucent paper, sticky, one primary action. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md supports-backdrop-filter:bg-background/70">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-raised"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href={routes.home} aria-label="Baton home" className="shrink-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          <BatonLogo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <ul className="mr-2 hidden items-center gap-1 md:flex">
            {SECTIONS.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className={cn(buttonVariants({ variant: "ghost" }), "px-3 text-muted-foreground hover:text-foreground")}>
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link href={routes.demo} className={cn(buttonVariants({ variant: "ghost" }), "px-2.5 sm:px-3")}>
            Demo
          </Link>
          <Link href={routes.login} className={cn(buttonVariants({ variant: "ghost" }), "px-2.5 sm:px-3")}>
            Sign in
          </Link>
          <ThemeToggle />
          <Link href={routes.dashboard} className={cn(buttonVariants(), "ml-1 hidden sm:inline-flex")}>
            Open workspace
          </Link>
        </nav>
      </div>
    </header>
  );
}
