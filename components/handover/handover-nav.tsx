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
    <nav aria-label="Handover sections" className="w-full overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul ref={listRef} className="inline-flex gap-1 rounded-full border border-border bg-card p-1">
        {visibleHandoverNav(viewerRole).map(({ title, href }) => {
          const target = href(id);
          const active = pathname === target;

          return (
            <li key={title}>
              <Link
                href={target}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring inline-flex h-10 items-center rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 sm:h-9",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
  return <div aria-hidden="true" className="h-[3.5rem]" />;
}
