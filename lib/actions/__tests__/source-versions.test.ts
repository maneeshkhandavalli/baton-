// R3 Task 05B: uploading a new version of a source, its activation by consent, and current-version processing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SourceSummary } from "../../contracts/dto";
import { isCurrentSourceVersion, isPendingSourceVersion, isSupersededSourceVersion } from "../../contracts/source-versions";
import { mapSourceSummary } from "../../db/mappers";
import * as handovers from "../core/handovers";
import * as sources from "../core/sources";
import { FAKE_RUN_CONFIG, H, NEW_ID, OTHER_ID, S, SYNTHETIC_PHONE, fakeDeps } from "./helpers";

const SHA = "a".repeat(64);
const upload = { previousSourceId: S, kind: "whatsapp_export" as const, fileName: "chat.txt", mimeType: "text/plain", sizeBytes: 120, sha256: SHA };
const outcome = (o: string, sourceId: string | null = NEW_ID) => ({ data: { handover_id: H, outcome: o, source_id: sourceId } });

/** A source row as api_get_source returns it. */
function row(id: string, access: string, version: Record<string, unknown> | undefined) {
  return {
    id, handover_id: H, kind: "whatsapp_export", title: "Chat", state: "uploaded", access_level: access, size_bytes: 120,
    consent_recorded_at: null, raw_deleted_at: null, first_message_at: null, last_message_at: null, message_count: null,
    masking_counts: null, error_code: null, ...(version ? { version } : {}),
  };
}
const pending = (access = "leads_only") =>
  row(NEW_ID, access, { lineage_id: S, version_number: null, supersedes_source_id: S, superseded_at: null, superseded_by_source_id: null });

describe("createSourceVersionUpload", () => {
  it("names the replaced source, masks the file name, and signs an upload for the pending update", async () => {
    const f = fakeDeps({ rpc: { create_source_version: outcome("created") } });
    const r = await sources.createSourceVersionUpload(f.deps, { ...upload, fileName: `Chat with ${SYNTHETIC_PHONE}.txt` });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.data.status, "upload");
    assert.equal(r.ok && r.data.status === "upload" && r.data.ticket.sourceId, NEW_ID);
    const call = f.calls.find((c) => c.fn === "create_source_version");
    assert.equal(call?.client, "admin");
    assert.equal(call?.args?.p_previous_source_id, S);
    assert.equal(call?.args?.p_sha256_hex, SHA);
    assert.ok(!String(call?.args?.p_file_name).includes("99999"), "the phone number in the file name is masked");
    assert.deepEqual(f.storageCalls, [{ op: "createSignedUploadUrl", path: `raw/${H}/${NEW_ID}` }], "the path uses the handover the database derived");
  });

  it("a retry of the same update before its file arrived gets a fresh ticket for the same row", async () => {
    const f = fakeDeps({ rpc: { create_source_version: outcome("resumed") } });
    const r = await sources.createSourceVersionUpload(f.deps, upload);
    assert.equal(r.ok && r.data.status === "upload" && r.data.ticket.sourceId, NEW_ID);
  });

  for (const o of ["unchanged", "awaiting_confirmation", "awaiting_consent"] as const) {
    it(`${o}: no upload is signed, the client is told the next step`, async () => {
      const f = fakeDeps({ rpc: { create_source_version: outcome(o, o === "unchanged" ? S : NEW_ID) } });
      const r = await sources.createSourceVersionUpload(f.deps, upload);
      assert.deepEqual(r, { ok: true, data: { status: o, sourceId: o === "unchanged" ? S : NEW_ID } });
      assert.equal(f.storageCalls.length, 0);
    });
  }

  it("stale, update in progress and non-portable exclusions are explained, with the source to act on", async () => {
    const cases = [
      ["stale", "conflict"],
      ["update_in_progress", "conflict"],
      ["exclusions_not_portable", "precondition_failed"],
    ] as const;
    for (const [o, code] of cases) {
      const f = fakeDeps({ rpc: { create_source_version: outcome(o, OTHER_ID) } });
      const r = await sources.createSourceVersionUpload(f.deps, upload);
      assert.equal(r.ok, false, o);
      assert.equal(!r.ok && r.error.code, code, o);
      assert.equal(!r.ok && r.error.details?.reason, o);
      assert.equal(!r.ok && r.error.details?.sourceId, OTHER_ID);
      assert.ok(!r.ok && !/sql|exception|BT[A-Z]{2}0|relation/i.test(r.error.message), `${o}: a plain message`);
      assert.equal(f.storageCalls.length, 0, `${o}: nothing signed`);
    }
  });

  it("maps database refusals to useful, safe errors", async () => {
    const dup = fakeDeps({ rpc: { create_source_version: { error: { code: "BTCF0", message: "this file was already uploaded" } } } });
    const r1 = await sources.createSourceVersionUpload(dup.deps, upload);
    assert.equal(!r1.ok && r1.error.details?.reason, "duplicate_source");
    const kind = fakeDeps({ rpc: { create_source_version: { error: { code: "BTVF0", message: "a new version must be the same kind" } } } });
    const r2 = await sources.createSourceVersionUpload(kind.deps, upload);
    assert.equal(!r2.ok && r2.error.details?.reason, "source_version_kind_changed");
    assert.ok(!r2.ok && !r2.error.message.includes("kind of source"), "not the database text");
    const creatorOnly = fakeDeps({ rpc: { create_source_version: { error: { code: "BTFB0", message: "only the creator…" } } } });
    const r3 = await sources.createSourceVersionUpload(creatorOnly.deps, upload);
    assert.equal(!r3.ok && r3.error.code, "forbidden");
    assert.ok(!r3.ok && !r3.error.message.includes("creator"), "a fixed safe message");
  });

  it("discards the pending update when no upload ticket can be signed", async () => {
    const f = fakeDeps({ rpc: { create_source_version: outcome("created") } });
    const storage = await f.deps.userStorage();
    const failing = { from: () => ({ ...storage.from("x"), createSignedUploadUrl: async () => ({ data: null, error: { message: "down" } }) }) };
    const r = await sources.createSourceVersionUpload({ ...f.deps, userStorage: async () => failing as never }, upload);
    assert.equal(!r.ok && r.error.code, "internal");
    assert.ok(f.calls.some((c) => c.fn === "remove_source" && c.args?.p_source_id === NEW_ID), "the pending update is discarded");
  });

  it("refuses bad input and a signed-out caller before any call", async () => {
    const f = fakeDeps();
    assert.equal((await sources.createSourceVersionUpload(f.deps, { ...upload, previousSourceId: "nope" })).ok, false);
    assert.equal((await sources.createSourceVersionUpload(f.deps, { ...upload, sha256: "xyz" })).ok, false);
    assert.equal((await sources.createSourceVersionUpload(f.deps, { ...upload, sizeBytes: 0 })).ok, false);
    assert.equal(f.calls.length, 0);
    const g = fakeDeps({ actor: null });
    const r = await sources.createSourceVersionUpload(g.deps, upload);
    assert.equal(!r.ok && r.error.code, "unauthenticated");
    assert.equal(g.calls.length, 0);
  });
});

describe("recordSourceConsent on a pending update (activation)", () => {
  const consent = { sourceId: NEW_ID, consentStatementVersion: "v1", consentConfirmed: true as const, timezone: "Asia/Kolkata" };

  it("defaults to the previous version's access level (copied to the pending update)", async () => {
    const f = fakeDeps({ aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }), rpc: { api_get_source: { data: pending("leads_only") } } });
    const r = await sources.recordSourceConsent(f.deps, consent);
    assert.equal(r.ok, true);
    assert.equal(f.calls.find((c) => c.fn === "record_source_consent")?.args?.p_access_level, "leads_only");
  });

  it("allows a stricter level and refuses a broader one before calling the database", async () => {
    const f = fakeDeps({ aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }), rpc: { api_get_source: { data: pending("leads_only") } } });
    await sources.recordSourceConsent(f.deps, { ...consent, accessLevel: "reviewer_only" });
    assert.equal(f.calls.find((c) => c.fn === "record_source_consent")?.args?.p_access_level, "reviewer_only");

    const g = fakeDeps({ aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }), rpc: { api_get_source: { data: pending("leads_only") } } });
    const r = await sources.recordSourceConsent(g.deps, { ...consent, accessLevel: "everyone" });
    assert.equal(!r.ok && r.error.code, "validation_failed");
    assert.equal(!r.ok && r.error.details?.reason, "source_version_access_broadened");
    assert.equal(g.calls.filter((c) => c.fn === "record_source_consent").length, 0, "nothing recorded");
  });

  it("a replaced version that is no longer current is a clear conflict", async () => {
    const f = fakeDeps({
      aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }),
      rpc: { api_get_source: { data: pending() }, record_source_consent: { error: { code: "BTCF0", message: "the source changed" } } },
    });
    const r = await sources.recordSourceConsent(f.deps, consent);
    assert.equal(!r.ok && r.error.code, "conflict");
    assert.equal(!r.ok && r.error.details?.reason, "source_version_stale");
  });

  it("fresh consent: without a configured provider nothing is recorded", async () => {
    const f = fakeDeps({ rpc: { api_get_source: { data: pending() } } });
    const r = await sources.recordSourceConsent(f.deps, consent);
    assert.equal(r.ok, false);
    assert.equal(f.calls.filter((c) => c.fn === "record_source_consent").length, 0);
  });

  it("an ordinary source keeps the existing default ('everyone')", async () => {
    const f = fakeDeps({ aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }), rpc: { api_get_source: { data: row(S, "everyone", undefined) } } });
    await sources.recordSourceConsent(f.deps, { ...consent, sourceId: S });
    assert.equal(f.calls.find((c) => c.fn === "record_source_consent")?.args?.p_access_level, "everyone");
  });
});

describe("startProcessing processes the current version of each source only", () => {
  it("leaves superseded versions and pending updates out of the plan", async () => {
    const list: SourceSummary[] = [
      mapSourceSummary({ ...row(S, "everyone", { lineage_id: S, version_number: 1, supersedes_source_id: null, superseded_at: "2026-11-17T00:00:00Z", superseded_by_source_id: OTHER_ID }), state: "parsed" }),
      mapSourceSummary(row(OTHER_ID, "everyone", { lineage_id: S, version_number: 2, supersedes_source_id: S, superseded_at: null, superseded_by_source_id: null })),
      mapSourceSummary(row(NEW_ID, "everyone", { lineage_id: S, version_number: null, supersedes_source_id: OTHER_ID, superseded_at: null, superseded_by_source_id: null })),
    ];
    const f = fakeDeps({
      aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }),
      queries: { listSources: async () => ({ ok: true, data: list }) },
      planProcessingRun: (input) => ({ ok: true, data: { pipelineVersion: "p@1", aiConfig: input.aiConfig, jobs: [{ stage: "extract", sourceId: OTHER_ID, inputHashHex: "00" }] } }),
      rpc: { start_processing: { data: "77777777-7777-4777-8777-777777777777" } },
    });
    const r = await handovers.startProcessing(f.deps, { handoverId: H });
    assert.equal(r.ok, true);
    assert.deepEqual(f.planInputs[0].sources.map((s) => s.id), [OTHER_ID], "only version 2 (current) is planned");
  });
});

describe("source version helpers and mapping", () => {
  it("a source without version information (older database) is its own current version", () => {
    const s = mapSourceSummary(row(S, "everyone", undefined));
    assert.equal(s.version, undefined);
    assert.equal(isCurrentSourceVersion(s), true);
    assert.equal(isPendingSourceVersion(s), false);
    assert.equal(isSupersededSourceVersion(s), false);
  });

  it("maps the chain and classifies each version", () => {
    const p = mapSourceSummary(pending());
    assert.deepEqual(p.version, { lineageId: S, versionNumber: null, supersedesSourceId: S, supersededAt: null, supersededBySourceId: null });
    assert.equal(isPendingSourceVersion(p), true);
    assert.equal(isCurrentSourceVersion(p), false);
    const old = mapSourceSummary(row(S, "everyone", { lineage_id: S, version_number: 1, supersedes_source_id: null, superseded_at: "2026-11-17T00:00:00Z", superseded_by_source_id: NEW_ID }));
    assert.equal(isSupersededSourceVersion(old), true);
    assert.equal(isCurrentSourceVersion(old), false);
  });

  it("refuses a malformed version object", () => {
    assert.throws(() => mapSourceSummary(row(S, "everyone", { lineage_id: "x", version_number: 0 })));
  });
});
