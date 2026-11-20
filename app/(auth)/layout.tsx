import Link from "next/link";

import { LegalLinks } from "@/components/legal/legal-links";
import { BatonLogo } from "@/components/shared/baton-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { routes } from "@/lib/routes";

/* The four evidence colours of the Baton mark, laid out as the landing's tile band (and Loopsii's hero mosaic).
   Decorative (aria-hidden): the legend under it says what the colours mean. */
const TILES = [
  "bg-status-sourced-soft", "bg-status-inferred", "", "bg-status-conflicting-soft", "bg-highlight", "bg-status-missing-soft",
  "bg-status-sourced", "", "bg-status-inferred-soft", "bg-foreground", "", "bg-status-conflicting",
  "", "bg-status-missing-soft", "bg-status-sourced-soft", "bg-status-inferred-soft", "bg-status-conflicting", "",
] as const;
const SHAPES = ["rounded-none", "rounded-tl-[100%]", "rounded-full", "rounded-br-[100%]", "rounded-t-full", "rounded-none"] as const;

const LEGEND = [
  { label: "Sourced", dot: "bg-status-sourced" },
  { label: "Inferred", dot: "bg-status-inferred" },
  { label: "Conflicting", dot: "bg-status-conflicting" },
  { label: "Missing", dot: "bg-status-missing" },
] as const;

/**
 * Sign-in frame. App redesign 2026-11-20: on wide screens a split page, the landing's world on the left (display
 * headline, hairline frame with corner handles, the evidence-colour tile band) and the form on the right, so the
 * landing, sign-in and workspace read as one product. Below `lg` only the form, under the logo.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(28rem,1fr)]">
      <div className="absolute top-3 right-3 z-10 sm:top-4 sm:right-4">
        <ThemeToggle />
      </div>

      <aside aria-label="About Baton" className="relative hidden flex-col justify-between border-r border-border p-10 lg:flex xl:p-14">
        <Link href={routes.home} aria-label="Baton home" className="self-start rounded-md outline-none focus-ring">
          <BatonLogo size="lg" />
        </Link>
        <div className="space-y-10">
          <p className="max-w-[14ch] font-display text-[clamp(2.75rem,1.5rem+2.6vw,4.25rem)] leading-[0.98] font-[640] tracking-[-0.035em] text-foreground">
            Every point has a receipt.
          </p>
          <div aria-hidden="true" className="frame-ticks p-6">
            <div className="grid grid-cols-6 gap-0">
              {TILES.map((tone, i) => (
                <div key={i} className={`aspect-square ${tone} ${tone ? SHAPES[(i * 5) % SHAPES.length] : ""}`} />
              ))}
            </div>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {LEGEND.map((l) => (
              <li key={l.label} className="inline-flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${l.dot}`} />
                {l.label}
              </li>
            ))}
          </ul>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Baton turns a project&rsquo;s chats and notes into a handover the next person can trust, with a source behind
          every point.
        </p>
      </aside>

      <div className="flex flex-col items-center justify-center px-4 py-12 sm:px-8">
        <Link href={routes.home} aria-label="Baton home" className="mb-10 rounded-md outline-none focus-ring lg:hidden">
          <BatonLogo size="lg" />
        </Link>
        <main id="main" className="w-full max-w-sm">
          {children}
        </main>
        <p className="mt-8 max-w-sm text-center text-caption text-muted-foreground">
          Want to look around first?{" "}
          <Link href={routes.demo} className="rounded-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
            Try the demo
          </Link>
          , no sign-in needed.
        </p>
        <LegalLinks className="mt-4 justify-center" />
      </div>
    </div>
  );
}
