import { Check, FileText, Lock, MessageSquareText, Pencil, ScanSearch, X } from "lucide-react";

/**
 * "How it works": four steps, each with a small, real piece of the product (fictional CodeCell data), joined by a rule
 * that fills as the section scrolls through the viewport (the page's one scroll-linked moment; CSS only, complete and
 * static without support or under reduced motion). Copy matches the previous landing.
 */

const STEPS = [
  {
    title: "Bring the real record",
    body: "Export the team's WhatsApp groups and add handbooks, MoUs and notes. Choose the dates and conversations that matter, and who may see each source.",
    visual: "sources",
  },
  {
    title: "Baton drafts, with receipts",
    body: "Personal details are masked first. AI then drafts the handover, and every quote it cites is matched against the original text and checked separately to confirm it backs the point.",
    visual: "draft",
  },
  {
    title: "People review every claim",
    body: "The outgoing member and reviewers approve, edit or reject each point and settle disagreements. Whatever no source covers goes to a short Gap Interview.",
    visual: "review",
  },
  {
    title: "Hand over with confidence",
    body: "The incoming person gets a clear handover and a first-week checklist, and acknowledges that they have read it.",
    visual: "handover",
  },
] as const;

function Visual({ kind }: { kind: (typeof STEPS)[number]["visual"] }) {
  if (kind === "sources") {
    return (
      <ul className="space-y-1.5">
        {[
          { name: "Core Team 26-27.txt", access: "Everyone", Icon: MessageSquareText },
          { name: "CodeCell Leads.txt", access: "Leads only", Icon: MessageSquareText },
          { name: "infra-notes.md", access: "Everyone", Icon: FileText },
        ].map(({ name, access, Icon }) => (
          <li key={name} className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{name}</span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
              {access === "Leads only" ? <Lock className="size-2.5" /> : null}
              {access}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (kind === "draft") {
    return (
      <div className="space-y-1.5 text-xs">
        <p className="rounded-md border border-border bg-background px-2 py-1.5 leading-relaxed">
          office line <span className="rounded bg-foreground/8 px-1 text-[0.85em] text-muted-foreground">[PHONE_1]</span>
        </p>
        <p className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
          <ScanSearch className="size-3.5 shrink-0 text-status-sourced" />
          Quote found word for word
          <Check className="ml-auto size-3.5 text-status-sourced" />
        </p>
        <p className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
          <Check className="size-3.5 shrink-0 text-status-sourced" />
          Support checked separately
        </p>
      </div>
    );
  }
  if (kind === "review") {
    return (
      <div className="space-y-2 text-xs">
        <p className="truncate rounded-md border border-border bg-background px-2 py-1.5">Workshop fee for non-members</p>
        <div className="flex gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-success px-2 py-1 font-medium text-success-foreground">
            <Check className="size-3" /> Approve
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-background px-2 py-1">
            <Pencil className="size-3" /> Edit
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-destructive/35 bg-background px-2 py-1 text-destructive-fg">
            <X className="size-3" /> Reject
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-background p-2 text-xs">
      <p className="font-medium">First week</p>
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-3 shrink-0 rounded-sm border border-border-strong" /> Move the domain to the club card
      </p>
      <p className="mt-1.5 border-t border-border pt-1.5 text-2xs text-muted-foreground">
        <Check className="mr-1 inline size-3 text-success" />
        Read and acknowledged · Neha Kulkarni
      </p>
    </div>
  );
}

export function HowItWorksSteps() {
  return (
    <div className="relative mt-12 lg:mt-14">
      {/* The rule that joins the steps (desktop), filling as the section scrolls */}
      <div aria-hidden="true" className="absolute top-[1.125rem] right-[12.5%] left-[12.5%] hidden h-px bg-border xl:block">
        <div className="how-progress h-full origin-left bg-primary/70" />
      </div>
      <ol className="reveal-group relative grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex flex-col">
            <span className="mx-auto hidden size-9 items-center justify-center rounded-full border border-border bg-background font-mono text-xs text-muted-foreground xl:flex">
              <span className="sr-only">Step </span>0{i + 1}
            </span>
            <div className="flex flex-1 flex-col rounded-2xl border border-border bg-card p-5 shadow-xs transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-raised sm:p-6 xl:mt-4">
              <span className="font-mono text-xs text-muted-foreground xl:hidden">0{i + 1}</span>
              <h3 className="mt-1 type-heading xl:mt-0">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              <div aria-hidden="true" className="mt-auto pt-5">
                <Visual kind={step.visual} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
