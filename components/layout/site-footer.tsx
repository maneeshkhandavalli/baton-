import { BatonMark } from "@/components/shared/baton-logo";
import { siteConfig } from "@/config/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <BatonMark size="sm" />
          <span>{siteConfig.tagline}</span>
        </div>
        <p>{siteConfig.name}</p>
      </div>
    </footer>
  );
}
