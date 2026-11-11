import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** Public marketing header. */
export function SiteHeader() {
  return (
    <header className="border-b border-border/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href={routes.home} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BatonLogo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
          <Link href={routes.demo} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "px-2 sm:px-2.5")}>
            Demo
          </Link>
          <Link href={routes.login} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "px-2 sm:px-2.5")}>
            Sign in
          </Link>
          <Link href={routes.dashboard} className={cn(buttonVariants({ size: "lg" }), "hidden sm:inline-flex")}>
            Open workspace
          </Link>
        </nav>
      </div>
    </header>
  );
}
