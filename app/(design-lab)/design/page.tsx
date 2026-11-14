import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Baton design lab" };

const CONCEPTS = [
  {
    href: "/design/a",
    key: "A",
    name: "Ridgeline",
    line: "Atmospheric editorial. Faded layered ridges, cool mist, light-weight grotesk, a map legend for evidence.",
    type: "Hanken Grotesk",
    swatches: ["#eef0ee", "#dde1de", "#8b9490", "#1f2724"],
  },
  {
    href: "/design/b",
    key: "B",
    name: "Dossier",
    line: "Archival print. The handover as a file: index cards, stamps, redaction, marginal notes, a signature line.",
    type: "Newsreader + IBM Plex Mono",
    swatches: ["#e8e2d4", "#f2ede2", "#23211e", "#2b4a8b"],
  },
  {
    href: "/design/c",
    key: "C",
    name: "Relay",
    line: "Contemporary Swiss. Expanded grotesk, asymmetric grid, monochrome with one orange baton that travels the page.",
    type: "Archivo (width axis) + JetBrains Mono",
    swatches: ["#f2f2ef", "#e6e6e2", "#141414", "#f2541b"],
  },
  {
    href: "/design/d",
    key: "D",
    name: "Threads",
    line: "Experimental, dark. From noise to receipts: drifting chat, a chat/handover toggle, threads drawn between quote and claim.",
    type: "Bricolage Grotesque + Martian Mono",
    swatches: ["#0f1110", "#161917", "#e8e6df", "#c9f26a"],
  },
] as const;

/** The lab's front page: the four directions, same content, different art direction. */
export default function DesignLab() {
  return (
    <main className="min-h-[100dvh] bg-[#f4f4f2] px-5 py-16 text-[#151515] md:px-10">
      <div className="mx-auto max-w-[1100px]">
        <h1 className="text-[clamp(32px,4vw,52px)] leading-[1.05] font-semibold tracking-[-0.03em]">Baton, four directions</h1>
        <p className="mt-4 max-w-[60ch] text-[17px] leading-relaxed text-[#555]">
          Each concept renders the same copy, the same CodeCell sample, the same sections and the same calls to action. Only the art direction changes.
          Dev-only and isolated: nothing here is linked from the app.
        </p>
        <ol className="mt-12 grid gap-px bg-black/10 md:grid-cols-2">
          {CONCEPTS.map((c) => (
            <li key={c.key} className="bg-[#f4f4f2]">
              <Link href={c.href} className="group flex h-full flex-col gap-6 p-8 transition-colors hover:bg-white">
                <div className="flex items-baseline justify-between">
                  <p className="text-[28px] font-semibold tracking-[-0.02em]">
                    {c.key}. {c.name}
                  </p>
                  <span aria-hidden="true" className="text-[20px] transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </div>
                <p className="text-[15px] leading-relaxed text-[#555]">{c.line}</p>
                <div className="mt-auto flex items-center justify-between gap-4">
                  <p className="text-[13px] text-[#777]">{c.type}</p>
                  <div aria-hidden="true" className="flex">
                    {c.swatches.map((sw) => (
                      <span key={sw} className="size-6 border border-black/10" style={{ background: sw }} />
                    ))}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
