"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { visibleHandoverNav } from "@/config/handover-navigation";
import type { MemberRole } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

/**
 * Tab navigation between the stages of a single handover.
 *
 * Reads the handover id from the URL. Because the id is a dynamic param,
 * render inside <Suspense> (see app/(workspace)/handover/[id]/layout.tsx).
 */
export function HandoverNav({ viewerRole = null }: { viewerRole?: MemberRole | null } = {}) {
  const pathname = usePathname();
  const { id } = useParams<{ id: string }>();
  const listRef = useRef<HTMLUListElement>(null);

  // On narrow screens the tabs scroll sideways: keep the current one in view (R3 Task 06).
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav aria-label="Handover sections" className="-mb-px overflow-x-auto [scrollbar-width:none]">
      <ul ref={listRef} className="flex gap-5 sm:gap-6">
        {visibleHandoverNav(viewerRole).map(({ title, href }) => {
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
