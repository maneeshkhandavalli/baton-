import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { buttonVariants } from "@/components/ui/button";
import { routes } from "@/lib/routes";

export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center"
    >
      <BatonLogo />
      <div className="space-y-2">
        <h1 className="font-serif text-4xl">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          This page doesn&rsquo;t exist, or the link has expired.
        </p>
      </div>
      <Link href={routes.home} className={buttonVariants({ variant: "outline", size: "lg" })}>
        Back to Baton
      </Link>
    </main>
  );
}
