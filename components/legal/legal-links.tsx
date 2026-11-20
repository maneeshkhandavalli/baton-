import Link from "next/link";

import { cn } from "@/lib/utils";

import { LEGAL_PAGES_PUBLISHED } from "./published";

export { LEGAL_PAGES_PUBLISHED };

/** The three legal pages, in display order. */
export const LEGAL_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookies" },
] as const;

/**
 * Links to /privacy, /terms and /cookies. Used by the marketing footer, and meant for the sign-up and invitation
 * surfaces too, so every place that collects personal data points to the same notice. Not a call to action.
 */
export function LegalLinks({ className }: { className?: string }) {
  if (!LEGAL_PAGES_PUBLISHED) return null;
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground", className)}>
      {LEGAL_LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="underline-offset-4 hover:underline">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
