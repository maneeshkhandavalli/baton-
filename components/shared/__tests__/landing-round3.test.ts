import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const NO_CONTROLS = ["<button", "<input", "<textarea", "<select", "onClick", "href=", "<Link", "<form"];

describe("landing: previews (coming next)", () => {
  const src = read("components/marketing/coming-next.tsx");
  it("are clearly labelled and say they are not available yet", () => {
    assert.match(src, /Coming next/);
    assert.match(src, /not features you can use today/);
    assert.equal((src.match(/<PreviewLabel \/>/g) ?? []).length, 1, "one label rendered per preview item");
    for (const title of ["Discord and Telegram bots", "Ask the Handover"]) assert.ok(src.includes(title), title);
  });
  it("contain no working-looking controls (no buttons, inputs, links or handlers)", () => {
    for (const bad of NO_CONTROLS) assert.ok(!src.includes(bad), bad);
  });
  it("give Discord and Telegram the same space", () => {
    assert.match(src, /<Pane label="Discord ·/);
    assert.match(src, /<Pane label="Telegram ·/);
    assert.match(src, /grid gap-3 sm:grid-cols-2/);
  });
  it("sit on the landing page", () => assert.match(read("app/(marketing)/page.tsx"), /<ComingNext \/>/));
  it("share one Preview label that never looks like the 'Works today' tag", () => {
    const label = read("components/marketing/preview-label.tsx");
    assert.match(label, /data-tone="preview"/);
    assert.match(label, />\s*Preview\s*</);
  });
});

describe("landing: Living Handovers", () => {
  const src = read("components/marketing/living-handover.tsx");
  it("separates what works today from the preview", () => {
    assert.equal((src.match(/data-tone="live"/g) ?? []).length, 1, "one 'Works today' tag");
    assert.match(src, /Works today/);
    assert.equal((src.match(/<PreviewLabel \/>/g) ?? []).length, 1, "the Living Handover preview is labelled");
    assert.match(src, /Living Handover/);
    assert.match(src, /not a feature you can use today/);
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

describe("landing: calls to action and anchors", () => {
  const page = read("app/(marketing)/page.tsx");
  it("offers Start a handover and the demo in the hero and the closing section", () => {
    const cta = read("components/marketing/cta.tsx");
    assert.match(cta, /href=\{routes\.handover\.new\}/);
    assert.match(cta, /Start a handover/);
    assert.match(cta, /href=\{routes\.demo\}/);
    assert.equal((page.match(/<LandingCtas[ />]/g) ?? []).length, 2);
  });
  it("keeps the header's section anchors", () => {
    const all = page + read("components/marketing/for-the-nerds.tsx");
    for (const id of ["how-it-works", "evidence", "privacy", "for-the-nerds"]) assert.ok(all.includes(`id="${id}"`), id);
  });
});

describe("landing: motion respects reduced-motion", () => {
  const css = read("app/(marketing)/identity.css");
  it("only animates inside prefers-reduced-motion: no-preference", () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, "");
    assert.ok(!/animation:\s*bi-/.test(outside), "no bi-* animation outside the no-preference block");
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
