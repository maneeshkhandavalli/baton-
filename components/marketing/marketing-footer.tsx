import { LegalLinks } from "@/components/legal/legal-links";
import { BatonLogo } from "@/components/shared/baton-logo";
import { siteConfig } from "@/config/site";

/**
 * The marketing routes' footer (reference: a small white card centred on the sky field, the name and year below).
 * Deliberately minimal: no product links, because every action is already one tap away (the header's "Sign in" or
 * "Open workspace", the closing card's demo and "Start a handover" right above). The only links are the legal pages.
 * On the landing page it continues the closing section's field; the workspace keeps its own layout.
 */
export function MarketingFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-foot__card">
        <BatonLogo size="sm" />
        <div className="mt-4 flex flex-col gap-1 border-t border-border pt-4 text-muted-foreground sm:flex-row sm:justify-between">
          <p>{siteConfig.tagline} for student clubs, project teams and volunteer organisations.</p>
          <p>© {siteConfig.name} 2026</p>
        </div>
        <LegalLinks className="mt-3" />
      </div>
    </footer>
  );
}
