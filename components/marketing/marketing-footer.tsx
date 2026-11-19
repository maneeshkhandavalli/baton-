import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { siteConfig } from "@/config/site";
import { routes } from "@/lib/routes";

const LINKS = [
  { href: routes.demo, label: "Demo" },
  { href: routes.handover.new, label: "Start a handover" },
  { href: routes.login, label: "Sign in" },
] as const;

/**
 * The marketing routes' footer (reference: a small white card centred on the sky field, links on one row, the
 * name and year below). On the landing page it continues the closing section's field; the workspace keeps its own
 * layout.
 */
export function MarketingFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-foot__card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <BatonLogo size="sm" />
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-4 flex flex-col gap-1 border-t border-border pt-4 text-muted-foreground sm:flex-row sm:justify-between">
          <p>{siteConfig.tagline} for student clubs, project teams and volunteer organisations.</p>
          <p>© {siteConfig.name} 2026</p>
        </div>
      </div>
    </footer>
  );
}
