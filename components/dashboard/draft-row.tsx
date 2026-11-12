import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { formatDate } from "@/components/handover/format";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { DiscardDraftButton } from "./discard-draft-button";
import type { HandoverCardData } from "./handover-card";

const DRAFT_STEPS = ["Details", "Consent and sources", "Finish uploads", "Scope and start"] as const;

/**
 * A draft the viewer can resume: what is saved, the next step and an explicit Continue button.
 * Rows (not cards) so unfinished work reads as a to-do list above the finished handovers.
 */
export function DraftRow({ data, preview = false }: { data: HandoverCardData; preview?: boolean }) {
  const { handover: h, href, draft } = data;
  if (!draft) return null;
  const nextIndex = Math.max(1, DRAFT_STEPS.indexOf(draft.next as (typeof DRAFT_STEPS)[number]));
  return (
    <li className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="min-w-0 truncate type-eyebrow text-muted-foreground">{h.teamName}</p>
        <h3 className="type-heading [overflow-wrap:anywhere]">
          <Link href={href} className="rounded-sm hover:underline hover:underline-offset-4">
            {h.title}
          </Link>
        </h3>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
          <span suppressHydrationWarning>Last saved {formatDate(h.updatedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {draft.sources === 0 ? "No sources yet" : draft.sources === 1 ? "1 source saved" : `${draft.sources} sources saved`}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="hidden min-w-36 md:block" aria-hidden="true">
          <p className="text-caption text-muted-foreground">
            Next: <span className="font-medium text-foreground">{draft.next}</span>
          </p>
          <div className="mt-1.5 flex gap-1">
            {DRAFT_STEPS.map((s, i) => (
              <span key={s} className={cn("h-1 flex-1 rounded-full", i < nextIndex ? "bg-primary" : "bg-border")} />
            ))}
          </div>
        </div>
        <p className="text-caption text-muted-foreground md:hidden">
          Next: <span className="font-medium text-foreground">{draft.next}</span>
        </p>
        <div className="ml-auto flex items-center gap-1">
          {h.viewerIsCreator && <DiscardDraftButton handoverId={h.id} title={h.title} disabled={preview} />}
          <Link href={href} className={buttonVariants()}>
            Continue
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </div>
      </div>
    </li>
  );
}
