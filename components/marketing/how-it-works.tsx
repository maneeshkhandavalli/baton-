import { Check, FileText, Lock, MessageSquareText } from "lucide-react";

/**
 * "How it works": four numbered cards (step · what happens · what you see). Each card's fragment is a small, plain
 * piece of the product with fictional CodeCell data. Cards arrive in sequence (.reveal-group, CSS scroll-driven;
 * complete without it) and lift slightly under a pointer.
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
    <ol className="reveal-group mt-12 grid gap-5 md:grid-cols-2 lg:gap-6">
      {STEPS.map((s, i) => (
        <li key={s.title} className="bi-card bi-lift flex min-w-0 flex-col gap-6 p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <span className="bi-mono grid size-10 shrink-0 place-items-center rounded-full bg-foreground text-sm text-background tabular-nums">
              <span className="sr-only">Step </span>
              {i + 1}
            </span>
            <div className="min-w-0">
              <h3 className="bi-h3 text-[1.25rem]">{s.title}</h3>
              <p className="bi-body mt-2 max-w-[48ch]">{s.body}</p>
            </div>
          </div>
          <div aria-hidden="true" className="bi-inset mt-auto p-4 sm:p-5">
            <Fragment i={i} />
          </div>
        </li>
      ))}
    </ol>
  );
}
