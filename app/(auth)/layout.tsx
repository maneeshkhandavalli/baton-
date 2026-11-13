import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { routes } from "@/lib/routes";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      {/* No sidebar here, so the theme switch sits in the corner. */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
        <ThemeToggle />
      </div>
      <Link
        href={routes.home}
        className="mb-10 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BatonLogo size="lg" />
      </Link>
      <main id="main" className="w-full max-w-sm">
        {children}
      </main>
    </div>
  );
}
