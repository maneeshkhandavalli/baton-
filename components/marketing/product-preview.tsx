import { Check, CircleHelp } from "lucide-react";

import { EvidenceQuote } from "@/components/review/evidence-quote";
import { StatusBadge } from "@/components/shared/status-badge";

/** A static composition of the review UI for the landing page (illustrative, not live data). */
export function ProductPreview() {
  return (
    <div aria-hidden="true" className="relative select-none">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_60%_at_70%_30%,color-mix(in_srgb,var(--primary)_10%,transparent),transparent)]" />
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-raised">
          <div className="flex items-center gap-1.5">
            <StatusBadge status="sourced" size="sm" />
            <span className="text-xs text-muted-foreground">Account & access</span>
            <span className="ml-auto inline-flex h-5 items-center gap-1 rounded-md bg-status-sourced-soft px-1.5 text-[0.6875rem] font-medium text-status-sourced-fg">
              <Check className="size-3" /> Approved
            </span>
          </div>
          <p className="mt-2 text-[0.9375rem] font-semibold">GitHub organisation owners</p>
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
        <div className="ml-6 rounded-xl border border-border bg-card p-4 shadow-soft sm:ml-10">
          <div className="flex items-center gap-1.5">
            <StatusBadge status="conflicting" size="sm" />
            <span className="text-xs text-muted-foreground">Decision</span>
          </div>
          <p className="mt-2 text-sm font-semibold">Workshop fee for non-members</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <p className="rounded-md border-l-2 border-l-status-sourced bg-background/70 p-2 font-mono text-[0.6875rem] leading-relaxed">Non-members pay 100 for workshops…</p>
            <p className="rounded-md border-l-2 border-l-status-conflicting bg-background/70 p-2 font-mono text-[0.6875rem] leading-relaxed">workshops are free for EVERYONE…</p>
          </div>
        </div>
        <div className="mr-8 flex items-center gap-2.5 rounded-xl border border-dashed border-border-strong bg-card/70 p-3 text-sm text-status-missing-fg">
          <CircleHelp className="size-4 shrink-0" />
          Who holds the club bank account? <span className="ml-auto text-xs">Sent to Gap Interview</span>
        </div>
      </div>
    </div>
  );
}
