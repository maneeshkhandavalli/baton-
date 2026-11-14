// Round 3 B4/A2: draft resume after a refresh at EVERY wizard step, from what the database holds.
// Exercises the exported pure helpers (components/wizard/draft-state.ts) composed exactly as the baseline
// wizard composes them (new-handover-wizard.tsx: clamp of initial.step, `initialConsented`, maxStepFor →
// shownStep). If Agent 1's redesign changes that composition, update `afterRefresh` here and keep the
// invariants: never ahead of what the draft holds, never negative, never a File restored, never a raw
// object path or bucket guessed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fromSummary, maxStepFor, resumeStep, signedTarget } from "../../components/wizard/draft-state";
import type { SourceSummary } from "../../lib/contracts/dto";

const LAST_STEP = 3; // details, privacy & consent, sources, scope
const H = "5a2b3c4d-6e7f-4a81-9b2c-3d4e5f6a7b8c";

const src = (n: number, over: Partial<SourceSummary>): SourceSummary => ({
  id: `4f1c2a3b-5d6e-4f70-8a9b-0c1d2e3f4a5${n}`,
  handoverId: H,
  kind: "whatsapp_export",
  title: `chat-${n}.txt`,
  state: "uploaded",
  accessLevel: "everyone",
  sizeBytes: 1000 + n,
  consentRecordedAt: null,
  rawDeletedAt: null,
  firstMessageAt: null,
  lastMessageAt: null,
  messageCount: null,
  maskingCounts: null,
  errorCode: null,
  ...over,
});

/** What the reopened wizard shows (baseline composition). Previews of consented uploads are assumed to succeed. */
function afterRefresh(stepParam: string | undefined, sources: SourceSummary[] | null) {
  const hasDraft = sources !== null;
  const live = (sources ?? []).filter((s) => s.state !== "removed");
  const initialConsented = live.some((s) => s.consentRecordedAt);
  const restored = live.map((s) => fromSummary(s, initialConsented));
  const ready = restored.filter((s) => s.status === "previewing").length; // becomes "ready" once the preview returns
  const initialStep = hasDraft ? resumeStep(stepParam, live.length) : 0;
  const step = Math.min(Math.max(initialStep, 0), LAST_STEP);
  const maxStep = maxStepFor({ hasDraft, consentGiven: initialConsented, readySources: ready }, LAST_STEP);
  return { shown: Math.min(step, maxStep), maxStep, restored };
}

const CONSENTED = "2026-11-12T10:00:00Z";
const STATES: Array<[string, SourceSummary[] | null, number]> = [
  // [label, sources (null = no draft yet), furthest step the draft really supports]
  ["no draft yet (step 0 never saved)", null, 0],
  ["draft saved, no source", [], 1],
  ["one pending_upload (interrupted upload)", [src(1, { state: "pending_upload" })], 1],
  ["one uploaded without consent recorded", [src(1, {})], 1],
  ["one uploaded + consented", [src(1, { consentRecordedAt: CONSENTED })], LAST_STEP],
  ["consented + an interrupted second upload", [src(1, { consentRecordedAt: CONSENTED }), src(2, { state: "pending_upload" })], LAST_STEP],
  ["only a removed source", [src(1, { state: "removed", consentRecordedAt: CONSENTED })], 1],
];
const PARAMS = [undefined, "0", "1", "2", "3", "4", "99", "-1", "-99", "1.5", "abc", "", " 2 ", "1e1", "0x2", "NaN", "Infinity"];

describe("draft resume: refresh at every step never shows a step ahead of the saved draft", () => {
  for (const [label, sources, furthest] of STATES) {
    it(label, () => {
      for (const p of PARAMS) {
        const { shown, maxStep } = afterRefresh(p, sources);
        assert.equal(maxStep, furthest, `${label}: furthest step`);
        assert.ok(Number.isInteger(shown) && shown >= 0 && shown <= furthest, `${label}, ?step=${String(p)} → ${shown}`);
      }
      // refreshing ON each reachable step lands back on it
      for (let s = 0; s <= furthest; s += 1) {
        assert.equal(afterRefresh(String(s), sources).shown, s, `${label}: refresh on step ${s}`);
      }
    });
  }

  it("without ?step the draft opens on consent (no sources) or sources (has sources), capped by what it holds", () => {
    assert.equal(afterRefresh(undefined, []).shown, 1);
    assert.equal(afterRefresh(undefined, [src(1, { consentRecordedAt: CONSENTED })]).shown, 2);
    assert.equal(afterRefresh(undefined, [src(1, {})]).shown, 1, "consent missing: back to consent, not sources");
  });

  it("restored sources never carry a File or a guessed storage path; unfinished ones say how to recover", () => {
    const { restored } = afterRefresh("2", [
      src(1, { consentRecordedAt: CONSENTED }), src(2, { state: "pending_upload" }), src(3, { state: "failed" }), src(4, {}),
    ]);
    for (const s of restored) {
      assert.equal(s.file, undefined, "nothing is restored from browser storage");
      assert.equal(s.sourceId, s.localId, "the server id is the identity of a reopened source");
      assert.deepEqual([s.excludedParticipants, s.excludedConversations], [[], []], "unsaved exclusions are NOT restored (see findings: refresh at scope)");
    }
    assert.equal(restored[0].status, "previewing");
    assert.match(restored[1].error ?? "", /didn't finish/);
    assert.match(restored[2].error ?? "", /Remove it and add the file again/);
    assert.equal(restored[3].status, "consent", "consent given on this draft (source 1): recorded for source 4 before its preview");
    const alone = afterRefresh("2", [src(4, {})]).restored[0];
    assert.equal(alone.status, "error", "no consent anywhere on the draft: never previewed (the database would refuse)");
  });

  it("a draft with consent on one source re-records consent for the others before previewing them", () => {
    const { restored } = afterRefresh("2", [src(1, { consentRecordedAt: CONSENTED }), src(2, {})]);
    assert.deepEqual(restored.map((s) => s.status), ["previewing", "consent"]);
  });
});

describe("signed upload target parsing (where the browser PUTs the file)", () => {
  it("accepts only Supabase signed-upload URLs and decodes the path", () => {
    const sid = "4f1c2a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
    assert.deepEqual(signedTarget(`https://x.supabase.co/storage/v1/object/upload/sign/source-uploads/raw/${H}/${sid}?token=t`), {
      bucket: "source-uploads", path: `raw/${H}/${sid}`,
    });
    for (const bad of ["", "not a url", `https://x.supabase.co/storage/v1/object/sign/source-uploads/raw/${H}/${sid}`,
      `https://x.supabase.co/storage/v1/object/upload/sign/source-uploads`, "javascript:alert(1)"]) {
      assert.equal(signedTarget(bad), null, bad);
    }
  });
});
