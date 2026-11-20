// 2026-11-20 regression (Round 4 Telegram import): a source ADDED after a succeeded run (a first version such as a
// connector chat_import, no update state, no consent) hid the consent checklist and the page said "Processing
// complete". These tests pin the corrected rules (components/processing/processing-controls.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planProcessingRun, type AiRunConfig } from "@/lib/pipeline/plan";
import { emptyConsent, consentComplete } from "@/components/wizard/consent-state";
import { sourcesNeedingConsent } from "@/components/shared/run-status";

import {
  candidateVersionNumber,
  isPendingUpdate,
  newSourcesAwaitingProcessing,
  pendingCandidatesAwaitingConsent,
  processingControls,
  recordConsentThenStart,
  type ControlSource,
  type ControlsInput,
} from "../processing-controls";
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
    // a failed source-update run: the failure message says "choose Try again below", so the button says it too
    const failedUpdate = processed({ version: { versionNumber: 2, updateState: "failed" } });
    const retry = controlsFor([failedUpdate], { runStatus: "failed" });
    assert.equal(retry.label, "Try again");
    assert.equal(retry.showStart, true);
    assert.equal(retry.startDisabled, false);
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

// 2026-11-20 (connector version 2+): a flush creates an UPLOADED CANDIDATE version (version number null, no consent).
// It is not a current version, so the page used to show nothing to do and no way to give its consent.
describe("processing controls: a pending connector version awaiting consent", () => {
  type S = ControlSource & { id: string; title: string; version: { lineageId: string; versionNumber: number | null; updateState?: string | null } };
  const v1: S = { id: "v1", title: "Telegram · baton bot testing group", state: "parsed", consentRecordedAt: "2026-11-20T05:00:28Z", version: { lineageId: "v1", versionNumber: 1, updateState: null } };
  const v2: S = { id: "v2", title: "Telegram · baton bot testing group", state: "uploaded", consentRecordedAt: null, version: { lineageId: "v1", versionNumber: null } };
  const others: S[] = [
    { id: "wa", title: "WhatsApp", state: "parsed", consentRecordedAt: "2026-11-19T18:19:10Z", version: { lineageId: "wa", versionNumber: 1, updateState: null } },
    { id: "md", title: "Notes", state: "parsed", consentRecordedAt: "2026-11-19T18:19:10Z", version: { lineageId: "md", versionNumber: 1, updateState: null } },
  ];
  const all = [...others, v1, v2];
  const current = all.filter((s) => s.version.versionNumber !== null);

  function controls(over: Partial<ControlsInput> = {}) {
    const candidates = pendingCandidatesAwaitingConsent(all);
    const needsConsent = [...sourcesNeedingConsent(current, false), ...candidates];
    return processingControls({
      active: false,
      canStart: true,
      handoverState: "in_review",
      runStatus: "succeeded",
      sourceCount: current.length,
      pendingUpdates: current.filter(isPendingUpdate).length,
      newSources: newSourcesAwaitingProcessing(current, "succeeded").length,
      pendingCandidates: candidates.length,
      needsConsent: needsConsent.length,
      consentComplete: false,
      isPending: false,
      ...over,
    });
  }

  it("the uploaded candidate is found among ALL sources; it is neither current nor a 'new source'", () => {
    assert.deepEqual(pendingCandidatesAwaitingConsent(all).map((s) => s.id), ["v2"]);
    assert.equal(newSourcesAwaitingProcessing(current, "succeeded").length, 0, "v1 and the others are processed");
    assert.equal(sourcesNeedingConsent(current, false).length, 0, "the old checklist saw nothing to consent to");
  });

  it("only an UPLOADED candidate without consent qualifies (not one still uploading, not one already consented)", () => {
    assert.equal(pendingCandidatesAwaitingConsent([{ ...v2, state: "pending_upload" }]).length, 0);
    assert.equal(pendingCandidatesAwaitingConsent([{ ...v2, consentRecordedAt: "2026-11-20T06:00:00Z" }]).length, 0);
    assert.equal(pendingCandidatesAwaitingConsent([v1]).length, 0);
  });

  it("the start section and consent checklist are visible; the candidate is shown as 'new version 2'", () => {
    const c = controls();
    assert.equal(c.showStart, true);
    assert.equal(c.showConsent, true);
    assert.equal(candidateVersionNumber(v2, all), 2);
    assert.equal(candidateVersionNumber({ ...v2, id: "v3" }, [...all, { ...v2, id: "v2b", version: { lineageId: "v1", versionNumber: 2 } }]), 3);
  });

  it("processing is disabled until every consent statement is ticked", () => {
    assert.equal(controls({ consentComplete: false }).startDisabled, true);
    assert.equal(controls({ consentComplete: true }).startDisabled, false);
    assert.equal(controls({ consentComplete: true, isPending: true }).startDisabled, true);
  });

  it("the button says 'Process the new version' (never 'Try again'); the headline asks for consent, not 'complete'", () => {
    assert.equal(controls().label, "Process the new version");
    const h = processingHeadline({ active: false, runStatus: "succeeded", startedAt: null, finishedAt: "20 Nov 2026, 10:30", pendingUpdates: 0, newSources: 0, pendingCandidates: 1, openReviews: 0, handoverState: "in_review" });
    assert.equal(h.title, "A new version needs your consent");
    assert.doesNotMatch(h.title + h.description, /complete/i);
  });

  it("nothing is offered on a published handover", () => {
    assert.equal(controls({ handoverState: "approved" }).showStart, false);
  });

  it("consent is recorded for the candidate FIRST, and processing starts only after it succeeded", async () => {
    const calls: string[] = [];
    const ok = await recordConsentThenStart([v2], async (s) => (calls.push(`consent:${s.id}`), true), async () => void calls.push("start"));
    assert.deepEqual(calls, ["consent:v2", "start"]);
    assert.deepEqual(ok, { started: true, failedAt: null });
  });

  it("a failed consent recording stops: nothing later is recorded and processing never starts (v2 stays a candidate)", async () => {
    const calls: string[] = [];
    const v2b = { ...v2, id: "v2b" };
    const r = await recordConsentThenStart(
      [v2, v2b],
      async (s) => {
        calls.push(`consent:${s.id}`);
        return s.id !== "v2"; // the server refused v2's consent
      },
      async () => void calls.push("start"),
    );
    assert.deepEqual(calls, ["consent:v2"]);
    assert.equal(r.started, false);
    assert.equal(r.failedAt?.id, "v2");
  });
});

// Provider-agnostic: a candidate version from ANY connector (all write kind chat_import through the shared flush)
// is offered for consent by the same shared rules; nothing keys on the provider or the source kind.
describe("processing controls: pending versions from every connector", () => {
  type S = ControlSource & { id: string; title: string; kind: string; version: { lineageId: string; versionNumber: number | null; updateState?: string | null } };
  const providers = [
    ["telegram", "Telegram - Treasurer group"],
    ["discord", "Discord - #treasury"],
    ["slack", "Slack - #core-team"],
    ["github", "GitHub - acme sponsors"],
  ] as const;
  const v1s: S[] = providers.map(([p, title]) => ({ id: `${p}-v1`, title, kind: "chat_import", state: "parsed", consentRecordedAt: "2026-11-20T05:00:00Z", version: { lineageId: `${p}-v1`, versionNumber: 1, updateState: null } }));
  const v2s: S[] = providers.map(([p, title]) => ({ id: `${p}-v2`, title, kind: "chat_import", state: "uploaded", consentRecordedAt: null, version: { lineageId: `${p}-v1`, versionNumber: null } }));
  const all = [...v1s, ...v2s];

  it("each provider's candidate version appears for consent, numbered as version 2 of its own lineage", () => {
    assert.deepEqual(pendingCandidatesAwaitingConsent(all).map((s) => s.id), v2s.map((s) => s.id));
    for (const v2 of v2s) assert.equal(candidateVersionNumber(v2, all), 2, v2.id);
  });

  it("one consent click covers all of them, then starts processing; the label counts them", async () => {
    const c = processingControls({
      active: false, canStart: true, handoverState: "in_review", runStatus: "succeeded", sourceCount: v1s.length,
      pendingUpdates: 0, newSources: 0, pendingCandidates: v2s.length, needsConsent: v2s.length, consentComplete: true, isPending: false,
    });
    assert.equal(c.showConsent, true);
    assert.equal(c.label, "Process the new versions");
    const order: string[] = [];
    const r = await recordConsentThenStart(pendingCandidatesAwaitingConsent(all), async (s) => (order.push(s.id), true), async () => void order.push("start"));
    assert.deepEqual(order, [...v2s.map((s) => s.id), "start"]);
    assert.equal(r.started, true);
  });
});
