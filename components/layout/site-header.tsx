import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/** Public marketing header. */
export function SiteHeader() {
  return (
    <header className="border-b border-border/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href={routes.home}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BatonLogo />
        </Link>
        <nav aria-label="Main">
          <Link href={routes.login} className={buttonVariants({ variant: "ghost", size: "lg" })}>
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
