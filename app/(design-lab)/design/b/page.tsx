/* eslint-disable @next/next/no-img-element -- design exploration: remote Unsplash photo without touching next.config */
import type { Metadata } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import Link from "next/link";

import { closing, evidence, footer, hero, intro, masked, nav, nerds, photo, PHOTOS, privacy, samplePoint, steps } from "../_shared/content";
import "./b.css";

/** Concept-scoped class names (plain CSS; this project's Tailwind CSS loader does not support CSS Modules). */
const s = new Proxy({} as Record<string, string>, { get: (_t, k) => `lb-${String(k)}` });

export const metadata: Metadata = { title: "B · Dossier" };

const serif = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], display: "swap", variable: "--b-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--b-mono" });

const FOLIO = ["i", "ii", "iii", "iv"];
const STAMP_CLASS: Record<string, string> = { sourced: "", inferred: s.stampDashed, conflicting: "", missing: `${s.stampDashed} ${s.stampFaint}` };

export default function ConceptB() {
  return (
    <div className={`${s.page} ${serif.variable} ${mono.variable} min-h-[100dvh] font-[family-name:var(--b-serif)] antialiased`}>
      {/* ── Navigation: a document header ── */}
      <header className="sticky top-0 z-50 border-b-[3px] border-double border-[var(--ink)] bg-[var(--paper)]/95 backdrop-blur-[2px]">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-6 px-5 md:px-10">
          <Link href="/design/b" className="flex items-baseline gap-3">
            <span className="text-[24px] leading-none font-medium tracking-[-0.01em]">Baton</span>
            <span className="hidden font-[family-name:var(--b-mono)] text-[11px] tracking-[0.12em] text-[var(--ink2)] uppercase sm:inline">Handover files</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-7 font-[family-name:var(--b-mono)] text-[12px] lg:flex">
            {nav.links.map((l) => (
              <a key={l.href} href={l.href} className="underline-offset-4 hover:underline">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-5">
            <Link href={nav.secondary.href} className="hidden text-[16px] italic underline-offset-4 hover:underline sm:inline">
              {nav.secondary.label}
            </Link>
            <Link href={nav.primary.href} className="border border-[var(--blue)] px-4 py-2 font-[family-name:var(--b-mono)] text-[12px] font-medium text-[var(--blue)] transition-colors hover:bg-[var(--blue)] hover:text-[var(--sheet)]">
              {nav.primary.label}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero: the cover of a handover file ── */}
      <section aria-labelledby="b-hero" className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-[1320px] items-center gap-14 px-5 py-14 md:px-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="font-[family-name:var(--b-mono)] text-[12px] tracking-[0.14em] text-[var(--ink2)] uppercase">Source-backed knowledge handovers</p>
          <h1 id="b-hero" className="mt-6 pb-2 text-[clamp(46px,6vw,88px)] leading-[1.02] font-normal tracking-[-0.02em]">
            {hero.headlineA} <em className="font-light text-[var(--blue)]">{hero.headlineB}</em>
          </h1>
          <p className="mt-7 max-w-[42ch] text-[19px] leading-relaxed text-[var(--ink2)]">{hero.sub}</p>
          <div className="mt-10 flex flex-wrap items-center gap-7">
            <Link href={nav.primary.href} className="bg-[var(--blue)] px-6 py-3.5 font-[family-name:var(--b-mono)] text-[13px] font-medium text-[var(--sheet)] transition-transform active:scale-[0.98]">
              {nav.primary.label}
            </Link>
            <Link href={nav.secondary.href} className="text-[19px] italic underline decoration-[var(--rule)] underline-offset-[6px] hover:decoration-[var(--ink)]">
              {nav.secondary.label}
            </Link>
          </div>
        </div>

        {/* Two index cards from the CodeCell file */}
        <figure className="mx-auto w-full max-w-[460px] lg:col-span-5">
          <div className={`${s.cards} relative`}>
          <div aria-hidden="true" className={`${s.cardBack} absolute inset-0 border border-[var(--rule)] bg-[var(--card)] p-6`}>
            <p className="font-[family-name:var(--b-mono)] text-[11px] tracking-[0.12em] text-[var(--ink2)] uppercase">Decision</p>
            <p className="mt-3 text-[18px]">{samplePoint.conflict.title}</p>
          </div>
          <div className={`${s.cardFront} ${s.ruled} relative border border-[var(--rule)] bg-[var(--card)] px-7 pt-6 pb-20 shadow-[0_24px_40px_-30px_rgb(35_33_30/0.6)]`}>
            <div className="flex items-start justify-between gap-4 border-b border-[var(--blue)]/40 pb-3 font-[family-name:var(--b-mono)] text-[11px] tracking-[0.1em] text-[var(--ink2)] uppercase">
              <span>{samplePoint.category}</span>
              <span>{samplePoint.state}</span>
            </div>
            <p className="mt-5 text-[26px] leading-tight">{samplePoint.title}</p>
            <p className="mt-2 text-[16px] leading-[28px] text-[var(--ink2)]">{samplePoint.summary}</p>
            <p className="mt-4 font-[family-name:var(--b-mono)] text-[13px] leading-[28px]">
              “{samplePoint.quoteBefore}
              <span className={s.redact}>{samplePoint.quoteMask}</span>”
            </p>
            <p className="font-[family-name:var(--b-mono)] text-[11px] leading-[28px] text-[var(--ink2)]">
              {samplePoint.author}, {samplePoint.sentAt}, {samplePoint.source}
            </p>
            <span className={`${s.stamp} ${s.thunk} absolute right-7 bottom-6 font-[family-name:var(--b-mono)] text-[13px]`} style={{ ["--r" as string]: "-7deg", transform: "rotate(-7deg)" }}>
              Sourced
            </span>
          </div>
          </div>
          <figcaption className="mt-8 text-[14px] text-[var(--ink2)] italic">From the fictional CodeCell file. The password was masked before anything was stored.</figcaption>
        </figure>
      </section>

      {/* ── Introduction: a drop-capped opening and an exhibit with marginal notes ── */}
      <section aria-labelledby="b-intro" className="border-y border-[var(--rule)] bg-[var(--sheet)]">
        <div className="mx-auto grid max-w-[1320px] gap-14 px-5 py-24 md:px-10 lg:grid-cols-12 lg:py-32">
          <div className="lg:col-span-6">
            <h2 id="b-intro" className={`${s.dropcap} text-[clamp(26px,2.6vw,36px)] leading-[1.32]`}>
              {intro.statement}
            </h2>
            <p className="mt-6 max-w-[46ch] text-[19px] leading-relaxed text-[var(--ink2)]">{intro.body}</p>
            <p className="mt-8 text-[17px] leading-relaxed text-[var(--ink2)]">
              <span className="font-[family-name:var(--b-mono)] text-[11px] tracking-[0.12em] text-[var(--ink)] uppercase">Index: </span>
              {intro.extracts.join(", ")}.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-[1fr_150px] lg:col-span-6">
            <div className="border border-[var(--rule)] bg-[var(--card)] p-6">
              <p className="font-[family-name:var(--b-mono)] text-[11px] tracking-[0.12em] text-[var(--ink2)] uppercase">Exhibit, as received</p>
              <p className="mt-3 font-[family-name:var(--b-mono)] text-[14px] leading-[1.9] text-[var(--ink2)] line-through decoration-[var(--blue)]/50">{masked.raw}</p>
              <p className="mt-6 font-[family-name:var(--b-mono)] text-[11px] tracking-[0.12em] text-[var(--ink2)] uppercase">As stored</p>
              <p className="mt-3 font-[family-name:var(--b-mono)] text-[14px] leading-[1.9]">
                {masked.parts.map((p, i) => ("mask" in p ? <span key={i} className={s.redact}>{p.mask}</span> : <span key={i}>{p.text}</span>))}
              </p>
            </div>
            <aside className="space-y-6 text-[15px] leading-snug text-[var(--blue)] italic sm:pt-10">
              <p>Masked before it is stored, or sent to any AI.</p>
              <p>The original upload is deleted once processing succeeds.</p>
            </aside>
          </div>
        </div>
      </section>

      {/* ── How it works: a contents page ── */}
      <section id="how" aria-labelledby="b-how" className="mx-auto max-w-[880px] px-5 py-24 md:px-10 lg:py-32">
        <h2 id="b-how" className="text-center text-[clamp(30px,3.2vw,44px)] leading-tight">Contents</h2>
        <p className="mt-3 text-center text-[17px] text-[var(--ink2)] italic">From group chat to handover in an afternoon.</p>
        <ol className="mt-14 space-y-10">
          {steps.map((st, i) => (
            <li key={st.verb} className={s.tocItem}>
              <div className="flex items-baseline gap-4">
                <h3 className={`${s.tocTitle} text-[24px] leading-tight`}>{st.title}</h3>
                <span aria-hidden="true" className={s.leader} />
                <span className="font-[family-name:var(--b-mono)] text-[13px] text-[var(--ink2)]">{FOLIO[i]}</span>
              </div>
              <p className="mt-2 max-w-[60ch] text-[17px] leading-relaxed text-[var(--ink2)]">{st.body}</p>
              {"detail" in st ? <p className="mt-2 font-[family-name:var(--b-mono)] text-[12px] text-[var(--ink2)]">{st.detail}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      {/* ── Evidence: a specimen sheet of stamps ── */}
      <section id="evidence" aria-labelledby="b-evidence" className="border-t border-[var(--rule)] bg-[var(--sheet)]">
        <div className="mx-auto max-w-[1320px] px-5 py-24 md:px-10 lg:py-32">
          <h2 id="b-evidence" className="max-w-[20ch] text-[clamp(30px,3.4vw,48px)] leading-[1.1]">{evidence.headline}</h2>
          <p className="mt-5 max-w-[56ch] text-[19px] leading-relaxed text-[var(--ink2)]">{evidence.body}</p>
          <dl className="mt-14 grid gap-px bg-[var(--rule)] sm:grid-cols-2">
            {evidence.statuses.map((st, i) => (
              <div key={st.key} className="bg-[var(--sheet)] p-8 lg:p-10">
                <dt>
                  <span
                    className={`${s.stamp} ${s.thunk} ${STAMP_CLASS[st.key]} font-[family-name:var(--b-mono)] text-[15px]`}
                    style={{ ["--r" as string]: `${[-4, 3, -2, 5][i]}deg`, transform: `rotate(${[-4, 3, -2, 5][i]}deg)` }}
                  >
                    {st.label}
                  </span>
                </dt>
                <dd className="mt-6 max-w-[44ch] text-[17px] leading-relaxed text-[var(--ink2)]">{st.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10 max-w-[70ch] text-[17px] leading-relaxed">
            <span className="mr-2 text-[var(--blue)]">¶</span>
            {evidence.gates}
          </p>
        </div>
      </section>

      {/* ── Privacy: clauses ── */}
      <section id="privacy" aria-labelledby="b-privacy" className="mx-auto max-w-[1320px] px-5 py-24 md:px-10 lg:py-32">
        <div className="grid gap-12 lg:grid-cols-12">
          <h2 id="b-privacy" className="text-[clamp(30px,3.4vw,48px)] leading-[1.1] lg:col-span-5">{privacy.headline}</h2>
          <div className="lg:col-span-7">
            <p className="text-[19px] leading-relaxed text-[var(--ink2)]">{privacy.body}</p>
            <ol className="mt-10 grid gap-x-10 gap-y-8 border-t border-[var(--ink)] pt-8 md:grid-cols-2">
              {privacy.points.map((p, i) => (
                <li key={p.title} className={i === 2 ? "md:col-span-2 md:max-w-[50%]" : ""}>
                  <h3 className="text-[19px]">
                    <span className="mr-2 font-[family-name:var(--b-mono)] text-[13px] text-[var(--blue)]">§{i + 1}</span>
                    {p.title}
                  </h3>
                  <p className="mt-2 text-[16px] leading-relaxed text-[var(--ink2)] hyphens-auto">{p.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── For the nerds: an appendix ── */}
      <section id="nerds" aria-labelledby="b-nerds" className="border-t-[3px] border-double border-[var(--ink)] bg-[var(--sheet)]">
        <div className="mx-auto max-w-[1320px] px-5 py-24 md:px-10 lg:py-32">
          <p className="font-[family-name:var(--b-mono)] text-[12px] tracking-[0.14em] text-[var(--ink2)] uppercase">Appendix, for the nerds</p>
          <h2 id="b-nerds" className="mt-4 text-[clamp(30px,3.4vw,48px)] leading-[1.1]">{nerds.headline}</h2>
          <div className="mt-12 grid gap-14 lg:grid-cols-12">
            <div className="columns-1 gap-10 text-[17px] leading-relaxed text-[var(--ink2)] hyphens-auto md:columns-2 lg:col-span-7">
              <p className="mb-5 break-inside-avoid">{nerds.body}</p>
              {nerds.details.map((d, i) => (
                <p key={d.title} className="mb-5 break-inside-avoid">
                  <span className="text-[var(--ink)] italic">{d.title}.</span> {d.body}
                  <sup className="ml-0.5 font-[family-name:var(--b-mono)] text-[10px] text-[var(--blue)]">{i + 1}</sup>
                </p>
              ))}
            </div>
            <div className="lg:col-span-5">
              <p className="font-[family-name:var(--b-mono)] text-[11px] tracking-[0.12em] text-[var(--ink2)] uppercase">Manifest</p>
              <ol className="mt-4 border-t border-[var(--ink)] font-[family-name:var(--b-mono)] text-[13px]">
                {nerds.flow.map((f, i) => (
                  <li key={f.step} className="flex items-baseline gap-3 border-b border-[var(--rule)] py-3">
                    <span className="text-[var(--ink2)]">{String(i + 1).padStart(2, "0")}</span>
                    <span className="font-medium">{f.step}</span>
                    <span aria-hidden="true" className={s.leader} />
                    <span className={f.where === "people" ? "text-[var(--blue)]" : "text-[var(--ink2)]"}>{f.where}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-6 text-[14px] leading-relaxed text-[var(--ink2)] italic">Built with {nerds.stack.join(", ")}.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Closing: acknowledgement ── */}
      <section aria-labelledby="b-close" className="mx-auto grid max-w-[1320px] items-center gap-14 px-5 py-24 md:px-10 lg:grid-cols-12 lg:py-32">
        <div className="lg:col-span-5">
          <img src={photo(PHOTOS.pen, 1400, "&h=1100")} alt="A fountain pen writing on lined paper" className={`${s.plate} w-full border-[10px] border-[var(--card)] shadow-[0_20px_40px_-28px_rgb(35_33_30/0.6)]`} />
        </div>
        <div className="lg:col-span-6 lg:col-start-7">
          <h2 id="b-close" className="text-[clamp(32px,3.8vw,54px)] leading-[1.08]">{closing.headline}</h2>
          <p className="mt-6 max-w-[48ch] text-[19px] leading-relaxed text-[var(--ink2)]">{closing.body}</p>
          <div aria-hidden="true" className="mt-10 grid max-w-[460px] grid-cols-[2fr_1fr] gap-6 font-[family-name:var(--b-mono)] text-[11px] tracking-[0.1em] text-[var(--ink2)] uppercase">
            <div className="border-t border-[var(--ink)] pt-2">Received by the incoming lead</div>
            <div className="border-t border-[var(--ink)] pt-2">Date</div>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-7">
            <Link href={nav.primary.href} className="bg-[var(--blue)] px-6 py-3.5 font-[family-name:var(--b-mono)] text-[13px] font-medium text-[var(--sheet)] transition-transform active:scale-[0.98]">
              {nav.primary.label}
            </Link>
            <Link href={nav.secondary.href} className="text-[19px] italic underline decoration-[var(--rule)] underline-offset-[6px] hover:decoration-[var(--ink)]">
              {nav.secondary.label}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer: a colophon ── */}
      <footer className="border-t-[3px] border-double border-[var(--ink)]">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-5 pt-8 pb-20 md:flex-row md:items-baseline md:justify-between md:px-10">
          <p className="text-[15px] text-[var(--ink2)]">
            <span className="text-[var(--ink)]">Baton.</span> {footer.tagline}. <span className="italic">Set in Newsreader and IBM Plex Mono.</span>
          </p>
          <ul className="flex gap-7 font-[family-name:var(--b-mono)] text-[12px]">
            {footer.links.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="underline-offset-4 hover:underline">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}
