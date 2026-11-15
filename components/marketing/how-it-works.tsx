import { Check, FileText, Lock, MessageSquareText } from "lucide-react";

/**
 * "How it works" as a ledger: four rows on one rule (step · what happens · what you see). No cards; each row's
 * fragment is a small, plain piece of the product with fictional CodeCell data. Rows arrive in sequence (.reveal-group,
 * CSS scroll-driven; complete without it).
 */

const STEPS = [
  {
    title: "Bring the record the team already has",
    body: "Export the WhatsApp groups and add handbooks, MoUs and notes. Choose the dates that matter and who may see each source.",
  },
  {
    title: "Personal details are masked, then AI drafts",
    body: "Masking happens before anything is stored or sent to AI. Every quote the draft cites is matched against the original text, word for word, and checked separately to confirm it backs the point.",
  },
  {
    title: "People review every point",
    body: "The outgoing member and reviewers approve, edit or reject each point and settle disagreements. What no source covers goes to a short Gap Interview.",
  },
  {
    title: "The next person reads it and signs",
    body: "The incoming person gets the handover and a first-week checklist, and acknowledges that they have read it.",
  },
] as const;

function Fragment({ i }: { i: number }) {
  if (i === 0) {
    return (
      <ul className="space-y-2 text-sm">
        {[
          { name: "WhatsApp Chat with CodeCell Core Team 26-27.txt", access: "Everyone", Icon: MessageSquareText },
          { name: "WhatsApp Chat with CodeCell Leads.txt", access: "Leads only", Icon: MessageSquareText },
          { name: "infra-notes.md", access: "Everyone", Icon: FileText },
        ].map(({ name, access, Icon }) => (
          <li key={name} className="flex items-center gap-2.5">
            <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{name}</span>
            <span className="bi-mono ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {access === "Leads only" ? <Lock aria-hidden="true" className="size-3" /> : null}
              {access}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (i === 1) {
    return (
      <div className="space-y-2 text-sm">
        <p className="leading-relaxed text-muted-foreground">
          …his number is <span className="bi-mono rounded-sm bg-foreground/10 px-1 text-[0.8em]">[PHONE_1]</span> if it&rsquo;s urgent
        </p>
        <p className="flex items-center gap-2">
          <Check aria-hidden="true" className="size-4 text-status-sourced" /> Quote found word for word, line 29
        </p>
        <p className="flex items-center gap-2">
          <Check aria-hidden="true" className="size-4 text-status-sourced" /> A second check confirmed it backs the point
        </p>
      </div>
    );
  }
  if (i === 2) {
    return (
      <div className="text-sm">
        <p className="font-semibold">Workshop fee for non-members</p>
        <p className="mt-1 text-muted-foreground">Supports · Priya, 4 Aug: &ldquo;non-members pay ₹100&rdquo;</p>
        <p className="text-muted-foreground">Contradicts · Kabir, 18 Sep: &ldquo;free for everyone&rdquo;</p>
        <p className="mt-2 inline-flex items-center gap-2 rounded-md border border-border-strong px-2 py-1 text-caption font-medium">
          Record what&rsquo;s true now
        </p>
      </div>
    );
  }
  return (
    <div className="text-sm">
      <p className="font-semibold">First week</p>
      <p className="mt-1 flex items-center gap-2 text-muted-foreground">
        <span aria-hidden="true" className="size-3.5 shrink-0 rounded-sm border border-border-strong" /> Move the domain to the club card before 12 Dec
      </p>
      <p className="mt-3 border-t border-foreground pt-2 text-caption">Read and acknowledged · Neha Kulkarni</p>
    </div>
  );
}

export function HowItWorksSteps() {
  return (
    <ol className="reveal-group mt-10 border-b border-border">
      {STEPS.map((s, i) => (
        <li key={s.title} className="grid gap-4 border-t border-border py-7 md:grid-cols-[3rem_1fr_1fr] md:gap-8 lg:py-8 [&>*]:min-w-0">
          <span className="bi-mono text-sm text-muted-foreground tabular-nums">
            <span className="sr-only">Step </span>
            {String(i + 1).padStart(2, "0")}
          </span>
          <div>
            <h3 className="bi-h3">{s.title}</h3>
            <p className="bi-body mt-2 max-w-[48ch]">{s.body}</p>
          </div>
          <div aria-hidden="true" className="rounded-md bg-muted/60 p-4">
            <Fragment i={i} />
          </div>
        </li>
      ))}
    </ol>
  );
}
