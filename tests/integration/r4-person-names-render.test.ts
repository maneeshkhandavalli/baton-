// R4 hotfix: point attributes ("Held by", "Decided by", "Owner"…), the key-facts strip and the "Your first 7 days"
// checklist are built from stored, pseudonymised strings. They must render through MaskedText, so a viewer with
// clearance sees the name (as evidence authors already did), a viewer without one sees "Person n", and the raw
// "[PERSON_n]" token is never in the markup.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { buildFirstWeek } from "../../components/published/first-week";
import { PublishedHandoverView } from "../../components/published/published-handover-view";
import { PointDetailPanel } from "../../components/review/point-detail-panel";
import { PeopleNames } from "../../components/shared/person-token";
import { HandoverTimeline } from "../../components/timeline/handover-timeline";
import type { PublishedHandover, PublishedPointContent } from "../../lib/contracts/dto";
import { mapPointDetail } from "../../lib/db/mappers";
import { CODECELL_ID } from "../../lib/mocks/fixtures/codecell";
import { PROFILES } from "../../lib/mocks/fixtures/profiles";
import { createMockQueries } from "../../lib/mocks/queries";
import { pointDetailRow } from "./support/rows";

const NAMES: ReadonlyMap<number, string> = new Map([[1, "Priya Raman"], [2, "Kabir Shah"]]);
const RAW = /\[PERSON_\d+\]/;
/** `prefix` followed by a resolved person chip showing `name`. */
const chip = (prefix: string, name: string) => new RegExp(`${prefix}(?:</span>)?<span data-token="person"[^>]*>${name}</span>`);
const withNames = (el: ReactElement) => createElement(PeopleNames, { names: NAMES }, el);

describe("R4 hotfix: person tokens in attributes and the first-week checklist render as names", async () => {
  const published = await createMockQueries(PROFILES.neha.id).getPublishedHandover(CODECELL_ID);
  assert.ok(published.ok);

  const content = (title: string, attributes: unknown): PublishedPointContent => ({
    title, statement: `${title}, in full.`, attributes: attributes as PublishedPointContent["attributes"], evidenceStatus: "sourced",
    isPotentiallyOutdated: false, isKnownGap: false, inferredConfirmation: null, conflictResolution: null, evidence: [], evidenceRedacted: false,
  });
  const fixture: PublishedHandover = {
    ...published.data,
    sections: [
      { category: "decision", points: [{ id: "p-dec", content: content("Mixed judging panel", { decidedAt: "2026-08-04", decidedByLabel: "[PERSON_1]", rationale: "Asked by [PERSON_2]", alternativesConsidered: [] }) }] },
      { category: "account_access", points: [{ id: "p-acc", content: content("GitHub org", { system: "GitHub", holderLabel: "[PERSON_1]", accessLocation: "Vault", recoveryNote: "[PERSON_1] adds [PERSON_2]" }) }] },
      { category: "contact", points: [{ id: "p-con", content: content("Dean's office", { nameLabel: "[PERSON_2]", organisation: "Dean's office", roleDescription: "Approvals", preferredChannel: null, directContact: null }) }] },
      { category: "owner", points: [{ id: "p-gap", content: { ...content("Who signs before [PERSON_1] goes?", { responsibility: "Signing", ownerLabel: null, since: null }), isKnownGap: true, evidenceStatus: "missing" } }] },
    ],
  };

  it("the first-week builder keeps the stored tokens for MaskedText to resolve", () => {
    const items = buildFirstWeek(fixture).flatMap((d) => d.items);
    assert.ok(items.some((i) => i.title === "Introduce yourself to [PERSON_2]"));
    assert.ok(items.some((i) => i.detail?.startsWith("Held by [PERSON_1]")));
  });

  it("published view: names resolve in key facts, attribute rows and the checklist; no raw token", () => {
    const html = renderToString(withNames(createElement(PublishedHandoverView, { handover: fixture, viewerLabel: "Neha", viewerRole: "incoming" })));
    assert.doesNotMatch(html, RAW);
    assert.match(html, chip("Introduce yourself to ", "Kabir Shah"));
    assert.match(html, chip("Held by ", "Priya Raman"));
    assert.match(html, chip("Asked by ", "Kabir Shah"));
    assert.match(html, chip("Find out: Who signs before ", "Priya Raman"));
    assert.match(html, chip(">By</dt><dd[^>]*><span>", "Priya Raman"), "key facts strip");
  });

  it("published view without a PeopleProvider (demo) falls back to 'Person n'; no raw token", () => {
    const html = renderToString(createElement(PublishedHandoverView, { handover: fixture, viewerLabel: "Neha", viewerRole: "incoming", preview: true }));
    assert.doesNotMatch(html, RAW);
    assert.doesNotMatch(html, /data-token="person"[^>]*>(Priya Raman|Kabir Shah)</, "no chip resolves a name without a provider");
    assert.match(html, /Person 1/);
    assert.match(html, /Person 2/);
  });

  it("timeline: key facts resolve names; no raw token", () => {
    const html = renderToString(withNames(createElement(HandoverTimeline, { handover: fixture })));
    assert.doesNotMatch(html, RAW);
    assert.match(html, chip("", "Priya Raman"));
    const bare = renderToString(createElement(HandoverTimeline, { handover: fixture }));
    assert.doesNotMatch(bare, RAW);
    assert.match(bare, /Person 1/);
  });

  it("review detail panel: attribute rows resolve names; no raw token", () => {
    const point = mapPointDetail(
      pointDetailRow("00000000-0000-4000-8000-0000000000d1", "account_access", {
        title: "GitHub org",
        statement: "[PERSON_1] holds the GitHub org.",
        attributes: { system: "GitHub", holderLabel: "[PERSON_1]", accessLocation: "Vault", recoveryNote: null },
      }),
    );
    const panel = createElement(PointDetailPanel, { point, sources: [], readOnly: true, pending: false, onExclude: () => {}, onRestore: () => {}, onChangeAccess: () => {} });
    const html = renderToString(withNames(panel));
    assert.doesNotMatch(html, RAW);
    assert.match(html, chip("Held by</dt><dd[^>]*><span>", "Priya Raman"));
  });
});
