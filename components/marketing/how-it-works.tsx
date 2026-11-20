import { Check, FileText, Lock, MessageSquareText } from "lucide-react";
import type { CSSProperties } from "react";

/**
 * "How it works" (reference: the stacked split cards). Four cards, each `position: sticky` from 1024 px with a rising
 * top offset, so earlier cards stay visible as tabs while the next one slides over them (GSAP shrinks and dims the
 * covered card, motion allowed only). Each card: a handwritten counter, the step, a short paragraph and a hairline
 * list on white; a colour panel holding the step's product fragment (fictional CodeCell data). Below 1024 px the
 * cards are a plain stack, text above panel.
 */

const STEPS = [
  {
    title: "Bring the record the team already has",
    body: "Export the WhatsApp groups and add handbooks, MoUs and notes. Choose the dates that matter and who may see each source.",
    list: ["WhatsApp group exports", "Handbooks, MoUs and notes", "The dates that matter", "Who may see each source"],
    tone: "var(--t-sky)",
    shot: "Sources",
    meta: ["2 chats", "1 document", "Aug – Nov 2026"],
  },
  {
    title: "Personal details are masked, then AI drafts",
    body: "Masking happens before anything is stored or sent to AI. Every quote the draft cites is matched against the original text, word for word, and checked separately to confirm it backs the point.",
    list: ["Masked before it's stored", "Quotes matched word for word", "A second, separate check"],
    tone: "var(--t-lime)",
    shot: "Quote check",
    meta: ["Parse", "Mask", "Extract", "Quote check", "Support check"],
  },
  {
    title: "People review every point",
    body: "The outgoing member and reviewers approve, edit or reject each point and settle disagreements. What no source covers goes to a short Gap Interview.",
    list: ["Approve, edit or reject", "Settle disagreements", "A Gap Interview for what's missing"],
    tone: "var(--t-mauve)",
    shot: "Review",
    meta: ["18 points", "2 waiting", "1 conflict", "1 gap"],
  },
  {
    title: "The next person reads it and signs",
    body: "The incoming person gets the handover and a first-week checklist, and acknowledges that they have read it.",
    list: ["The handover", "A first-week checklist", "Read and acknowledged"],
    tone: "var(--t-apricot)",
    shot: "Incoming handover",
    meta: ["Priya → Neha", "Technical lead", "Published 12 Nov"],
  },
] as const;

function Fragment({ i }: { i: number }) {
  if (i === 0) {
    return (
      <ul className="space-y-3 text-sm">
        {[
          { name: "WhatsApp Chat with CodeCell Core Team 26-27.txt", access: "Everyone", Icon: MessageSquareText },
          { name: "WhatsApp Chat with CodeCell Leads.txt", access: "Leads only", Icon: MessageSquareText },
          { name: "infra-notes.md", access: "Everyone", Icon: FileText },
        ].map(({ name, access, Icon }) => (
          <li key={name} className="flex items-center gap-2.5 rounded-xl bg-card px-3.5 py-3 shadow-soft">
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
      <div className="space-y-3 text-sm">
        <p className="rounded-xl bg-card px-3.5 py-3 leading-relaxed text-muted-foreground shadow-soft">
          …his number is <span className="bi-mono rounded-sm bg-foreground/10 px-1 text-[0.8em]">[PHONE_1]</span> if it&rsquo;s urgent
        </p>
        <p className="flex items-center gap-2 px-1">
          <Check aria-hidden="true" className="size-4 text-status-sourced" /> Quote found word for word, line 29
        </p>
        <p className="flex items-center gap-2 px-1">
          <Check aria-hidden="true" className="size-4 text-status-sourced" /> A second check confirmed it backs the point
        </p>
      </div>
    );
  }
  if (i === 2) {
    return (
      <div className="rounded-xl bg-card px-4 py-4 text-sm shadow-soft">
        <p className="font-semibold">Workshop fee for non-members</p>
        <p className="mt-2 text-muted-foreground">Supports · Priya, 4 Aug: &ldquo;non-members pay ₹100&rdquo;</p>
        <p className="text-muted-foreground">Contradicts · Kabir, 18 Sep: &ldquo;free for everyone&rdquo;</p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-1 text-caption font-medium">
          Record what&rsquo;s true now
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-card px-4 py-4 text-sm shadow-soft">
      <p className="font-semibold">First week</p>
      <p className="mt-2 flex items-center gap-2 text-muted-foreground">
        <span aria-hidden="true" className="size-3.5 shrink-0 rounded-sm border border-border-strong" /> Move the domain to the club card before 12 Dec
      </p>
      <p className="mt-4 border-t border-foreground pt-2 text-caption">Read and acknowledged · Neha Kulkarni</p>
    </div>
  );
}

export function HowItWorksSteps() {
  return (
    <ol className="lp-steps__list">
      {STEPS.map((s, i) => (
        <li key={s.title} data-step-card className="lp-card" style={{ "--i": i } as CSSProperties}>
          <div className="lp-card__text">
            <p aria-hidden="true" className="lp-hand">
              {i + 1}/{STEPS.length}
            </p>
            <h3 className="lp-h3 mt-4">
              <span className="sr-only">Step {i + 1}: </span>
              {s.title}
            </h3>
            <p className="lp-body mt-3 max-w-[46ch]">{s.body}</p>
            <ul className="lp-list max-w-[34rem]">
              {s.list.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
          <div aria-hidden="true" className="lp-card__panel" style={{ "--c": s.tone } as CSSProperties}>
            <div className="lp-card__shot">
              <div>
                <p className="lp-card__shot-title">{s.shot}</p>
                <ul className="-mt-2 flex flex-wrap gap-1.5">
                  {s.meta.map((m) => (
                    <li key={m} className="bi-mono rounded-full border border-border bg-card px-2.5 py-0.5 text-[0.6875rem] text-muted-foreground">
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-6">
                <Fragment i={i} />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
