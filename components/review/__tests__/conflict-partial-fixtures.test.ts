// Round 4 audit 5.3 / 8.5 / 5.21 (previously unverified because the test adapter never produced them): deterministic
// fixtures for a Conflicting point (label, review filter, approve gate, timeline highlight) and for a partly analysed
// source (publishing needs the acknowledgement).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTimeline } from "@/components/timeline/build-timeline";
import { statusConfig } from "@/config/status";
import type { PublishedHandover } from "@/lib/contracts/dto";
import { blockingExtractionGaps, buildExtractionReport, extractionAcknowledgements } from "@/lib/contracts/extraction";

import { directApproveInput } from "../evidence-state";
import { coverageHeadline, coverageIncomplete } from "../coverage-labels";

const FP = `cov1:${"a".repeat(32)}`;

describe("Conflicting fixture", () => {
  it("is labelled Conflicting with its own colour", () => {
    assert.equal(statusConfig.conflicting.label, "Conflicting");
    assert.match(statusConfig.conflicting.className.badge, /status-conflicting/);
  });

  it("needs a resolution before approval; a saved resolution is carried", () => {
    const p = { id: "c1", currentRevisionId: "r1", evidenceStatus: "conflicting", inferredConfirmation: null, conflictResolution: null };
    assert.equal(directApproveInput(p), null);
    assert.deepEqual(directApproveInput({ ...p, conflictResolution: { note: "The hall since 2 Oct." } }), { action: "approve", pointId: "c1", expectedRevisionId: "r1", resolutionNote: "The hall since 2 Oct." });
  });

  it("is highlighted on the timeline with both stances' dates", () => {
    const h: PublishedHandover = {
      handoverId: "h", title: "T", teamName: "Team", roleTitle: null, publicationId: "p", version: 1, publishedAt: "2026-11-20T10:00:00Z",
      publishedByLabel: "Priya", summary: null, viewerAcknowledgedAt: null,
      sections: [{
        category: "decision",
        points: [{
          id: "c1",
          content: {
            title: "Expo venue", statement: "The expo is in the seminar hall.", attributes: {} as never, evidenceStatus: "conflicting",
            isPotentiallyOutdated: false, isKnownGap: false, inferredConfirmation: null,
            conflictResolution: { note: "The hall since 2 Oct.", byLabel: "Priya", byProfileId: "00000000-0000-4000-8000-000000000001", at: "2026-11-20T10:00:00Z" },
            evidence: [
              { evidenceId: "e1", redacted: false, kind: "source_quote", quote: "Expo in the seminar hall", authorLabel: "Rohan", sentAt: "2026-10-02T05:00:00Z", sourceTitle: "chat", stance: "supports", authorProfileId: null },
              { evidenceId: "e2", redacted: false, kind: "source_quote", quote: "Expo in the auditorium", authorLabel: "Rohan", sentAt: "2026-09-05T05:00:00Z", sourceTitle: "chat", stance: "contradicts", authorProfileId: null },
            ],
            evidenceRedacted: false,
          },
        }],
      }],
    };
    const entry = buildTimeline(h).groups.flatMap((g) => g.entries).find((e) => e.id === "c1")!;
    assert.ok(entry.conflict, "conflict highlighted");
    assert.deepEqual(entry.conflict!.supportsAt, ["2026-10-02T05:00:00Z"]);
    assert.deepEqual(entry.conflict!.contradictsAt, ["2026-09-05T05:00:00Z"]);
  });
});

describe("partly analysed source fixture", () => {
  const raw = (chunksDone: number) => ({
    available: true,
    runId: "r1",
    runStatus: "succeeded",
    sources: [
      { sourceId: "s-full", title: "notes.md", jobStatus: "succeeded", chunksDone: 2, chunksTotal: 2, coverageRecorded: true, messagesInspected: 5, coverageFingerprint: FP.replace("a", "b") },
      { sourceId: "s-part", title: "chat.txt", jobStatus: "succeeded", chunksDone, chunksTotal: 4, coverageRecorded: true, messagesInspected: 40, gapState: chunksDone < 4 ? "partial" : "complete", coverageFingerprint: FP },
    ],
  });

  it("a partly analysed source blocks publishing until acknowledged, with that source's fingerprint", () => {
    const report = buildExtractionReport(raw(2));
    assert.equal(report.completion, "partial");
    assert.equal(coverageIncomplete(report.completion, 0), true);
    assert.equal(coverageHeadline(report.completion, 0), "Not everything was analysed. Points may be missing.");
    const gaps = blockingExtractionGaps(report);
    assert.ok(gaps.some((g) => g.kind === "source_partially_extracted" && g.sourceIds.includes("s-part")));
    assert.deepEqual(extractionAcknowledgements(report), [{ sourceId: "s-part", fingerprint: FP }]);
  });

  it("a fully analysed handover asks for no acknowledgement", () => {
    const report = buildExtractionReport(raw(4));
    assert.equal(blockingExtractionGaps(report).length, 0);
    assert.deepEqual(extractionAcknowledgements(report), []);
  });
});
