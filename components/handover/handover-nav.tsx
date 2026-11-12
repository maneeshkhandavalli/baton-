"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

import { handoverNav } from "@/config/navigation";
import { cn } from "@/lib/utils";

/**
 * Tab navigation between the stages of a single handover.
 *
 * Reads the handover id from the URL. Because the id is a dynamic param,
 * render inside <Suspense> (see app/(workspace)/handover/[id]/layout.tsx).
 */
export function HandoverNav() {
  const pathname = usePathname();
  const { id } = useParams<{ id: string }>();

  return (
    <nav aria-label="Handover sections" className="-mb-px overflow-x-auto [scrollbar-width:none]">
      <ul className="flex gap-6">
        {handoverNav.map(({ title, href }) => {
          const target = href(id);
          const active = pathname === target;

          return (
            <li key={title}>
              <Link
                href={target}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center border-b-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/40",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Same-height placeholder shown while the nav resolves. */
export function HandoverNavFallback() {
  return <div aria-hidden="true" className="h-11" />;
}
