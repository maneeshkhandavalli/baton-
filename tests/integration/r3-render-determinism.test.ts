// Round 3 QA (Agent 5): the lead's headless run saw a hydration mismatch on /preview/published and an
// "Element type is invalid … got: undefined" on /preview/dashboard (95423e9). Both previews render SHARED
// components that the real routes use: PublishedHandoverView (/handover/[id]/published, /demo incoming tab)
// and DraftRow → DiscardDraftButton → ConfirmDialog (/dashboard). This file proves, below Next.js, that those
// shared trees:
//   - render without an undefined element type (every import resolves to a component), and
//   - produce byte-identical markup whatever the process time zone (server in UTC, reader in India or
//     elsewhere), which is the usual source of hydration mismatches; and contain no block element inside a
//     <p> (the browser re-parents those, which React reports as a hydration failure).
// If these hold, a mismatch seen only on a preview route comes from the preview page or from the dev
// server, not from the component the real routes share. The browser check (tests/browser/run.mjs) stays
// the authority for the real routes.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { DraftRow } from "../../components/dashboard/draft-row";
import type { HandoverCardData } from "../../components/dashboard/handover-card";
import { PublishedHandoverView } from "../../components/published/published-handover-view";
import { CODECELL_ID } from "../../lib/mocks/fixtures/codecell";
import { MOCK_VIEWER_ID, PROFILES } from "../../lib/mocks/fixtures/profiles";
import { createMockQueries } from "../../lib/mocks/queries";

const ZONES = ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati"];
const savedTz = process.env.TZ;
after(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

function renderIn(zone: string, element: ReactElement): string {
  process.env.TZ = zone;
  return renderToString(element);
}

/** A block-level start tag inside an open <p> (the HTML parser closes the <p> there; React then mismatches). */
function blockInParagraph(html: string): string | null {
  const BLOCK = /<(div|ul|ol|dl|section|h[1-6]|table|form|nav|header|footer|article|aside|blockquote|pre|hr|p)[\s>]/;
  for (const m of html.matchAll(/<p[\s>]([\s\S]*?)<\/p>/g)) if (BLOCK.test(m[1])) return m[0].slice(0, 200);
  return null;
}

function assertStable(label: string, element: () => ReactElement) {
  const out = ZONES.map((z) => renderIn(z, element()));
  for (let i = 1; i < out.length; i++) assert.equal(out[i], out[0], `${label}: markup differs between ${ZONES[0]} and ${ZONES[i]}`);
  assert.equal(blockInParagraph(out[0]), null, `${label}: block element inside <p>`);
  return out[0];
}

describe("QA: shared trees behind the preview runtime errors render deterministically", async () => {
  const published = await createMockQueries(PROFILES.neha.id).getPublishedHandover(CODECELL_ID);
  assert.ok(published.ok);
  const list = await createMockQueries(MOCK_VIEWER_ID).listMyHandovers();
  assert.ok(list.ok && list.data.length > 0);

  it("control: the time-zone switch does change zone-dependent markup, and the nesting check catches <p><div>", () => {
    const zoned = () => createElement("span", null, new Date(Date.UTC(2026, 0, 1, 20)).toString());
    assert.throws(() => assertStable("control", zoned), /markup differs/);
    assert.notEqual(blockInParagraph(renderToString(createElement("p", null, createElement("div")))), null);
  });

  it("PublishedHandoverView as the real route renders it for an incoming member who has not acknowledged", () => {
    const html = assertStable("published (real route)", () =>
      createElement(PublishedHandoverView, { handover: { ...published.data, viewerAcknowledgedAt: null }, viewerLabel: "Neha", viewerRole: "incoming" }),
    );
    assert.match(html, /Acknowledge handover/);
  });

  it("PublishedHandoverView as /preview/published renders it (acknowledgement disabled)", () => {
    assertStable("published (preview)", () =>
      createElement(PublishedHandoverView, {
        handover: { ...published.data, viewerAcknowledgedAt: null },
        viewerLabel: "Neha",
        viewerRole: "incoming",
        ackDisabledReason: "Preview: acknowledging is turned off here.",
      }),
    );
  });

  it("PublishedHandoverView as /demo renders it (preview, read only)", () => {
    assertStable("published (demo)", () => createElement(PublishedHandoverView, { handover: published.data, viewerLabel: "Neha", viewerRole: "incoming", preview: true }));
  });

  for (const preview of [false, true]) {
    it(`DraftRow with the discard button (${preview ? "/preview/dashboard" : "real /dashboard"}) renders every element`, () => {
      const data: HandoverCardData = {
        handover: { ...list.data[0], state: "draft", viewerIsCreator: true, viewerRole: "outgoing", currentPublicationId: null },
        readiness: null,
        href: "/handover/new?draft=x&step=4",
        cta: "Continue",
        isDemo: false,
        draft: { sources: 2, next: "Scope and start" },
      };
      const html = assertStable("DraftRow", () => createElement("ul", null, createElement(DraftRow, { data, preview })));
      assert.match(html, /aria-label="Discard draft/, "the discard trigger renders");
      assert.match(html, /Continue/);
    });
  }
});
