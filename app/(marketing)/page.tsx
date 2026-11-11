import Link from "next/link";
import { ArrowRight, Eye, FileLock2, ListChecks, MessagesSquare, ShieldCheck, Upload } from "lucide-react";

import { ProductPreview } from "@/components/marketing/product-preview";
import { FadeIn } from "@/components/shared/fade-in";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { statusConfig } from "@/config/status";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { EVIDENCE_STATUSES } from "@/types/status";

const STEPS = [
  {
    icon: Upload,
    title: "Bring the real record",
    body: "Export the team's WhatsApp groups and add handbooks, MoUs and notes. Choose the dates and conversations that matter, and who may see each source.",
  },
  {
    icon: ListChecks,
    title: "Review every claim",
    body: "Baton drafts decisions, owners, open work, risks, contacts and access, each with the exact quote behind it. You approve, edit or reject, and resolve disagreements.",
  },
  {
    icon: MessagesSquare,
    title: "Fill the gaps, then hand over",
    body: "What no source covers goes to a short Gap Interview. The incoming person gets a clear handover, a first-week checklist, and acknowledges it.",
  },
] as const;

const PRIVACY = [
  { icon: ShieldCheck, title: "Masked first", body: "Phone numbers, emails, UPI handles, bank details, IDs and passwords are masked before anything is stored or sent to AI." },
  { icon: FileLock2, title: "Raw files deleted", body: "Your uploads are deleted as soon as processing succeeds. Only masked, permitted evidence is kept." },
  { icon: Eye, title: "Access by source", body: "Mark a chat as leads-only or reviewer-only, and every point drawn from it inherits that restriction." },
] as const;

export default function HomePage() {
  return (
    <>
      <section className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] items-center overflow-x-clip gap-14 px-4 pt-16 pb-20 sm:px-6 sm:pt-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
        <FadeIn className="space-y-6">
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">{siteConfig.tagline}</p>
          <h1 className="font-serif text-5xl leading-[1.04] tracking-tight text-balance sm:text-6xl lg:text-[4.25rem]">
            Hand over a project <em className="text-primary">without losing what matters.</em>
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
            When someone leaves a club role or project team, the knowledge usually leaves with them. Baton turns your chats and documents into a handover where
            every decision, owner and open task links back to the message it came from.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link href={routes.handover.new} className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}>
              Start a handover
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
            <Link href={routes.demo} className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-10 px-4")}>
              Try the demo
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">The demo is a fictional college coding club. No sign-in needed.</p>
        </FadeIn>
        <FadeIn delay={0.15}>
          <ProductPreview />
        </FadeIn>
      </section>

      <section className="border-y border-border/70 bg-card/50">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-2xl space-y-3">
            <h2 className="font-serif text-4xl leading-tight tracking-tight">Every point shows how sure you can be.</h2>
            <p className="text-muted-foreground">
              Baton never presents a guess as a fact. Each point carries one of four labels, worked out from the evidence rather than set by hand.
            </p>
          </div>
          <dl className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {EVIDENCE_STATUSES.map((s) => (
              <div key={s} className="space-y-3">
                <dt>
                  <StatusBadge status={s} />
                </dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">
                  {s === "sourced" && "A quote that exists word for word in the source, checked separately to make sure it actually backs the claim."}
                  {s === "inferred" && "A reasonable reading with no quote that states it outright. A reviewer must confirm it before it's published."}
                  {s === "conflicting" && "Sources disagree. Both sides stay visible, newest first, until a person records what's true now."}
                  {s === "missing" && "Something a handover should cover that nobody wrote down. It becomes a Gap Interview question."}
                  <span className="sr-only"> {statusConfig[s].description}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <h2 className="max-w-2xl font-serif text-4xl leading-tight tracking-tight">From group chat to handover in an afternoon.</h2>
        <ol className="mt-12 grid gap-10 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                <span className="h-px flex-1 bg-border" />
                <step.icon aria-hidden="true" className="size-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-sidebar text-sidebar-foreground">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            <h2 className="font-serif text-4xl leading-tight tracking-tight">Built for group chats full of phone numbers.</h2>
            <p className="text-sidebar-muted-foreground">
              Student and volunteer groups run on WhatsApp. Baton is designed so that sharing those chats for a handover doesn&rsquo;t mean sharing everyone&rsquo;s
              details. You confirm the group was told, and anyone can ask to be left out.
            </p>
          </div>
          <ul className="grid gap-6 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {PRIVACY.map((p) => (
              <li key={p.title} className="space-y-2">
                <p.icon aria-hidden="true" className="size-5 text-sidebar-ring" />
                <h3 className="font-semibold">{p.title}</h3>
                <p className="text-sm leading-relaxed text-sidebar-muted-foreground">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-24">
        <h2 className="mx-auto max-w-2xl font-serif text-4xl leading-tight tracking-tight text-balance sm:text-5xl">The next person shouldn&rsquo;t have to start from scratch.</h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={routes.handover.new} className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}>
            Start a handover
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
          <Link href={routes.demo} className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-10 px-4")}>
            Explore the CodeCell demo
          </Link>
        </div>
      </section>
    </>
  );
}
