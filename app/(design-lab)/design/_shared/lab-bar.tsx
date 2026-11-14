"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const CONCEPTS = [
  { href: "/design/a", key: "A", name: "Ridgeline" },
  { href: "/design/b", key: "B", name: "Dossier" },
  { href: "/design/c", key: "C", name: "Relay" },
  { href: "/design/d", key: "D", name: "Threads" },
] as const;

/** Design-lab chrome only: a small switcher pinned bottom-left so the concepts can be compared quickly. */
export function LabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Design concepts"
      className="fixed bottom-3 left-3 z-[70] flex items-center gap-0.5 rounded-full border border-black/10 bg-white/90 p-1 font-sans text-[12px] text-neutral-900 shadow-[0_4px_20px_rgba(0,0,0,0.12)] backdrop-blur"
    >
      <Link href="/design" className="rounded-full px-2.5 py-1 font-medium text-neutral-500 hover:text-neutral-900">
        Lab
      </Link>
      {CONCEPTS.map((c) => {
        const active = pathname === c.href;
        return (
          <Link
            key={c.key}
            href={c.href}
            aria-current={active ? "page" : undefined}
            title={c.name}
            className={active ? "rounded-full bg-neutral-900 px-2.5 py-1 font-semibold text-white" : "rounded-full px-2.5 py-1 font-medium hover:bg-black/5"}
          >
            {c.key}
            <span className="hidden sm:inline"> {c.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
