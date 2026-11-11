import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { routes } from "@/lib/routes";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
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
