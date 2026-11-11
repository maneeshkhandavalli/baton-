import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { FadeIn } from "@/components/shared/fade-in";
import { StatusBadge } from "@/components/shared/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { routes } from "@/lib/routes";
import { EVIDENCE_STATUSES } from "@/types/status";

export default function HomePage() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col px-4 pt-20 pb-24 sm:px-6 sm:pt-28">
      <FadeIn className="max-w-3xl space-y-6">
        <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
          {siteConfig.tagline}
        </p>
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight text-balance sm:text-6xl">
          Pass on what your team knows, <em className="text-primary">with the receipts.</em>
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">
          {siteConfig.description}
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link href={routes.login} className={buttonVariants({ size: "lg", className: "h-10 px-4" })}>
            Get started
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </div>
      </FadeIn>

      <FadeIn delay={0.15} className="mt-16">
        <ul aria-label="Evidence statuses" className="flex flex-wrap gap-2">
          {EVIDENCE_STATUSES.map((status) => (
            <li key={status}>
              <StatusBadge status={status} />
            </li>
          ))}
        </ul>
      </FadeIn>
    </section>
  );
}
