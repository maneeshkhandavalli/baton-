/* eslint-disable @next/next/no-img-element -- design exploration: remote Unsplash photos without touching next.config */
import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import Link from "next/link";

import { closing, evidence, footer, hero, intro, masked, nav, nerds, photo, PHOTOS, privacy, samplePoint, steps } from "../_shared/content";
import "./a.css";

/** Concept-scoped class names (plain CSS; this project's Tailwind CSS loader does not support CSS Modules). */
const s = new Proxy({} as Record<string, string>, { get: (_t, k) => `la-${String(k)}` });

export const metadata: Metadata = { title: "A · Ridgeline" };

const hanken = Hanken_Grotesk({ subsets: ["latin"], style: ["normal", "italic"], display: "swap" });

const SYMBOL: Record<string, string> = { sourced: s.symSourced, inferred: s.symInferred, conflicting: s.symConflicting, missing: s.symMissing };

export default function ConceptA() {
  return (
    <div className={`${s.page} ${hanken.className} min-h-[100dvh] antialiased`}>
      {/* ── Navigation ── */}
      <header className={`${s.nav} fixed inset-x-0 top-0 z-50`}>
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-6 px-5 md:px-10">
          <Link href="/design/a" className="text-[15px] font-medium tracking-[0.34em] uppercase">
            Baton
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
            {nav.links.map((l) => (
              <a key={l.href} href={l.href} className={`${s.link} text-[12px] tracking-[0.14em] text-[var(--ink2)] uppercase hover:text-[var(--slate)]`}>
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-5">
            <Link href={nav.secondary.href} className={`${s.link} hidden text-[13px] sm:inline`}>
              {nav.secondary.label}
            </Link>
            <Link href={nav.primary.href} className="bg-[var(--slate)] px-4 py-2.5 text-[13px] font-medium text-[var(--mist)] transition-transform active:scale-[0.98]">
              {nav.primary.label}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero: the layered ridgelines, faded into mist ── */}
      <section aria-labelledby="a-hero" className="relative isolate flex min-h-[100dvh] items-end overflow-hidden">
        <img
          src={photo(PHOTOS.ridges, 2400)}
          alt="Layers of hazy mountain ridges fading into the distance"
          fetchPriority="high"
          className={`${s.photo} ${s.heroPhoto} absolute inset-0 -z-20 h-full w-full object-cover object-[50%_65%]`}
        />
        <div aria-hidden="true" className={`${s.heroVeil} absolute inset-0 -z-10`} />
        <div className={`${s.heroText} mx-auto w-full max-w-[1400px] px-5 pb-16 md:px-10 md:pb-24`}>
          <h1 id="a-hero" className="max-w-[19ch] pb-1 text-[clamp(44px,5.6vw,84px)] leading-[1.04] font-light tracking-[-0.035em]">
            {hero.headlineA} <em className="font-light text-[var(--ink2)]">{hero.headlineB}</em>
          </h1>
          <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <p className="max-w-[40ch] text-[17px] leading-relaxed text-[var(--ink2)]">{hero.sub}</p>
            <div className="flex items-center gap-6">
              <Link href={nav.primary.href} className="bg-[var(--slate)] px-6 py-3.5 text-[15px] font-medium text-[var(--mist)] transition-transform active:scale-[0.98]">
                {nav.primary.label}
              </Link>
              <Link href={nav.secondary.href} className={`${s.link} text-[15px]`}>
                {nav.secondary.label}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Product introduction: a printed slip of the real review screen ── */}
      <section aria-labelledby="a-intro" className="mx-auto grid max-w-[1400px] gap-16 px-5 py-28 md:px-10 lg:grid-cols-12 lg:py-40">
        <div className="reveal lg:col-span-6">
          <h2 id="a-intro" className="text-[clamp(30px,3.4vw,46px)] leading-[1.12] font-light tracking-[-0.02em]">
            {intro.statement}
          </h2>
          <p className="mt-6 max-w-[48ch] text-[17px] leading-relaxed text-[var(--ink2)]">{intro.body}</p>
          <ul aria-label="What Baton extracts" className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--fog)] pt-6 text-[12px] tracking-[0.12em] text-[var(--stone)] uppercase">
            {intro.extracts.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
        <figure className="reveal-group space-y-4 lg:col-span-5 lg:col-start-8">
          <div className="border border-[var(--fog)] bg-[var(--paper)] p-7 shadow-[0_30px_60px_-40px_rgb(31_39_36/0.35)]">
            <div className="flex items-center gap-3 text-[11px] tracking-[0.14em] text-[var(--stone)] uppercase">
              <span>{samplePoint.category}</span>
              <span className="ml-auto flex items-center gap-2 text-[var(--slate)]">
                <span aria-hidden="true" className={`${s.symSourced} w-6`} /> Sourced · Approved
              </span>
            </div>
            <p className="mt-5 text-[22px] font-medium tracking-[-0.01em]">{samplePoint.title}</p>
            <p className="mt-1 text-[15px] text-[var(--ink2)]">{samplePoint.summary}</p>
            <blockquote className="mt-6 border-l border-[var(--slate)] pl-5 text-[17px] leading-relaxed italic">
              “{samplePoint.quoteBefore}
              <span className="not-italic bg-[var(--slate)] px-1.5 py-0.5 text-[12px] tracking-[0.08em] text-[var(--mist)]">{samplePoint.quoteMask}</span>”
            </blockquote>
            <p className="mt-4 text-[13px] text-[var(--stone)]">
              {samplePoint.author}, {samplePoint.sentAt}. {samplePoint.source}
            </p>
          </div>
          <div className="ml-10 flex items-baseline gap-4 border border-[var(--fog)] bg-[var(--paper)]/70 px-6 py-4">
            <span aria-hidden="true" className={`${s.symConflicting} w-6 shrink-0 self-center`} />
            <p className="text-[15px]">{samplePoint.conflict.title}</p>
            <span className="ml-auto text-[12px] tracking-[0.12em] text-[var(--stone)] uppercase">Conflicting</span>
          </div>
          <div className="mr-10 flex items-baseline gap-4 border border-dashed border-[var(--stone)]/50 px-6 py-4">
            <span aria-hidden="true" className={`${s.symMissing} w-6 shrink-0 self-center`} />
            <p className="text-[15px]">{samplePoint.gap}</p>
            <span className="ml-auto text-[12px] tracking-[0.12em] text-[var(--stone)] uppercase">Gap Interview</span>
          </div>
          <figcaption className="pt-2 text-[13px] text-[var(--stone)]">From the fictional CodeCell demo. The password was masked before anything was stored.</figcaption>
        </figure>
      </section>

      {/* ── How it works: a strip of distant ridges, then four stages along it ── */}
      <section id="how" aria-labelledby="a-how" className="pb-28 lg:pb-40">
        <div className="relative h-[180px] overflow-hidden md:h-[240px]">
          <img src={photo(PHOTOS.ridges, 2400, "&h=900")} alt="" className={`${s.photo} ${s.band} ${s.drift} absolute inset-0 h-[140%] w-full object-cover object-[50%_40%]`} />
        </div>
        <div className="mx-auto max-w-[1400px] px-5 md:px-10">
          <h2 id="a-how" className="reveal max-w-[18ch] text-[clamp(30px,3.4vw,46px)] leading-[1.12] font-light tracking-[-0.02em]">
            From group chat to handover in an afternoon.
          </h2>
          <ol className="reveal-group mt-14 grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {steps.map((st) => (
              <li key={st.verb} className="border-t border-[var(--slate)] pt-6">
                <h3 className="text-[22px] font-normal tracking-[-0.01em]">{st.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink2)]">{st.body}</p>
                {"detail" in st ? <p className="mt-4 text-[12px] tracking-[0.1em] text-[var(--stone)] uppercase">{st.detail}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Evidence: a map legend ── */}
      <section id="evidence" aria-labelledby="a-evidence" className="border-t border-[var(--fog)] bg-[var(--paper)]">
        <div className="mx-auto grid max-w-[1400px] gap-16 px-5 py-28 md:px-10 lg:grid-cols-12 lg:py-36">
          <div className="lg:sticky lg:top-28 lg:col-span-5 lg:self-start">
            <h2 id="a-evidence" className="text-[clamp(30px,3.4vw,46px)] leading-[1.12] font-light tracking-[-0.02em]">
              {evidence.headline}
            </h2>
            <p className="mt-6 max-w-[44ch] text-[17px] leading-relaxed text-[var(--ink2)]">{evidence.body}</p>
            <p className="mt-10 max-w-[44ch] border-l border-[var(--lichen)] pl-5 text-[15px] leading-relaxed text-[var(--ink2)]">{evidence.gates}</p>
          </div>
          <dl className="reveal-group lg:col-span-6 lg:col-start-7">
            {evidence.statuses.map((st) => (
              <div key={st.key} className="grid grid-cols-[72px_1fr] items-start gap-x-8 gap-y-2 py-8 first:pt-0">
                <dt className="contents">
                  <span aria-hidden="true" className={`${SYMBOL[st.key]} mt-3 w-[72px]`} />
                  <span className="text-[24px] font-normal tracking-[-0.01em]">{st.label}</span>
                </dt>
                <dd className="col-start-2 max-w-[48ch] text-[15px] leading-relaxed text-[var(--ink2)]">{st.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Privacy: inside the fog ── */}
      <section id="privacy" aria-labelledby="a-privacy" className="relative isolate overflow-hidden text-[var(--mist)]">
        <img src={photo(PHOTOS.fogForest, 2400)} alt="Pine forest disappearing into fog" className={`${s.photo} absolute inset-0 -z-20 h-full w-full object-cover brightness-[0.62]`} />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgb(31_39_36/0.72),rgb(31_39_36/0.25))]" />
        <div className="mx-auto grid max-w-[1400px] gap-14 px-5 py-28 md:px-10 lg:grid-cols-12 lg:py-40">
          <div className="reveal lg:col-span-6">
            <h2 id="a-privacy" className="text-[clamp(30px,3.6vw,50px)] leading-[1.1] font-light tracking-[-0.02em]">{privacy.headline}</h2>
            <p className="mt-6 max-w-[46ch] text-[17px] leading-relaxed text-[var(--mist)]/80">{privacy.body}</p>
            <p className="mt-10 max-w-[56ch] border-t border-white/25 pt-6 text-[15px] leading-relaxed">
              {masked.parts.map((p, i) =>
                "mask" in p ? (
                  <span key={i} className="mx-0.5 border border-white/50 px-1.5 py-0.5 text-[12px] tracking-[0.08em]">
                    {p.mask}
                  </span>
                ) : (
                  <span key={i} className="text-[var(--mist)]/80">{p.text}</span>
                ),
              )}
            </p>
          </div>
          <ul className="reveal-group self-end lg:col-span-5 lg:col-start-8">
            {privacy.points.map((p) => (
              <li key={p.title} className="border-t border-white/25 py-6">
                <h3 className="text-[19px] font-normal">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--mist)]/75">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── For the nerds: the route a claim travels ── */}
      <section id="nerds" aria-labelledby="a-nerds" className="bg-[var(--fog)]/60">
        <div className="mx-auto grid max-w-[1400px] gap-16 px-5 py-28 md:px-10 lg:grid-cols-12 lg:py-36">
          <div className="lg:col-span-5">
            <p className="mb-5 text-[12px] tracking-[0.18em] text-[var(--ink2)] uppercase">For the nerds</p>
            <h2 id="a-nerds" className="text-[clamp(30px,3.4vw,46px)] leading-[1.12] font-light tracking-[-0.02em]">{nerds.headline}</h2>
            <p className="mt-6 max-w-[44ch] text-[17px] leading-relaxed text-[var(--ink2)]">{nerds.body}</p>
            <ol className="reveal-group relative mt-12 ml-1 border-l border-[var(--slate)]/40">
              {nerds.flow.map((f) => (
                <li key={f.step} className={`${s.waypoint} ${f.where === "people" ? s.waypointPeople : ""} relative pb-7 pl-8 last:pb-0`}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[18px]">{f.step}</span>
                    <span className="text-[11px] tracking-[0.14em] text-[var(--stone)] uppercase">{f.where}</span>
                  </div>
                  <p className="mt-1 text-[14px] leading-relaxed text-[var(--ink2)]">{f.body}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="lg:col-span-6 lg:col-start-7 lg:pt-24">
            <div className="reveal-group grid gap-x-10 gap-y-12 sm:grid-cols-2">
              {nerds.details.map((d) => (
                <div key={d.title}>
                  <h3 className="text-[18px] font-medium">{d.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink2)]">{d.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-14 border-t border-[var(--slate)]/20 pt-6 text-[13px] leading-loose tracking-[0.06em] text-[var(--ink2)]">{nerds.stack.join("  /  ")}</p>
          </div>
        </div>
      </section>

      {/* ── Closing: one peak, through the cloud ── */}
      <section aria-labelledby="a-close" className="relative isolate flex min-h-[100dvh] items-start overflow-hidden pt-28 lg:pt-32">
        <img src={photo(PHOTOS.peakInFog, 2400)} alt="A mountain peak rising through cloud" className={`${s.photo} absolute inset-x-0 bottom-0 -z-20 h-[78%] w-full object-cover object-[50%_40%] brightness-[1.1]`} />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,var(--mist)_0%,var(--mist)_26%,rgb(238_240_238/0)_55%,rgb(238_240_238/0)_82%,var(--mist)_100%)]" />
        <div className="reveal mx-auto max-w-[1000px] px-5 text-center md:px-10">
          <h2 id="a-close" className="text-[clamp(34px,4.8vw,68px)] leading-[1.06] font-light tracking-[-0.03em]">{closing.headline}</h2>
          <p className="mx-auto mt-6 max-w-[52ch] text-[17px] leading-relaxed text-[var(--ink2)]">{closing.body}</p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6">
            <Link href={nav.primary.href} className="bg-[var(--slate)] px-6 py-3.5 text-[15px] font-medium text-[var(--mist)] transition-transform active:scale-[0.98]">
              {nav.primary.label}
            </Link>
            <Link href={nav.secondary.href} className={`${s.link} text-[15px]`}>
              {nav.secondary.label}
            </Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 pt-10 pb-20 md:flex-row md:items-center md:justify-between md:px-10">
        <div>
          <p className="text-[14px] font-medium tracking-[0.34em] uppercase">Baton</p>
          <p className="mt-1 text-[13px] text-[var(--stone)]">{footer.tagline}</p>
        </div>
        <ul className="flex gap-8 text-[13px] text-[var(--ink2)]">
          {footer.links.map((l) => (
            <li key={l.label}>
              <a href={l.href} className={s.link}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
