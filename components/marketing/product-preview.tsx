import { Check, CircleHelp } from "lucide-react";

import { EvidenceQuote } from "@/components/review/evidence-quote";
import { BatonMark } from "@/components/shared/baton-logo";
import { StatusBadge } from "@/components/shared/status-badge";

/**
 * A static composition of the review UI for the landing page (illustrative, not live data).
 * The illustration itself is hidden from assistive tech; the caption below says what it shows.
 */
export function ProductPreview() {
  return (
    <figure className="relative">
      <div aria-hidden="true" className="relative select-none">
        <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_60%_at_70%_30%,color-mix(in_srgb,var(--primary)_10%,transparent),transparent)]" />
        <div className="overflow-hidden rounded-2xl border border-border bg-background/60 shadow-raised">
          {/* Window bar: which handover this is and where it stands. */}
          <div className="flex items-center gap-2.5 border-b border-border bg-card px-4 py-2.5">
            <BatonMark size="sm" />
            <p className="min-w-0 truncate text-caption font-medium">CodeCell · Technical lead handover</p>
            <span className="ml-auto shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
              In review
            </span>
          </div>

          <div className="space-y-3 p-3 sm:p-4">
            <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status="sourced" size="sm" />
                <span className="text-xs text-muted-foreground">Account &amp; access</span>
                <span className="ml-auto inline-flex h-5 items-center gap-1 rounded-md bg-status-sourced-soft px-1.5 text-2xs font-medium text-status-sourced-fg">
                  <Check className="size-3" /> Approved
                </span>
              </div>
              <p className="mt-2 text-md font-semibold">GitHub organisation owners</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Priya and Kabir own codecell-org. Credentials live in the club vault.</p>
              <EvidenceQuote
                className="mt-3"
                quote="github org owners are me and kabir. creds in the bitwarden core vault, master password is [PASSWORD]"
                kind="source_quote"
                authorLabel="Priya Raman"
                sentAt="2026-05-20T10:20:00.000Z"
                sourceTitle="Core Team (WhatsApp)"
                tone="supports"
              />
            </div>

            <div className="rounded-xl border border-border bg-card p-4 shadow-xs sm:ml-8">
              <div className="flex items-center gap-1.5">
                <StatusBadge status="conflicting" size="sm" />
                <span className="text-xs text-muted-foreground">Decision</span>
              </div>
              <p className="mt-2 text-sm font-semibold">Workshop fee for non-members</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <p className="rounded-md border-l-2 border-l-status-sourced bg-muted/40 p-2 font-mono text-2xs leading-relaxed">Non-members pay 100 for workshops…</p>
                <p className="rounded-md border-l-2 border-l-status-conflicting bg-muted/40 p-2 font-mono text-2xs leading-relaxed">
                  workshops are free for EVERYONE…
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-dashed border-border-strong bg-card/70 p-3 text-sm text-status-missing-fg sm:mr-8">
              <CircleHelp className="size-4 shrink-0" />
              <span>Who holds the club bank account?</span>
              <span className="ml-auto text-xs">Sent to Gap Interview</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-center text-caption text-muted-foreground">
        Illustration of the review screen, using the fictional CodeCell demo. The password was masked before anything was stored.
      </figcaption>
    </figure>
  );
}
