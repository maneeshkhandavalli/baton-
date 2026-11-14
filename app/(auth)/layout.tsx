import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { routes } from "@/lib/routes";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-x-clip px-4 py-12">
      {/* Same soft primary glow as the landing page preview, so sign-in feels like the same product. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(50%_60%_at_50%_0%,color-mix(in_srgb,var(--primary)_9%,transparent),transparent)]"
      />
      {/* No sidebar here, so the theme switch sits in the corner. */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
        <ThemeToggle />
      </div>
      <Link href={routes.home} aria-label="Baton home" className="mb-10 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
        <BatonLogo size="lg" />
      </Link>
      <main id="main" className="w-full max-w-sm">
        {children}
      </main>
      <p className="mt-8 text-center text-caption text-muted-foreground">
        Want to look around first?{" "}
        <Link href={routes.demo} className="rounded-sm font-medium text-primary-fg underline-offset-4 hover:underline">
          Try the demo
        </Link>
        , no sign-in needed.
      </p>
    </div>
  );
}
