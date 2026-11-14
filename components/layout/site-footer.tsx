import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { siteConfig } from "@/config/site";
import { routes } from "@/lib/routes";

const LINKS = [
  { href: routes.demo, label: "Demo" },
  { href: routes.handover.new, label: "Start a handover" },
  { href: routes.login, label: "Sign in" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-sm space-y-3">
          <BatonLogo size="sm" />
          <p className="text-sm leading-relaxed text-muted-foreground">{siteConfig.tagline} for student clubs, project teams and volunteer organisations.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="rounded-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
