// 2026-11-20 regression (Round 4 Telegram import): a source ADDED after a succeeded run (a first version such as a
// connector chat_import, no update state, no consent) hid the consent checklist and the page said "Processing
// complete". These tests pin the corrected rules (components/processing/processing-controls.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planProcessingRun, type AiRunConfig } from "@/lib/pipeline/plan";
import { emptyConsent, consentComplete } from "@/components/wizard/consent-state";
import { sourcesNeedingConsent } from "@/components/shared/run-status";

import { isPendingUpdate, newSourcesAwaitingProcessing, processingControls, type ControlSource, type ControlsInput } from "../processing-controls";
import { processingHeadline } from "../processing-headline";

const processed = (over: Partial<ControlSource> = {}): ControlSource => ({ state: "parsed", consentRecordedAt: "2026-11-19T18:19:10Z", version: { versionNumber: 1, updateState: null }, ...over });
// The live case: Telegram chat_import, version 1, uploaded, consentRecordedAt null.
const telegramImport = (): ControlSource => ({ state: "uploaded", consentRecordedAt: null, version: { versionNumber: 1, updateState: null } });

function controlsFor(sources: ControlSource[], over: Partial<ControlsInput> = {}) {
  const runStatus = over.runStatus === undefined ? "succeeded" : over.runStatus;
  const fresh = newSourcesAwaitingProcessing(sources, runStatus);
  const needsConsent = sourcesNeedingConsent(sources, false);
  return processingControls({
    active: false,
    canStart: true,
    handoverState: "in_review",
    sourceCount: sources.length,
    pendingUpdates: sources.filter(isPendingUpdate).length,
    newSources: fresh.length,
    needsConsent: needsConsent.length,
    consentComplete: false,
    isPending: false,
    ...over,
    runStatus,
  });
}

describe("processing controls: a source added after a succeeded run", () => {
  const sources = [processed(), processed(), telegramImport()];

  it("existing successful run + new first-version source without consent → it is a new source, not 'complete'", () => {
    assert.equal(newSourcesAwaitingProcessing(sources, "succeeded").length, 1);
    assert.equal(sources.filter(isPendingUpdate).length, 0, "a first version is not an update (the old gate's blind spot)");
    const h = processingHeadline({ active: false, runStatus: "succeeded", startedAt: null, finishedAt: "19 Nov 2026, 18:21", pendingUpdates: 0, newSources: 1, openReviews: 0, handoverState: "in_review" });
    assert.equal(h.title, "A new source needs processing");
    assert.doesNotMatch(h.title + h.description, /complete/i);
  });

  it("the consent checklist is visible and the start section is shown", () => {
    const c = controlsFor(sources);
    assert.equal(c.showStart, true);
    assert.equal(c.showConsent, true);
  });

  it("processing stays disabled until every consent statement is ticked", () => {
    const partial = { ...emptyConsent(), informed: true, provider: true };
    assert.equal(consentComplete(partial), false);
    assert.equal(controlsFor(sources, { consentComplete: consentComplete(emptyConsent()) }).startDisabled, true);
    assert.equal(controlsFor(sources, { consentComplete: consentComplete(partial) }).startDisabled, true);
    const all = { informed: true, provider: true, optout: true };
    assert.equal(controlsFor(sources, { consentComplete: consentComplete(all) }).startDisabled, false);
    assert.equal(controlsFor(sources, { consentComplete: true, isPending: true }).startDisabled, true, "disabled while starting");
  });

  it("the button names the new source, never 'Try again'", () => {
    assert.equal(controlsFor(sources).label, "Process the new source");
    assert.equal(controlsFor([processed(), telegramImport(), telegramImport()]).label, "Process the new sources");
    const update = processed({ version: { versionNumber: 2, updateState: "awaiting_processing" } });
    assert.equal(controlsFor([update, telegramImport()]).label, "Process the new sources and versions");
    assert.equal(controlsFor([update]).label, "Process the new version");
    assert.equal(controlsFor([processed()], { runStatus: "failed" }).label, "Try again");
    assert.equal(controlsFor([processed()], { runStatus: "cancelled" }).label, "Try again");
    assert.equal(controlsFor([telegramImport()], { runStatus: null, handoverState: "draft" }).label, "Start processing");
  });

  it("after consent is recorded the new source still waits for processing (state uploaded), and the button stays", () => {
    const consented = { ...telegramImport(), consentRecordedAt: "2026-11-20T05:00:00Z" };
    const c = controlsFor([processed(), processed(), consented]);
    assert.equal(c.showStart, true);
    assert.equal(c.showConsent, false, "no checklist once consent is recorded");
    assert.equal(c.startDisabled, false);
    assert.equal(c.label, "Process the new source");
  });

  it("the newly uploaded source is planned into the next run (parse + extract + verify); processed sources are not parsed again", () => {
    const AI = {
      provider: "fake",
      adapterVersion: "fake@1",
      extract: { model: "fake-extract", promptVersion: "extract@1", schemaVersion: "extract-schema@1" },
      verify: { model: "fake-verify", promptVersion: "support@1", schemaVersion: "support-schema@1" },
    } satisfies AiRunConfig;
    const OLD1 = "11111111-1111-4111-8111-111111111111";
    const OLD2 = "22222222-2222-4222-8222-222222222222";
    const NEW = "95ff654c-abea-497a-9bc7-6c68bcfbc092";
    const r = planProcessingRun({
      handoverId: "af38678a-0f73-4c89-afa2-055c3407575d",
      sources: [
        { id: OLD1, state: "parsed", rawAvailable: true },
        { id: OLD2, state: "parsed", rawAvailable: true },
        { id: NEW, state: "uploaded", rawAvailable: true },
      ],
      aiConfig: AI,
    });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    const stagesOf = (id: string) => r.data.jobs.filter((j) => j.sourceId === id).map((j) => j.stage).sort();
    assert.deepEqual(stagesOf(NEW), ["extract", "parse", "verify_quotes"]);
    assert.ok(!stagesOf(OLD1).includes("parse") && !stagesOf(OLD2).includes("parse"), "parsed sources are not parsed again");
  });

  it("nothing new and nothing to consent → no start section after a succeeded run (unchanged behaviour)", () => {
    const c = controlsFor([processed(), processed()]);
    assert.equal(c.showStart, false);
    assert.equal(c.showConsent, false);
    const h = processingHeadline({ active: false, runStatus: "succeeded", startedAt: null, finishedAt: null, pendingUpdates: 0, newSources: 0, openReviews: 0, handoverState: "in_review" });
    assert.equal(h.title, "Processing complete");
  });

  it("a published handover never offers processing for a new source", () => {
    assert.equal(controlsFor(sources, { handoverState: "approved" }).showStart, false);
    const h = processingHeadline({ active: false, runStatus: "succeeded", startedAt: null, finishedAt: null, pendingUpdates: 0, newSources: 1, openReviews: 0, handoverState: "approved" });
    assert.equal(h.title, "Processing complete");
  });
});
