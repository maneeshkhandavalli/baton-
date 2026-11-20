import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const NO_CONTROLS = ["<button", "<input", "<textarea", "<select", "onClick", "href=", "<Link", "<form"];

describe("landing: what works today, early access, preview (roadmap)", () => {
  const src = read("components/marketing/coming-next.tsx");
  it("labels each stage honestly", () => {
    assert.equal((src.match(/data-tone="live"/g) ?? []).length, 1, "one 'Works today' stage");
    assert.match(src, /Works today/);
    assert.equal((src.match(/<EarlyAccessLabel \/>/g) ?? []).length, 1, "the connectors stage is Early access");
    assert.equal((src.match(/<PreviewLabel \/>/g) ?? []).length, 1, "Ask the Handover is a Preview");
    assert.match(src, /title: "Ask the Handover"/);
    assert.match(src, /not\s+features you can use today/);
    assert.match(src, /Not built yet\. Nothing here works today\./, "Ask the Handover says it does not exist yet");
  });
  it("presents the connectors as built but not live", () => {
    for (const name of ["GitHub", "Discord", "Telegram", "Slack"]) assert.ok(src.includes(name), name);
    assert.match(src, /not yet set up with real apps or verified live/);
    assert.doesNotMatch(src, /\bavailable\b|\blive sync|\bsyncs? (?:automatically|in real time)/i);
  });
  it("contains no working-looking controls (no buttons, inputs, links or handlers)", () => {
    for (const bad of NO_CONTROLS) assert.ok(!src.includes(bad), bad);
  });
  it("sits on the landing page", () => assert.match(read("app/(marketing)/page.tsx"), /<ComingNext \/>/));
  it("Preview and Early access labels never look like the 'Works today' tag", () => {
    const preview = read("components/marketing/preview-label.tsx");
    assert.match(preview, /data-tone="preview"/);
    assert.match(preview, />\s*Preview\s*</);
    const early = read("components/marketing/early-access-label.tsx");
    assert.match(early, /data-tone="early"/);
    assert.match(early, />\s*Early access\s*</);
    assert.match(read("app/(marketing)/identity.css"), /\.bi-tag\[data-tone="early"\]/);
  });
});

describe("landing: Living Handovers", () => {
  const src = read("components/marketing/living-handover.tsx");
  it("separates what works today from the bot-driven part", () => {
    assert.equal((src.match(/data-tone="live"/g) ?? []).length, 1, "one 'Works today' tag");
    assert.match(src, /Works today/);
    assert.equal((src.match(/<EarlyAccessLabel \/>/g) ?? []).length, 1, "watching a connected channel is Early access");
    assert.match(src, /nothing syncs today/);
  });
  it("describes the real change review: a reviewer decides, publishing waits, published versions are kept", () => {
    assert.match(src, /waits\s+for a reviewer/);
    assert.match(src, /publishing waits until each one is decided/);
    assert.match(src, /earlier published versions stay exactly as they were/);
    for (const kind of ["New information", "Possible contradiction", "Quotation moved"]) assert.ok(src.includes(kind), kind);
  });
  it("contains no working-looking controls", () => {
    for (const bad of NO_CONTROLS) assert.ok(!src.includes(bad), bad);
  });
  it("sits on the landing page", () => assert.match(read("app/(marketing)/page.tsx"), /<LivingHandover \/>/));
});

describe("landing: calls to action, anchors and the marketing header", () => {
  const page = read("app/(marketing)/page.tsx");
  const header = read("components/marketing/marketing-header.tsx");
  it("offers Start a handover and the demo in the hero and the closing section", () => {
    const cta = read("components/marketing/cta.tsx");
    assert.match(cta, /href=\{routes\.handover\.new\}/);
    assert.match(cta, /Start a handover/);
    assert.match(cta, /href=\{routes\.demo\}/);
    assert.equal((page.match(/<LandingCtas[ />]/g) ?? []).length, 2);
  });
  it("keeps the section anchors the header links to", () => {
    const all = page + read("components/marketing/for-the-nerds.tsx");
    for (const id of ["how-it-works", "evidence", "privacy", "for-the-nerds"]) {
      assert.ok(all.includes(`id="${id}"`), id);
      assert.ok(header.includes(`#${id}`), `header links to #${id}`);
    }
  });
  it("the marketing layout uses its own header and footer; the workspace header is untouched", () => {
    const layout = read("app/(marketing)/layout.tsx");
    assert.match(layout, /<MarketingHeader \/>/);
    assert.match(layout, /<MarketingFooter \/>/);
    assert.match(read("components/layout/site-header.tsx"), /export function SiteHeader/);
  });
  it("the header keeps the skip link, the theme toggle, and one session-aware action streamed in Suspense", () => {
    assert.match(header, /href="#main"/);
    assert.match(header, /<ThemeToggle( className="[^"]*")? \/>/);
    assert.match(header, /<Suspense fallback=\{<MarketingHeaderActionsFallback \/>\}>\s*<MarketingHeaderActions \/>/);
    assert.doesNotMatch(header, /href=\{routes\.dashboard\}/,"the header itself never hard-codes the workspace action");
  });
  it("signed in: the account menu and 'Open workspace' once; signed out: 'Sign in' only", () => {
    const actions = read("components/marketing/marketing-header-actions.tsx");
    assert.match(actions, /await connection\(\)/);
    assert.match(actions, /supabase\.auth\.getUser\(\)/);
    assert.match(actions, /<AccountMenu /);
    assert.equal((actions.match(/href=\{routes\.dashboard\}/g) ?? []).length, 1, "one workspace link");
    assert.equal((actions.match(/>Open workspace</g) ?? []).length, 1);
    assert.match(actions, /data-session="in"/);
    assert.match(actions, /data-session="out"/);
    assert.match(actions, /href=\{routes\.login\}/);
    assert.match(actions, /<noscript>\s*<SignInLink \/>\s*<\/noscript>/, "no-JS visitors still get Sign in");
    assert.match(read("app/(marketing)/landing.css"), /:has\(\.lp-nav \[data-session="in"\]\) \.lp-hero__ctas \[data-cta="primary"\]/, "signed in, the hero's demo pill steps back");
  });
  it("one primary per call-to-action group, and no third copy mid-page or in the footer", () => {
    const cta = read("components/marketing/cta.tsx");
    assert.equal((cta.match(/data-cta="primary"/g) ?? []).length, 1);
    assert.match(cta, /href=\{routes\.demo\} className="lp-cta" data-cta="primary"/, "the demo is the primary action");
    assert.doesNotMatch(page, /<Link/, "no standalone CTA links on the page besides the two LandingCtas groups");
    const footer = read("components/marketing/marketing-footer.tsx");
    assert.doesNotMatch(footer, /<Link|href=/, "the footer stays minimal");
  });
  it("no em dashes in landing copy", () => {
    const files = [
      "app/(marketing)/page.tsx",
      "app/(marketing)/layout.tsx",
      "app/(marketing)/loading.tsx",
      ...["cta", "coming-next", "evidence-preview", "for-the-nerds", "hero-mosaic", "how-it-works", "living-handover", "marketing-footer", "marketing-header", "marketing-header-actions", "intro-splash", "brand-loader", "rotating-word"].map((f) => `components/marketing/${f}.tsx`),
    ];
    for (const f of files) assert.ok(!read(f).includes(String.fromCharCode(0x2014)), f);
  });
});

describe("landing: motion respects reduced-motion", () => {
  it("CSS only animates inside prefers-reduced-motion: no-preference", () => {
    for (const f of ["app/(marketing)/identity.css", "app/(marketing)/landing.css"]) {
      const css = read(f);
      const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, "");
      assert.ok(!/animation:\s*(?:bi|lp)-/.test(outside), `${f}: no animation outside the no-preference block`);
    }
  });
  it("the scroll choreography only runs when motion is allowed", () => {
    const src = read("components/marketing/landing-motion.tsx");
    assert.match(src, /gsap\.matchMedia\(\)/);
    assert.match(src, /motion: "\(prefers-reduced-motion: no-preference\)"/);
    assert.match(src, /if \(!motion\) return;/);
    assert.doesNotMatch(src, /\bpin:\s*true/, "no ScrollTrigger pinning (sticky CSS instead), so nothing traps the scroll");
  });
  it("the cycling word and the mosaic stop for reduced motion and rest after one pass", () => {
    for (const f of ["components/marketing/rotating-word.tsx", "components/marketing/hero-mosaic.tsx"]) {
      const src = read(f);
      assert.match(src, /prefers-reduced-motion: no-preference/, f);
      assert.match(src, /clearInterval/, f);
    }
  });
  it("Lenis stays off for reduced motion and touch-first devices", () => {
    const src = read("components/marketing/smooth-scroll.tsx");
    assert.match(src, /prefers-reduced-motion: reduce/);
    assert.match(src, /\(hover: none\) and \(pointer: coarse\)/);
  });
});

describe("landing: For the nerds", () => {
  it("covers the five required topics, collapsed by default", () => {
    const src = read("components/marketing/for-the-nerds.tsx");
    for (const t of ["PII masking and privacy", "Evidence and source traceability", "AI extraction and verification", "Human review", "Publishing and access controls"]) assert.ok(src.includes(`title: "${t}"`), t);
    assert.match(src, /<details key=\{t\.title\}/);
    assert.ok(!/<details[^>]*\bopen\b/.test(src), "no topic opens by default");
  });
});

describe("landing: loading", () => {
  it("the route fallback is a polite, busy status with the brand loader", () => {
    const src = read("app/(marketing)/loading.tsx");
    assert.match(src, /role="status"/);
    assert.match(src, /aria-busy="true"/);
    assert.match(src, /<BrandLoader looping \/>/);
  });
  it("the intro splash is decorative, once per session, motion-only and never shown without JavaScript", () => {
    const src = read("components/marketing/intro-splash.tsx");
    assert.match(src, /^"use client";/);
    assert.match(src, /aria-hidden="true"/);
    // the pre-paint decision is a static classic script, never injected raw HTML (IT-04)
    assert.match(src, /<script src=\{INTRO_SPLASH_INIT_SRC\} \/>/);
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/);
    const init = read("public/intro-splash-init.js");
    assert.match(init, /sessionStorage\.getItem\("baton:intro-seen"\)/);
    assert.match(init, /try\{[\s\S]*sessionStorage[\s\S]*\}catch/);
    assert.match(init, /prefers-reduced-motion: no-preference/);
    assert.match(init, /setAttribute\("data-show",""\)/, "only the init script reveals it");
    assert.match(read("app/(marketing)/page.tsx"), /<IntroSplash \/>/);
    const css = read("app/(marketing)/landing.css");
    assert.match(css, /\.lp-splash \{\s*display: none;/, "hidden by default (no JS, reduced motion)");
    const motion = css.match(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g) ?? [];
    assert.ok(motion.some((b) => /\.lp-splash\[data-show\] \{\s*display: grid;/.test(b)), "shown only inside the motion block");
    assert.ok(motion.some((b) => /lp-splash-out 0\.3s ease-in 0\.6s forwards/.test(b)), "CSS failsafe fades it by about 900 ms");
  });
});
