/* eslint-disable @next/next/no-img-element -- design exploration: remote Unsplash photo without touching next.config */
import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import Link from "next/link";

import { closing, evidence, footer, hero, intro, masked, nav, nerds, photo, PHOTOS, privacy, samplePoint, steps } from "../_shared/content";
import "./c.css";

/** Concept-scoped class names (plain CSS; this project's Tailwind CSS loader does not support CSS Modules). */
const s = new Proxy({} as Record<string, string>, { get: (_t, k) => `lc-${String(k)}` });

export const metadata: Metadata = { title: "C · Relay" };

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], display: "swap", variable: "--c-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--c-mono" });

export default function ConceptC() {
  const [sourced, ...others] = evidence.statuses;
  return (
    <div className={`${s.page} ${archivo.variable} ${mono.variable} min-h-[100dvh] font-[family-name:var(--c-sans)] antialiased`}>
      {/* The baton: scroll progress across the top of the page. */}
      <div aria-hidden="true" className={`${s.progress} fixed inset-x-0 top-0 z-[55] h-[3px] bg-[var(--signal)]`} />

      {/* ── Navigation ── */}
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur-sm">
        <div className="mx-auto grid h-14 max-w-[1440px] grid-cols-2 items-center px-5 md:px-8 lg:grid-cols-12">
          <Link href="/design/c" className={`${s.wide} text-[19px] font-[800] tracking-[-0.02em] lg:col-span-3`}>
            Baton
          </Link>
          <nav aria-label="Main" className="hidden gap-7 text-[14px] lg:col-span-6 lg:flex">
            {nav.links.map((l) => (
              <a key={l.href} href={l.href} className="text-[var(--grey)] hover:text-[var(--ink)]">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center justify-end gap-5 lg:col-span-3">
            <Link href={nav.secondary.href} className="hidden text-[14px] sm:inline">
              {nav.secondary.label}
            </Link>
            <Link href={nav.primary.href} className={`${s.cta} bg-[var(--ink)] px-4 py-2 text-[14px] font-medium text-[var(--bg)]`}>
              {nav.primary.label}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section aria-labelledby="c-hero" className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-[1440px] flex-col justify-between gap-14 px-5 pt-12 pb-16 md:px-8 lg:pt-16">
        <h1 id="c-hero" className={`${s.wide} max-w-[15ch] text-[clamp(46px,7.2vw,112px)] leading-[0.94] font-[800] tracking-[-0.045em]`}>
          {hero.headlineA} <span className="text-[var(--grey)]">{hero.headlineB}</span>
        </h1>
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-4">
            <div aria-hidden="true" className={`${s.bar} mb-8 h-3 w-full bg-[var(--signal)]`} />
            <p className="max-w-[36ch] text-[18px] leading-snug">{hero.sub}</p>
            <div className="mt-8 flex items-center gap-6">
              <Link href={nav.primary.href} className={`${s.cta} bg-[var(--ink)] px-6 py-3.5 text-[15px] font-medium text-[var(--bg)]`}>
                {nav.primary.label}
              </Link>
              <Link href={nav.secondary.href} className={`${s.arrowLink} text-[15px] font-medium`}>
                {nav.secondary.label} <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
          <figure className="border-t-2 border-[var(--ink)] pt-4 lg:col-span-5 lg:col-start-8">
            <div className="flex justify-between font-[family-name:var(--c-mono)] text-[11px] text-[var(--grey)] uppercase">
              <span>{samplePoint.handover}</span>
              <span>{samplePoint.state}</span>
            </div>
            <div className="mt-5 grid grid-cols-[1fr_auto] items-start gap-4">
              <p className={`${s.wide} text-[26px] leading-[1.05] font-[700] tracking-[-0.02em]`}>{samplePoint.title}</p>
              <span className="bg-[var(--ink)] px-2 py-1 font-[family-name:var(--c-mono)] text-[11px] text-[var(--bg)] uppercase">Sourced</span>
            </div>
            <p className="mt-2 text-[15px] text-[var(--grey)]">{samplePoint.summary}</p>
            <blockquote className="mt-5 border-l-[3px] border-[var(--signal)] pl-4 font-[family-name:var(--c-mono)] text-[13px] leading-relaxed">
              {samplePoint.quoteBefore}
              <span className="bg-[var(--ink)] px-1 text-[var(--bg)]">{samplePoint.quoteMask}</span>
            </blockquote>
            <figcaption className="mt-3 font-[family-name:var(--c-mono)] text-[11px] text-[var(--grey)]">
              {samplePoint.author} / {samplePoint.sentAt} / {samplePoint.source}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Product introduction ── */}
      <section aria-labelledby="c-intro" className="border-t border-[var(--ink)]">
        <div className="mx-auto max-w-[1440px] px-5 py-24 md:px-8 lg:py-32">
          <h2 id="c-intro" className="max-w-[24ch] text-[clamp(30px,3.8vw,58px)] leading-[1.04] font-[600] tracking-[-0.03em]">
            When someone leaves a club role or project team, what they know <span className="text-[var(--signal)]">usually leaves with them.</span>
          </h2>
          <p className="mt-8 max-w-[44ch] text-[19px] leading-snug text-[var(--grey)] lg:ml-[41.66%]">{intro.body}</p>
          <ul aria-label="What Baton extracts" className={`${s.narrow} mt-16 grid grid-cols-2 border-t border-[var(--line)] text-[clamp(26px,3.2vw,48px)] leading-none font-[300] tracking-[-0.02em] sm:grid-cols-4`}>
            {intro.extracts.map((e) => (
              <li key={e} className="border-b border-[var(--line)] py-5 pr-4">
                {e}
              </li>
            ))}
          </ul>
        </div>
        <div className="grid lg:grid-cols-12">
          <img src={photo(PHOTOS.teamTable, 1800, "&h=1100")} alt="A team working together around one table, seen from above" className={`${s.photo} h-[340px] w-full object-cover lg:col-span-7 lg:h-[560px]`} />
          <div className="flex flex-col justify-between gap-10 bg-[var(--ink)] p-8 text-[var(--bg)] lg:col-span-5 lg:p-12">
            <p className={`${s.wide} text-[clamp(26px,2.6vw,38px)] leading-[1.05] font-[700] tracking-[-0.02em]`}>Every point links back to the exact message it came from.</p>
            <dl className="grid grid-cols-[110px_1fr] gap-x-6 gap-y-3 font-[family-name:var(--c-mono)] text-[12px]">
              <dt className="text-white/50 uppercase">Decision</dt>
              <dd>{samplePoint.conflict.title}, conflicting</dd>
              <dt className="text-white/50 uppercase">Gap</dt>
              <dd>{samplePoint.gap}</dd>
              <dt className="text-white/50 uppercase">Source</dt>
              <dd>{samplePoint.source}</dd>
            </dl>
          </div>
        </div>
      </section>

      {/* ── How it works: four verbs, full width ── */}
      <section id="how" aria-labelledby="c-how" className="mx-auto max-w-[1440px] px-5 py-24 md:px-8 lg:py-32">
        <h2 id="c-how" className="text-[15px] font-[600]">How it works</h2>
        <ol className="mt-10">
          {steps.map((st) => (
            <li key={st.verb} className="relative grid gap-6 border-t border-[var(--line)] py-10 lg:grid-cols-12 lg:py-12">
              <div aria-hidden="true" className={`${s.rowBar} absolute -top-px left-0 h-[3px] w-full bg-[var(--signal)]`} />
              <h3 className={`${s.wide} text-[clamp(48px,6.6vw,104px)] leading-[0.9] font-[800] tracking-[-0.045em] lg:col-span-6`}>{st.verb}</h3>
              <div className="lg:col-span-5 lg:col-start-8">
                <p className="text-[19px] font-[600] tracking-[-0.01em]">{st.title}</p>
                <p className="mt-2 text-[16px] leading-relaxed text-[var(--grey)]">{st.body}</p>
                {"detail" in st ? <p className="mt-3 font-[family-name:var(--c-mono)] text-[12px] text-[var(--grey)]">{st.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Evidence: one heavy tile, three light ones ── */}
      <section id="evidence" aria-labelledby="c-evidence" className="border-t border-[var(--ink)]">
        <div className="mx-auto max-w-[1440px] px-5 py-24 md:px-8 lg:py-32">
          <h2 id="c-evidence" className={`${s.wide} max-w-[16ch] text-[clamp(32px,4vw,62px)] leading-[0.98] font-[800] tracking-[-0.04em]`}>{evidence.headline}</h2>
          <p className="mt-6 max-w-[52ch] text-[18px] leading-snug text-[var(--grey)]">{evidence.body}</p>
          <dl className="mt-14 grid gap-px bg-[var(--line)] lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
            <div className="flex min-h-[260px] flex-col justify-between bg-[var(--ink)] p-7 text-[var(--bg)]">
              <dt className={`${s.wide} text-[40px] leading-none font-[800] tracking-[-0.04em]`}>{sourced.label}</dt>
              <dd className="max-w-[34ch] text-[15px] leading-relaxed text-white/75">{sourced.body}</dd>
            </div>
            {others.map((st) => (
              <div key={st.key} className="flex min-h-[260px] flex-col justify-between bg-[var(--bg)] p-7">
                <dt className={`${s.wide} text-[26px] leading-none font-[700] tracking-[-0.03em]`}>{st.label}</dt>
                <dd className="text-[15px] leading-relaxed text-[var(--grey)]">{st.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 max-w-[80ch] font-[family-name:var(--c-mono)] text-[13px] leading-relaxed">{evidence.gates}</p>
        </div>
      </section>

      {/* ── Privacy: the message, masked in place ── */}
      <section id="privacy" aria-labelledby="c-privacy" className="bg-[#e6e6e2]">
        <div className="mx-auto max-w-[1440px] px-5 py-24 md:px-8 lg:py-32">
          <h2 id="c-privacy" className="text-[15px] font-[600]">{privacy.headline}</h2>
          <p className={`${s.narrow} mt-10 max-w-[30ch] text-[clamp(30px,4.4vw,68px)] leading-[1.02] font-[400] tracking-[-0.025em]`}>
            {masked.parts.map((p, i) =>
              "mask" in p ? (
                <span key={i} className="mx-1 inline-block border-2 border-[var(--signal)] px-2 text-[0.62em] leading-[1.25] font-[600] align-middle">
                  {p.mask}
                </span>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </p>
          <div className="mt-16 grid gap-10 border-t border-[var(--ink)] pt-8 lg:grid-cols-12">
            <p className="text-[18px] leading-snug lg:col-span-4">{privacy.body}</p>
            {privacy.points.map((p, i) => (
              <div key={p.title} className={i === 0 ? "lg:col-span-3 lg:col-start-6" : i === 1 ? "lg:col-span-3" : "lg:col-span-4 lg:col-start-6"}>
                <h3 className="text-[17px] font-[700]">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--grey)]">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For the nerds ── */}
      <section id="nerds" aria-labelledby="c-nerds" className="mx-auto max-w-[1440px] px-5 py-24 md:px-8 lg:py-32">
        <p className="font-[family-name:var(--c-mono)] text-[12px] text-[var(--grey)] uppercase">For the nerds</p>
        <h2 id="c-nerds" className={`${s.wide} mt-4 max-w-[18ch] text-[clamp(32px,4vw,62px)] leading-[0.98] font-[800] tracking-[-0.04em]`}>{nerds.headline}</h2>
        <p className="mt-6 max-w-[56ch] text-[18px] leading-snug text-[var(--grey)]">{nerds.body}</p>
        <ol className="mt-14 grid border-y border-[var(--ink)] md:grid-cols-3 lg:grid-cols-6">
          {nerds.flow.map((f, i) => (
            <li key={f.step} className={`relative border-[var(--line)] p-5 max-md:border-b md:border-r ${i === 5 ? "bg-[var(--signal)] md:border-r-0" : ""}`}>
              <p className="font-[family-name:var(--c-mono)] text-[11px] uppercase opacity-60">{f.where}</p>
              <p className="mt-6 text-[19px] font-[700] tracking-[-0.01em]">{f.step}</p>
              <p className="mt-2 text-[14px] leading-relaxed opacity-75">{f.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-14 grid gap-x-16 gap-y-10 md:grid-cols-2">
          {nerds.details.map((d) => (
            <div key={d.title} className="grid grid-cols-[1fr] gap-2 lg:grid-cols-[220px_1fr] lg:gap-8">
              <h3 className="text-[17px] font-[700]">{d.title}</h3>
              <p className="text-[15px] leading-relaxed text-[var(--grey)]">{d.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-14 font-[family-name:var(--c-mono)] text-[12px] text-[var(--grey)]">{nerds.stack.join(" / ")}</p>
      </section>

      {/* ── Closing ── */}
      <section aria-labelledby="c-close" className="border-t border-[var(--ink)]">
        <div className="mx-auto max-w-[1440px] px-5 pt-24 md:px-8 lg:pt-32">
          <h2 id="c-close" className={`${s.wide} max-w-[18ch] text-[clamp(38px,6vw,96px)] leading-[0.95] font-[800] tracking-[-0.045em]`}>{closing.headline}</h2>
          <div className="mt-10 grid gap-8 pb-16 lg:grid-cols-12 lg:items-end">
            <p className="max-w-[44ch] text-[18px] leading-snug text-[var(--grey)] lg:col-span-5">{closing.body}</p>
            <div className="flex items-center gap-6 lg:col-span-5 lg:col-start-8 lg:justify-end">
              <Link href={nav.primary.href} className={`${s.cta} bg-[var(--ink)] px-6 py-3.5 text-[15px] font-medium text-[var(--bg)]`}>
                {nav.primary.label}
              </Link>
              <Link href={nav.secondary.href} className={`${s.arrowLink} text-[15px] font-medium`}>
                {nav.secondary.label} <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>
        <div aria-hidden="true" className={`${s.rowBar} h-3 w-full bg-[var(--signal)]`} />
      </section>

      <footer className="mx-auto grid max-w-[1440px] gap-6 px-5 pt-8 pb-20 md:px-8 lg:grid-cols-12">
        <p className={`${s.wide} text-[17px] font-[800] lg:col-span-3`}>Baton</p>
        <p className="text-[14px] text-[var(--grey)] lg:col-span-5">{footer.tagline}</p>
        <ul className="flex gap-6 text-[14px] lg:col-span-4 lg:justify-end">
          {footer.links.map((l) => (
            <li key={l.label}>
              <a href={l.href} className="hover:text-[var(--signal)]">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
