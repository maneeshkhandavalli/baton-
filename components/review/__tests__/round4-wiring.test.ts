import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Round 4 (Agent A): static wiring checks for .tsx files that test:ui cannot transpile.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Round 4 review wiring", () => {
  it("'Ready to publish' is hidden once the handover is published (audit C3)", () => {
    const panel = read("components/review/readiness-panel.tsx");
    assert.match(panel, /readiness\.blockers\.length === 0 \? \(\s*published \? null : \(/);
    const ws = read("components/review/review-workspace.tsx");
    assert.match(ws, /published=\{handover\.state === "approved" \|\| handover\.state === "acknowledged"\}/);
  });

  it("the Gaps filter uses the same gaps the readiness blocker counts (audit C3)", () => {
    const ws = read("components/review/review-workspace.tsx");
    assert.match(ws, /section === "gaps" && !gapModel\.pointIds\.has\(p\.id\)/);
    assert.match(ws, /gapPointIds=\{gapModel\.pointIds\}/);
  });

  it("testimony is labelled per kind, with the viewer's own statement as 'Your statement' (audit C2)", () => {
    assert.match(read("components/review/review-workspace.tsx"), /withTestimonyLabels\(rawPoints, testimonyContext\(gapQuestions, viewerLabel\)\)/);
    assert.match(read("components/review/load-review.ts"), /viewerLabel: members\.ok \? \(members\.data\.find\(\(m\) => m\.isViewer\)\?\.displayName \?\? null\) : null/);
    assert.match(read("components/review/evidence-quote.tsx"), /\{kind === "testimony" && <span className=\{sep\}>\{testimonyLabel\}<\/span>\}/);
  });

  it("the card never claims a re-verification is running (audit C1)", () => {
    const card = read("components/review/point-card.tsx");
    assert.doesNotMatch(card, /Re-verifying/);
    assert.match(card, /staleEvidenceNote\(point\)/);
  });

  it("Changes-tab titles render person tokens as names (MaskedText)", () => {
    assert.match(read("components/review/change-reviews.tsx"), /<MaskedText text=\{item\.kind === "new_information" \?/);
  });

  it("Confirm answer & approve calls B's confirmTestimonyAndApprove with the expected revision", () => {
    const ws = read("components/review/review-workspace.tsx");
    assert.match(ws, /confirmTestimonyAndApprove\(\{ pointId: point\.id, expectedRevisionId: point\.currentRevisionId \}\)/);
  });

  it("the published and timeline views name testimony 'Answer' with the respondent and date (audit C6)", () => {
    const view = read("components/published/published-handover-view.tsx");
    assert.match(view, /<MaskedText text=\{inferredBasis\(evidence\)\} \/>/);
    assert.match(view, /testimonyLabel="Answer"/);
    assert.match(read("components/timeline/timeline-row.tsx"), /testimonyLabel="Answer"/);
  });

  it("/handover/<id> with no tab redirects to a tab and 404s for unknown handovers (c922cab)", () => {
    const page = read("app/(workspace)/handover/[id]/page.tsx");
    assert.match(page, /if \(!handover\.ok\) notFound\(\);/);
    assert.match(page, /redirect\(routes\.handover\.review\(id\)\)/);
    assert.match(page, /redirect\(routes\.handover\.published\(id\)\)/);
  });

  it("the publish button stays disabled until a partly analysed source is acknowledged (audit 5.21)", () => {
    const ws = read("components/review/review-workspace.tsx");
    assert.match(ws, /disabled=\{isPending \|\| updateBlocks\.length > 0 \|\| \(extractionGaps\.length > 0 && !acknowledgeGaps\)\}/);
    assert.match(ws, /acknowledgeExtractionGaps: extractionGaps\.length > 0 \? acknowledgeGaps : undefined/);
  });
});
