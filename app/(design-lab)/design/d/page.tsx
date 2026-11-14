import type { Metadata } from "next";
import { Bricolage_Grotesque, Martian_Mono } from "next/font/google";
import Link from "next/link";

import { chat, closing, evidence, footer, hero, intro, masked, nav, nerds, privacy, samplePoint, steps } from "../_shared/content";
import "./d.css";

/** Concept-scoped class names (plain CSS; this project's Tailwind CSS loader does not support CSS Modules). */
const s = new Proxy({} as Record<string, string>, { get: (_t, k) => `ld-${String(k)}` });
import { ChatHandoverToggle } from "./toggle";

export const metadata: Metadata = { title: "D · Threads" };

const display = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", variable: "--d-sans" });
const mono = Martian_Mono({ subsets: ["latin"], display: "swap", variable: "--d-mono" });

const STEP_CLASS = [s.step0, s.step1, s.step2, s.step3];
const WORD_CLASS = [s.word0, s.word1, s.word2, s.word3];

function EvidenceLine({ kind }: { kind: string }) {
  if (kind === "sourced")
    return (
      <span className="flex items-center gap-0">
        <span className={s.dot} /> <span className={`${s.lnSolid} w-full`} /> <span className={`${s.dot} bg-[var(--acid)]`} />
      </span>
    );
  if (kind === "inferred")
    return (
      <span className="flex items-center">
        <span className={s.dotHollow} /> <span className={`${s.lnDashed} w-full`} /> <span className={s.dot} />
      </span>
    );
  if (kind === "conflicting")
    return (
      <span className="relative block h-8">
        <span className={`${s.dot} absolute top-0 left-0`} />
        <span className={`${s.dot} absolute bottom-0 left-0`} />
        <span className="absolute top-[4px] left-[8px] h-[2px] w-[calc(100%-16px)] origin-left rotate-[7deg] bg-[var(--bone)]" />
        <span className="absolute bottom-[4px] left-[8px] h-[2px] w-[calc(100%-16px)] origin-left -rotate-[7deg] bg-[#f2a65a]" />
        <span className={`${s.dot} absolute top-1/2 right-0 -translate-y-1/2`} />
      </span>
    );
  return (
    <span className="flex items-center">
      <span className={`${s.lnFade} w-full rotate-180`} /> <span className={s.dot} />
    </span>
  );
}

export default function ConceptD() {
  const story = [...chat.slice(0, 3), { t: samplePoint.sentAt, who: samplePoint.author, text: samplePoint.quoteBefore + samplePoint.quoteMask, key: true }, ...chat.slice(3, 6)];
  return (
    <div className={`${s.page} ${display.variable} ${mono.variable} min-h-[100dvh] font-[family-name:var(--d-sans)] antialiased`}>
      {/* ── Navigation ── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--line)] bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-6 px-5 md:px-8">
          <Link href="/design/d" className="text-[20px] font-bold tracking-[-0.03em]">
            baton<span className="text-[var(--acid)]">.</span>
          </Link>
          <nav aria-label="Main" className="hidden gap-7 font-[family-name:var(--d-mono)] text-[11px] text-[var(--dim)] uppercase lg:flex">
            {nav.links.map((l) => (
              <a key={l.href} href={l.href} className="hover:text-[var(--bone)]">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-5">
            <Link href={nav.secondary.href} className="hidden text-[14px] text-[var(--dim)] hover:text-[var(--bone)] sm:inline">
              {nav.secondary.label}
            </Link>
            <Link href={nav.primary.href} className="rounded-full bg-[var(--acid)] px-4 py-2 text-[14px] font-semibold text-[var(--bg)] transition-transform active:scale-[0.98]">
              {nav.primary.label}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero: the chat drifts past; the handover is pulled out of it ── */}
      <section aria-labelledby="d-hero" className="relative isolate overflow-hidden">
        <div aria-hidden="true" className={`${s.drift} absolute inset-y-0 right-0 -z-10 hidden w-[44%] opacity-[0.16] lg:block`}>
          <ul className={`${s.driftTrack} space-y-5 pt-24 pr-10 font-[family-name:var(--d-mono)] text-[12px] leading-relaxed text-[var(--dim)]`}>
            {[...chat, ...chat, ...chat, ...chat].map((m, i) => (
              <li key={i}>
                {m.t} - {m.who}: {m.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="mx-auto grid min-h-[100dvh] max-w-[1440px] items-center gap-14 px-5 pt-24 pb-16 md:px-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <h1 id="d-hero" className="max-w-[17ch] pb-1 text-[clamp(44px,5.6vw,86px)] leading-[0.98] font-bold tracking-[-0.045em]">
              {hero.headlineA} <span className="text-[var(--acid)]">{hero.headlineB}</span>
            </h1>
            <p className="mt-7 max-w-[40ch] text-[18px] leading-relaxed text-[var(--dim)]">{hero.sub}</p>
            <div className="mt-9 flex flex-wrap items-center gap-5">
              <Link href={nav.primary.href} className="rounded-full bg-[var(--acid)] px-6 py-3.5 text-[15px] font-semibold text-[var(--bg)] transition-transform active:scale-[0.98]">
                {nav.primary.label}
              </Link>
              <Link href={nav.secondary.href} className="rounded-full border border-[var(--line)] px-6 py-3.5 text-[15px] hover:border-[var(--bone)]">
                {nav.secondary.label}
              </Link>
            </div>
          </div>
          <div className="lg:col-span-5 lg:col-start-8 lg:pl-6">
            <ChatHandoverToggle />
          </div>
        </div>
      </section>

      {/* ── Product introduction: one message, one thread to a point ── */}
      <section aria-labelledby="d-intro" className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-[1440px] px-5 py-28 md:px-8 lg:py-36">
          <h2 id="d-intro" className="max-w-[22ch] text-[clamp(30px,3.6vw,54px)] leading-[1.04] font-semibold tracking-[-0.035em]">{intro.statement}</h2>
          <p className="mt-6 max-w-[48ch] text-[18px] leading-relaxed text-[var(--dim)]">{intro.body}</p>
          <div className="mt-16 grid items-center gap-10 lg:grid-cols-12">
            <ol className="space-y-4 font-[family-name:var(--d-mono)] text-[12px] leading-relaxed lg:col-span-6">
              {story.map((m) => (
                <li key={m.t} className={"key" in m ? "relative rounded-lg bg-[var(--panel)] p-3 text-[var(--bone)] ring-1 ring-[var(--acid)]/60" : "px-3 text-[var(--dim)]"}>
                  <span className="opacity-60">{m.t}, {m.who}: </span>
                  {m.text}
                  {"key" in m ? <span aria-hidden="true" className={`${s.connector} absolute top-1/2 left-full hidden h-px w-[calc(16.66vw)] max-w-[220px] bg-[var(--acid)] lg:block`} /> : null}
                </li>
              ))}
            </ol>
            <div className="rounded-2xl border border-[var(--acid)]/50 bg-[var(--panel)] p-6 lg:col-span-5 lg:col-start-8">
              <p className="font-[family-name:var(--d-mono)] text-[11px] text-[var(--acid)] uppercase">Sourced · {samplePoint.category}</p>
              <p className="mt-3 text-[24px] font-semibold tracking-[-0.02em]">{samplePoint.title}</p>
              <p className="mt-1 text-[15px] text-[var(--dim)]">{samplePoint.summary}</p>
              <ul className="mt-6 flex flex-wrap gap-2 font-[family-name:var(--d-mono)] text-[10px] uppercase">
                {intro.extracts.map((e) => (
                  <li key={e} className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[var(--dim)]">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works: the stage word lights up as you read its step ── */}
      <section id="how" aria-labelledby="d-how" className={`${s.steps} border-t border-[var(--line)]`}>
        <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-28 md:px-8 lg:grid-cols-12 lg:py-36">
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-28">
              <h2 id="d-how" className="font-[family-name:var(--d-mono)] text-[11px] text-[var(--dim)] uppercase">How it works</h2>
              <ul aria-hidden="true" className="mt-6 space-y-1 text-[clamp(44px,5.6vw,88px)] leading-[0.95] font-bold tracking-[-0.05em]">
                {steps.map((st, i) => (
                  <li key={st.verb} className={`${s.stepWord} ${WORD_CLASS[i]}`}>
                    {st.verb}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <ol className="space-y-[18vh] lg:col-span-6 lg:col-start-7 lg:py-[10vh]">
            {steps.map((st, i) => (
              <li key={st.verb} className={STEP_CLASS[i]}>
                <h3 className="text-[28px] font-semibold tracking-[-0.025em]">{st.title}</h3>
                <p className="mt-3 max-w-[46ch] text-[17px] leading-relaxed text-[var(--dim)]">{st.body}</p>
                {"detail" in st ? <p className="mt-4 font-[family-name:var(--d-mono)] text-[11px] text-[var(--dim)]">{st.detail}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Evidence: four kinds of thread ── */}
      <section id="evidence" aria-labelledby="d-evidence" className="border-t border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto max-w-[1440px] px-5 py-28 md:px-8 lg:py-36">
          <h2 id="d-evidence" className="max-w-[18ch] text-[clamp(30px,3.6vw,54px)] leading-[1.04] font-semibold tracking-[-0.035em]">{evidence.headline}</h2>
          <p className="mt-6 max-w-[52ch] text-[18px] leading-relaxed text-[var(--dim)]">{evidence.body}</p>
          <dl className="mt-14">
            {evidence.statuses.map((st) => (
              <div key={st.key} className="grid items-center gap-4 border-t border-[var(--line)] py-8 md:grid-cols-[200px_1fr] lg:grid-cols-[220px_260px_1fr] lg:gap-12">
                <dt className="text-[26px] font-semibold tracking-[-0.02em]">{st.label}</dt>
                <dd aria-hidden="true" className="hidden lg:block">
                  <EvidenceLine kind={st.key} />
                </dd>
                <dd className="max-w-[56ch] text-[16px] leading-relaxed text-[var(--dim)]">{st.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 max-w-[80ch] border-t border-[var(--line)] pt-8 font-[family-name:var(--d-mono)] text-[12px] leading-relaxed text-[var(--dim)]">{evidence.gates}</p>
        </div>
      </section>

      {/* ── Privacy: masked as you watch ── */}
      <section id="privacy" aria-labelledby="d-privacy" className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-[1440px] px-5 py-28 md:px-8 lg:py-36">
          <h2 id="d-privacy" className="max-w-[20ch] text-[clamp(30px,3.6vw,54px)] leading-[1.04] font-semibold tracking-[-0.035em]">{privacy.headline}</h2>
          <p className="mt-10 max-w-[40ch] font-[family-name:var(--d-mono)] text-[clamp(16px,1.8vw,24px)] leading-[1.6]">
            {masked.parts.map((p, i) =>
              "mask" in p ? (
                <span key={i} className={s.maskStack}>
                  <span className={`${s.raw} text-[#f2a65a]`}>{p.hidden}</span>
                  <span className={`${s.token} self-center justify-self-start rounded bg-[var(--acid)] px-1.5 text-[0.7em] text-[var(--bg)]`}>{p.mask}</span>
                </span>
              ) : (
                <span key={i} className="text-[var(--dim)]">{p.text}</span>
              ),
            )}
          </p>
          <div className="mt-16 grid gap-10 md:grid-cols-2 lg:grid-cols-12">
            <p className="text-[17px] leading-relaxed text-[var(--dim)] lg:col-span-4">{privacy.body}</p>
            {privacy.points.map((p, i) => (
              <div key={p.title} className={i === 0 ? "lg:col-span-4 lg:col-start-6" : i === 1 ? "lg:col-span-3" : "lg:col-span-4 lg:col-start-6"}>
                <h3 className="text-[19px] font-semibold">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--dim)]">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For the nerds: the line every claim travels ── */}
      <section id="nerds" aria-labelledby="d-nerds" className="border-t border-[var(--line)] bg-[var(--panel)]">
        <div className="mx-auto max-w-[1440px] px-5 py-28 md:px-8 lg:py-36">
          <p className="font-[family-name:var(--d-mono)] text-[11px] text-[var(--acid)] uppercase">For the nerds</p>
          <h2 id="d-nerds" className="mt-4 max-w-[18ch] text-[clamp(30px,3.6vw,54px)] leading-[1.04] font-semibold tracking-[-0.035em]">{nerds.headline}</h2>
          <p className="mt-6 max-w-[56ch] text-[18px] leading-relaxed text-[var(--dim)]">{nerds.body}</p>
          <ol className="relative mt-16 grid gap-8 lg:grid-cols-6 lg:gap-6">
            <span aria-hidden="true" className="absolute top-[5px] right-0 left-0 hidden h-px bg-[var(--line)] lg:block" />
            {nerds.flow.map((f) => (
              <li key={f.step} className="relative pl-6 lg:pt-8 lg:pl-0">
                <span aria-hidden="true" className={`absolute top-[2px] left-0 size-[11px] rounded-full border-2 ${f.where === "people" ? "border-[var(--acid)] bg-[var(--acid)]" : "border-[var(--bone)] bg-[var(--panel)]"}`} />
                <p className="font-[family-name:var(--d-mono)] text-[10px] text-[var(--dim)] uppercase">{f.where}</p>
                <p className="mt-2 text-[19px] font-semibold tracking-[-0.02em]">{f.step}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-[var(--dim)]">{f.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-20 grid gap-x-16 gap-y-10 md:grid-cols-2">
            {nerds.details.map((d) => (
              <div key={d.title} className="border-t border-[var(--line)] pt-5">
                <h3 className="text-[18px] font-semibold">{d.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-[var(--dim)]">{d.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-14 font-[family-name:var(--d-mono)] text-[11px] text-[var(--dim)]">{nerds.stack.join(" + ")}</p>
        </div>
      </section>

      {/* ── Closing ── */}
      <section aria-labelledby="d-close" className="border-t border-[var(--line)]">
        <div className="mx-auto max-w-[1440px] px-5 py-28 md:px-8 lg:py-40">
          <h2 id="d-close" className="max-w-[16ch] text-[clamp(40px,6vw,100px)] leading-[0.96] font-bold tracking-[-0.05em]">{closing.headline}</h2>
          <div className="mt-10 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <p className="max-w-[46ch] text-[18px] leading-relaxed text-[var(--dim)]">{closing.body}</p>
            <div className="flex flex-wrap items-center gap-5">
              <Link href={nav.primary.href} className="rounded-full bg-[var(--acid)] px-6 py-3.5 text-[15px] font-semibold text-[var(--bg)] transition-transform active:scale-[0.98]">
                {nav.primary.label}
              </Link>
              <Link href={nav.secondary.href} className="rounded-full border border-[var(--line)] px-6 py-3.5 text-[15px] hover:border-[var(--bone)]">
                {nav.secondary.label}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-5 pt-8 pb-20 md:flex-row md:items-center md:justify-between md:px-8">
          <p className="text-[15px]">
            <span className="font-bold">baton<span className="text-[var(--acid)]">.</span></span> <span className="text-[var(--dim)]">{footer.tagline}</span>
          </p>
          <ul className="flex gap-6 font-[family-name:var(--d-mono)] text-[11px] text-[var(--dim)] uppercase">
            {footer.links.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="hover:text-[var(--bone)]">
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
