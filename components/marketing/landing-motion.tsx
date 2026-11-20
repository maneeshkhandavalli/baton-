"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect } from "react";

/**
 * The landing page's scroll choreography (reference: Loopsii, which drives the same moments with GSAP ScrollTrigger
 * on top of Lenis; docs/design/landing/loopsii-reference-breakdown.md). Pinned moments are CSS `position: sticky` (no
 * ScrollTrigger pinning, so nothing traps the scroll or changes the page height); GSAP only scrubs properties.
 *
 * Everything is created inside `gsap.matchMedia("(prefers-reduced-motion: no-preference)")`, so with reduced motion
 * nothing runs and every section keeps its complete, final layout (the CSS default). Reverting on preference change
 * or unmount restores that layout too.
 *
 *  hero      headline lines rise, lede and CTAs fade up, tiles pop in from the centre; on exit the mosaic grows
 *  intro     the Baton disc (sticky) grows; the orbit of what a handover carries scrubs out and turns
 *  problem   the dark panel's clip opens to full bleed while the intro blurs; pills pop in; the panel lifts off
 *  receipt   the lime headline shrinks and rises as the product window comes up over it
 *  steps     each stacked card shrinks and dims as the next one covers it (desktop)
 *  living    folder tabs slide up in turn
 *  roadmap   the cards ride a tick-marked wheel that turns with the scroll
 *  outro     the stair-stepped words rise in turn
 */

const IO = "power4.inOut"; // ≈ cubic-bezier(.84, 0, .16, 1), the reference's main curve

export function LandingMotion() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const mm = gsap.matchMedia();
    const q = <T extends Element = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));
    const one = (sel: string) => document.querySelector<HTMLElement>(sel);

    mm.add(
      {
        motion: "(prefers-reduced-motion: no-preference)",
        desktop: "(min-width: 1024px)",
      },
      (ctx) => {
        const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean };
        if (!motion) return;

        // ── Hero entrance ──
        gsap.from(q("[data-hero-line] > span"), { yPercent: 105, duration: 1, ease: IO, stagger: 0.1, delay: 0.1 });
        gsap.from(q("[data-hero-fade]"), { opacity: 0, y: 24, duration: 0.8, ease: "power3.out", stagger: 0.08, delay: 0.45 });
        const tiles = q("[data-mosaic] [data-tile]:not(.lp-tile--hole) > i");
        gsap.from(tiles, { scale: 0, duration: 0.6, ease: "back.out(1.2)", stagger: { each: 0.018, from: "center" }, delay: 0.35 });
        gsap.from(q("[data-disc]"), { scale: 0, rotate: -90, duration: 0.9, ease: "back.out(1.2)", delay: 0.25 });

        // ── Hero exit → intro: mosaic grows, the disc grows, the orbit comes out ──
        const hero = one("[data-hero]");
        const intro = one("[data-intro]");
        const disc = one("[data-disc]");
        const orbit = one("[data-orbit]");
        if (hero) {
          gsap.to("[data-mosaic]", {
            scale: desktop ? 1.32 : 1.18,
            ease: "none",
            scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: true },
          });
        }
        if (intro && disc && orbit) {
          gsap.fromTo(disc, { "--disc-scale": 1 }, {
            "--disc-scale": desktop ? 1.6 : 1.5,
            ease: "none",
            scrollTrigger: { trigger: intro, start: "top bottom", end: "top 20%", scrub: true },
          });
          gsap.fromTo(
            orbit,
            { "--orbit-out": 0, "--orbit-o": 0 },
            { "--orbit-out": 1, "--orbit-o": 1, ease: "power2.out", scrollTrigger: { trigger: "[data-intro-head]", start: "top 75%", end: "top 20%", scrub: true } },
          );
          gsap.fromTo(orbit, { "--orbit-rot": "-40deg" }, { "--orbit-rot": "50deg", ease: "none", scrollTrigger: { trigger: intro, start: "top bottom", end: "bottom top", scrub: true } });
        }

        // ── Problem: the dark panel ──
        const problem = one("[data-problem]");
        const panel = one("[data-problem-panel]");
        if (problem && panel) {
          const inset = desktop ? 24 : 12;
          gsap.fromTo(
            panel,
            { "--clip-x": `${inset}px`, "--clip-t": "0px", "--clip-r": desktop ? "45px" : "28px" },
            { "--clip-x": "0px", "--clip-r": "0px", ease: "none", scrollTrigger: { trigger: problem, start: "top bottom", end: "top top", scrub: true } },
          );
          const loop = one("[data-loop]");
          if (loop) {
            gsap.to(loop, { filter: "blur(10px)", opacity: 0.6, ease: "none", scrollTrigger: { trigger: problem, start: "top bottom", end: "top top", scrub: true } });
          }
          const tl = gsap.timeline({ scrollTrigger: { trigger: problem, start: "top 40%", end: "bottom bottom", scrub: 0.6 } });
          if (desktop) {
            tl.from("[data-problem-a]", { xPercent: 40, yPercent: 120, duration: 1, ease: "power2.out" }, 0);
            tl.from("[data-problem-b]", { xPercent: -40, yPercent: -120, duration: 1, ease: "power2.out" }, 0);
          }
          tl.from("[data-paren]", { scale: 0.4, opacity: 0, duration: 0.4 }, 0.1);
          tl.from(q("[data-q]"), { scale: 0.6, opacity: 0, y: 12, duration: 0.3, ease: "back.out(1.2)", stagger: 0.07 }, 0.2);
          tl.from("[data-lost]", { opacity: 0, y: 20, duration: 0.4 }, 0.9);
          tl.to({}, { duration: 0.4 });
          gsap.fromTo(
            panel,
            { "--clip-b": "0px" },
            {
              "--clip-x": `${inset}px`,
              "--clip-r": desktop ? "45px" : "28px",
              "--clip-b": "24px",
              ease: "none",
              immediateRender: false,
              scrollTrigger: { trigger: problem, start: "bottom bottom", end: "bottom 40%", scrub: true },
            },
          );
        }

        // ── Receipt: lime band headline + window ──
        const receipt = one("[data-receipt]");
        if (receipt) {
          gsap.fromTo(
            "[data-receipt-title]",
            { "--title-s": desktop ? 1.45 : 1.2, "--title-y": "16svh" },
            { "--title-s": 1, "--title-y": "-26svh", ease: "none", scrollTrigger: { trigger: receipt, start: "top -20%", end: "top -110%", scrub: true } },
          );
          gsap.from("[data-window]", { y: 120, ease: "none", scrollTrigger: { trigger: "[data-window]", start: "top bottom", end: "top 40%", scrub: true } });
          gsap.from(q("[data-fan] > span"), { yPercent: 30, stagger: 0.1, ease: "none", scrollTrigger: { trigger: "[data-window]", start: "top bottom", end: "top 30%", scrub: true } });
        }

        // ── Steps: stacked cards ──
        if (desktop) {
          const cards = q("[data-step-card]");
          cards.forEach((card, i) => {
            const next = cards[i + 1];
            if (!next) return;
            gsap.fromTo(card, { scale: 1, filter: "brightness(1)" }, {
              scale: 0.94,
              filter: "brightness(0.86)",
              ease: "none",
              immediateRender: false,
              scrollTrigger: { trigger: next, start: "top bottom", end: "top 45%", scrub: true },
            });
          });
        }

        // ── Living Handovers: folder tabs ──
        const folders = q("[data-folder]");
        if (folders.length) {
          gsap.from(folders, { yPercent: 45, stagger: 0.08, ease: "power2.out", scrollTrigger: { trigger: "[data-folders]", start: "top 95%", end: "top 25%", scrub: true } });
        }

        // ── Roadmap wheel ──
        const roadmap = one("[data-roadmap]");
        if (roadmap) {
          roadmap.classList.add("is-wheel");
          const step = parseFloat(getComputedStyle(one("[data-wheel]") ?? roadmap).getPropertyValue("--step")) || 21;
          const count = q("[data-rcard]").length;
          gsap.fromTo(
            "[data-wheel]",
            { "--wheel": "0deg" },
            { "--wheel": `${-(count - 1) * step}deg`, ease: "power1.inOut", scrollTrigger: { trigger: roadmap, start: "top top", end: "bottom bottom", scrub: 0.5 } },
          );
          ScrollTrigger.refresh();
        }

        // ── Outro words ──
        gsap.from(q("[data-outro-word]"), {
          yPercent: 60,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
          stagger: 0.12,
          scrollTrigger: { trigger: "[data-outro]", start: "top 70%", toggleActions: "play none none reverse" },
        });

        // ── Generic reveals ──
        q("[data-reveal]").forEach((el) => {
          gsap.from(el, { opacity: 0, y: 40, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", toggleActions: "play none none none" } });
        });

        return () => {
          roadmap?.classList.remove("is-wheel");
        };
      },
    );

    // Fonts and images change heights after first layout.
    const refresh = () => ScrollTrigger.refresh();
    document.fonts?.ready.then(refresh).catch(() => {});
    window.addEventListener("load", refresh);
    return () => {
      window.removeEventListener("load", refresh);
      mm.revert();
    };
  }, []);

  return null;
}
