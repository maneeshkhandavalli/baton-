import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PipelinePoint } from "../../db/pipeline";
import { fingerprint, isRewording, PointIndex, type ClaimShape } from "../dedup";
import { planChunkEntries } from "../stages/extract";

// QA-UI3-X1: retrying a failed run must not duplicate points when the model rewords them.
// Wording below is from the real QA run of 2026-11-15 (failed run, then retry).

const M7 = "00000000-0000-4000-8000-000000000007"; // "Leela owns the sponsor invoices … first one to Orbitstack is due by 20 Sep"
const M6 = "00000000-0000-4000-8000-000000000006"; // "decision from today: the inter-college robotics meet runs on 14 and 15 Feb, labs open 9am to 6pm only"
const M9 = "00000000-0000-4000-8000-000000000009";

function point(over: Partial<PipelinePoint> & Pick<PipelinePoint, "pointId" | "category" | "statement">): PipelinePoint {
  return {
    origin: "extracted",
    extractionRunId: "run-1",
    extractionAccessLevel: "everyone",
    accessLevel: "everyone",
    evidenceStatus: "sourced",
    reviewState: "pending",
    privacyReview: "none",
    currentRevisionId: `${over.pointId}-r1`,
    title: "t",
    attributes: {},
    redacted: false,
    newestEvidenceAt: null,
    lastSupportedAt: null,
    citedMessageIds: [],
    originalStatement: null,
    ...over,
  };
}

const INVOICE = point({ pointId: "p-invoice", category: "open_task", statement: "The first sponsor invoice to Orbitstack is due by 20 September.", citedMessageIds: [M7] });
const MEET = point({ pointId: "p-meet", category: "decision", statement: "The inter-college robotics meet is scheduled for 14 and 15 February, with labs open from 9am to 6pm only.", citedMessageIds: [M6] });

const shape = (category: ClaimShape["category"], statement: string, cited: string[] = []): ClaimShape => ({ category, statement, attributes: {}, citedMessageIds: cited });

type Candidate = Parameters<typeof planChunkEntries>[0][number];

function candidate(category: ClaimShape["category"], statement: string, messageId: string): Candidate {
  return {
    category,
    title: statement.slice(0, 40),
    statement,
    attributes: {},
    inferenceRationale: null,
    citations: [{ messageId, quote: "q", stance: "supports" as const, quoteCheck: "exact" as const, quoteStart: 0, quoteEnd: 1, matchedText: "q" }],
  } as unknown as Candidate;
}
const target = (e: ReturnType<typeof planChunkEntries>["entries"][number]) => ("pointId" in e ? e.pointId : "new");

describe("retry idempotency (QA-UI3-X1)", () => {
  it("an identical re-extraction attaches to the existing point", () => {
    const idx = new PointIndex([INVOICE], "everyone");
    assert.equal(idx.find(shape("open_task", "The first sponsor invoice to Orbitstack is due by 20 September.", [M7])), "p-invoice");
  });

  it("a slightly reworded re-extraction citing the same message attaches (the two QA duplicates)", () => {
    const idx = new PointIndex([INVOICE, MEET], "everyone");
    assert.equal(idx.find(shape("open_task", "The first sponsor invoice needs to be issued to Orbitstack by 20 September.", [M7])), "p-invoice");
    assert.equal(idx.find(shape("decision", "The inter-college robotics meet will run on 14 and 15 February, with labs open from 9am to 6pm only.", [M6])), "p-meet");
  });

  it("keeps legitimate distinct points apart", () => {
    const idx = new PointIndex([INVOICE, MEET], "everyone");
    // Same message, different claim (different numbers): a second decision from one message.
    assert.equal(idx.find(shape("decision", "Labs are open from 9am to 6pm on meet days.", [M6])), null);
    // Similar wording but a different instalment and date.
    assert.equal(idx.find(shape("open_task", "The second sponsor invoice to Orbitstack is due by 20 October.", [M7])), null);
    // Same wording but a different message: never merged on wording alone.
    assert.equal(idx.find(shape("open_task", "The first sponsor invoice to Orbitstack needs to be issued by 20 September.", [M9])), null);
    // Negation flips the claim.
    assert.equal(idx.find(shape("open_task", "The first sponsor invoice to Orbitstack is not due by 20 September.", [M7])), null);
    // Other category.
    assert.equal(idx.find(shape("risk", "The first sponsor invoice to Orbitstack is due by 20 September, which is tight.", [M7])), null);
    // No citations: only exact matching applies.
    assert.equal(idx.find(shape("open_task", "The first sponsor invoice needs to be issued to Orbitstack by 20 September.")), null);
  });

  it("finds approved or human-edited points by their original wording, and only adds citations to them", () => {
    const edited = point({
      pointId: "p-edited",
      category: "open_task",
      reviewState: "approved",
      statement: "Leela sends Orbitstack the first invoice (20 Sep).", // the reviewer's rewrite
      originalStatement: "The first sponsor invoice to Orbitstack is due by 20 September.",
      citedMessageIds: [M7],
    });
    const idx = new PointIndex([edited], "everyone");
    const counters = { merged: 0, duplicatesWithoutEvidence: 0 };
    const { entries } = planChunkEntries([candidate("open_task", "The first sponsor invoice needs to be issued to Orbitstack by 20 September.", M7)], new Set([M7]), idx, counters);
    assert.equal(entries.length, 1);
    assert.equal(target(entries[0]), "p-edited", "no new point, no rewrite: citations only");
    assert.equal(counters.merged, 1);
  });

  it("a rejected point stays the target, so a rejected duplicate doesn't come back", () => {
    const idx = new PointIndex([{ ...INVOICE, reviewState: "rejected" }], "everyone");
    assert.equal(idx.find(shape("open_task", "The first sponsor invoice needs to be issued to Orbitstack by 20 September.", [M7])), "p-invoice");
  });

  it("partial failure then retry: only genuinely new claims become points", () => {
    // The failed run stored two points before it stopped; the retry re-extracts the whole chunk.
    const idx = new PointIndex([INVOICE, MEET], "everyone");
    const counters = { merged: 0, duplicatesWithoutEvidence: 0 };
    const { entries } = planChunkEntries(
      [
        candidate("open_task", "The first sponsor invoice needs to be issued to Orbitstack by 20 September.", M7),
        candidate("decision", "The inter-college robotics meet will run on 14 and 15 February, with labs open from 9am to 6pm only.", M6),
        candidate("risk", "The 3D printer in lab 2 jams on long prints.", M9),
      ],
      new Set([M6, M7, M9]),
      idx,
      counters,
    );
    assert.deepEqual(entries.map(target), ["p-invoice", "p-meet", "new"]);
    assert.equal(counters.merged, 2);
  });

  it("repeated retries stay idempotent (points added by the first retry are matched by the next)", () => {
    const idx = new PointIndex([], "everyone");
    const first = shape("risk", "The 3D printer in lab 2 jams on long prints, so keep a spare nozzle.", [M9]);
    assert.equal(idx.find(first), null);
    idx.add("p-printer", first);
    for (const wording of ["The 3D printer in lab 2 jams during long prints; keep a spare nozzle.", "Lab 2's 3D printer jams on long prints, so a spare nozzle should be kept."]) {
      assert.equal(idx.find(shape("risk", wording, [M9])), "p-printer", wording);
    }
  });

  it("fingerprints compare numbers and negation exactly", () => {
    assert.equal(fingerprint("Due by 20 Sep 2026").numbers, "20,2026,month9");
    assert.equal(fingerprint("The first invoice is due by 20 September").numbers, fingerprint("The first invoice is due on 20 Sep").numbers);
    assert.notEqual(fingerprint("The first invoice is due by 20 September").numbers, fingerprint("The second invoice is due by 20 October").numbers);
    assert.equal(isRewording(fingerprint("Workshops are free for everyone"), fingerprint("Workshops are not free for everyone")), false);
    assert.equal(isRewording(fingerprint("Non-members pay 200 per workshop"), fingerprint("Non-members pay 100 per workshop")), false);
  });
});
