import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 py-16 text-center">
      <BatonLogo />
      <p className="mt-12 type-eyebrow text-muted-foreground">404</p>
      <h1 className="mt-3 type-page-title">This page isn&rsquo;t here</h1>
      <p className="mt-3 max-w-md type-body text-muted-foreground">
        The link may be mistyped, or the handover was removed or isn&rsquo;t shared with you. Private links can also expire.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Link href={routes.dashboard} className={buttonVariants({ size: "lg" })}>
          Go to your dashboard
        </Link>
        <Link href={routes.home} className={buttonVariants({ size: "lg", variant: "outline" })}>
          Baton home
        </Link>
      </div>
    </main>
  );
}
