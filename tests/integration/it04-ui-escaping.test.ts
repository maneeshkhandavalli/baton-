// IT-04 (UI half, §12.10 rule 2): model and source text is rendered only as escaped text. Real components
// are rendered to static markup (react-dom/server) with hostile model output in titles, statements, quotes,
// labels and summaries; plus a static check that no component or page uses dangerouslySetInnerHTML.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EvidenceQuote } from "../../components/review/evidence-quote";
import { PointCard } from "../../components/review/point-card";
import { PublishedHandoverView } from "../../components/published/published-handover-view";
import { MaskedText } from "../../components/shared/masked-text";
import { mapPointDetail } from "../../lib/db/mappers";
import { resetPlatform } from "./support/platform";
import { pointDetailRow } from "./support/rows";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const HOSTILE = {
  img: `<img src=x onerror=alert(1)>`,
  script: `<script>alert(document.cookie)</script>`,
  link: `[click](javascript:alert(1))`,
  iframe: `<iframe srcdoc="<script>alert(2)</script>"></iframe>`,
  svg: `<svg onload=alert(3)>`,
};
const ALL = Object.values(HOSTILE).join(" ");

/** No live markup from the hostile strings: no such element, no event-handler attribute, no js: URL. */
function assertInert(html: string, label: string) {
  // (<svg> elements are legitimate here: the icons. A hostile one would carry onload, checked below.)
  assert.doesNotMatch(html, /<(img|script|iframe)\b/i, `${label}: a hostile element was rendered`);
  // inside a real start tag (escaped text contains "onerror=" too, but never a literal "<" before it)
  // Quoted attribute VALUES are escaped text (e.g. title="&lt;svg onload=…&gt;") and can't create a handler;
  // blank them so only real attribute NAMES are checked.
  const tags = html.replace(/="[^"]*"/g, '=""');
  assert.doesNotMatch(tags, /<[a-z][^>]*\son[a-z]+\s*=/i, `${label}: an event-handler attribute was rendered`);
  assert.doesNotMatch(html, /<[a-z][^>]*\s(href|src)\s*=\s*["']?\s*javascript:/i, `${label}: a javascript: URL was rendered`);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;|&lt;script&gt;/, `${label}: the text is shown, escaped`);
}

describe("IT-04 (UI): hostile model text renders as escaped text", () => {
  it("control: the check does catch live markup", () => {
    assert.throws(() => assertInert(renderToStaticMarkup(createElement("img", { src: "x" })), "control"), /hostile element/);
    assert.throws(() => assertInert(`<span onclick="x">&lt;script&gt;</span>`, "control"), /event-handler/);
  });

  it("MaskedText (every masked-text surface uses it)", () => {
    const html = renderToStaticMarkup(createElement(MaskedText, { text: `${ALL} [PHONE_1] [EXCLUDED_PARTICIPANT]` }));
    assertInert(html, "MaskedText");
    assert.match(html, /\[PHONE_1\]/, "mask tokens still render as chips");
  });

  it("EvidenceQuote (quote, author label, source title)", () => {
    const html = renderToStaticMarkup(createElement(EvidenceQuote, {
      quote: ALL, kind: "source_quote", authorLabel: HOSTILE.img, sentAt: "2026-02-06T07:30:00Z", sourceTitle: HOSTILE.script,
    }));
    assertInert(html, "EvidenceQuote");
  });

  it("PointCard (title, statement, evidence quotes) from a real mapped PointDetail", () => {
    resetPlatform();
    const point = mapPointDetail(pointDetailRow("00000000-0000-4000-8000-0000000000b1", "decision", {
      title: `Stall volunteers ${HOSTILE.script}`,
      statement: `Needs ${HOSTILE.img} ${HOSTILE.link}`,
      evidence: [{
        point_evidence_id: "00000000-0000-4000-8000-0000000000b2", evidence_id: "00000000-0000-4000-8000-0000000000b3",
        kind: "source_quote", quote: `the stall needs ${HOSTILE.iframe}`, author_label: HOSTILE.svg, sent_at: "2026-02-06T07:30:00Z",
        source_title: "chat.txt", location: null, quote_check: "exact", support_verdict: "supports", verdict_rationale: HOSTILE.img,
        is_current_revision_verdict: true, excluded: false, exclusion_reason: null, access_level: "everyone",
      }],
    }));
    const html = renderToStaticMarkup(createElement(PointCard, {
      point, selected: true, readOnly: false, gapQuestion: undefined, onSelect: () => {}, onAction: () => {}, pending: false,
    }));
    assertInert(html, "PointCard");
  });

  it("PublishedHandoverView (title, team, summary, point text, attributes, evidence) as an incoming member sees it", () => {
    resetPlatform();
    const html = renderToStaticMarkup(createElement(PublishedHandoverView, {
      viewerLabel: HOSTILE.svg,
      viewerRole: "incoming",
      preview: true,
      handover: {
        handoverId: "00000000-0000-4000-8000-0000000000c1", title: `Handover ${HOSTILE.script}`, teamName: HOSTILE.img,
        roleTitle: HOSTILE.link, publicationId: "00000000-0000-4000-8000-0000000000c2", version: 1, publishedAt: "2026-11-12T10:00:00Z",
        publishedByLabel: HOSTILE.svg, summary: `Summary ${ALL}`, viewerAcknowledgedAt: null,
        sections: [{
          category: "open_task",
          points: [{
            id: "00000000-0000-4000-8000-0000000000c3",
            content: {
              title: `Find volunteers ${HOSTILE.script}`, statement: `The stall needs ${HOSTILE.img} ${HOSTILE.link}`,
              attributes: { assigneeLabel: HOSTILE.svg, dueDate: null, progressNote: HOSTILE.iframe },
              evidenceStatus: "sourced", isPotentiallyOutdated: false, isKnownGap: false, inferredConfirmation: null,
              conflictResolution: null, evidenceRedacted: false,
              evidence: [{ evidenceId: "00000000-0000-4000-8000-0000000000c4", redacted: false, kind: "source_quote",
                quote: `needs ${HOSTILE.img}`, authorLabel: HOSTILE.script, sentAt: "2026-02-06T07:30:00Z", sourceTitle: "chat.txt",
                stance: "supports", authorProfileId: null }],
            },
          }],
        }],
      },
    }));
    assertInert(html, "PublishedHandoverView");
  });
});

describe("IT-04 (UI): no raw-HTML escape hatches in the rendering code", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(name)) files.push(full);
    }
  };
  for (const dir of ["components", "app", "hooks"]) walk(join(ROOT, dir));

  it("scans the review, published and shared components", () => {
    const rel = files.map((f) => relative(ROOT, f).split(sep).join("/"));
    for (const expected of ["components/review/point-card.tsx", "components/published/published-handover-view.tsx", "components/shared/masked-text.tsx"]) {
      assert.ok(rel.includes(expected), `${expected} is scanned`);
    }
  });

  it("no component, page or hook uses dangerouslySetInnerHTML, innerHTML or a Markdown-to-HTML renderer", () => {
    const offenders = files
      .filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|react-markdown|marked\(|markdown-it/.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    assert.deepEqual(offenders, []);
  });
});
