// Integration support wrappers (migration 20261112000100): storage guards and worker RPC shapes.
//   node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/db/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VerifiedActor } from "../actor-rules";
import type { DbClient } from "../client";
import { DbError } from "../errors";
import { completeJob, heartbeatJob, listExtractionMessages } from "../pipeline";
import { getSourceSummary } from "../queries";
import { deleteParsedRawSource, loadRawSourceForPreview, measureBytes, type StorageClient } from "../storage";

const SOURCE = "4f1c2a3b-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const HANDOVER = "5a2b3c4d-6e7f-4a81-9b2c-3d4e5f6a7b8c";
const actor = { profileId: "6b3c4d5e-7f80-4b92-8c3d-4e5f6a7b8c9d", email: "a@example.test", emailConfirmed: true } as VerifiedActor;

function fakeClient(responses: Record<string, { data?: unknown; error?: { code?: string; message: string } }>) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const client: DbClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const r = responses[fn] ?? { data: null };
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { client, calls };
}

function fakeStorage(bytes: Uint8Array | null) {
  const removed: string[][] = [];
  const storage: StorageClient = {
    from: () => ({
      createSignedUploadUrl: async () => ({ data: null, error: { message: "unused" } }),
      download: async () => (bytes ? { data: new Blob([bytes as unknown as ArrayBuffer]), error: null } : { data: null, error: { message: "missing" } }),
      remove: async (paths: string[]) => {
        removed.push(paths);
        return { data: null, error: null };
      },
    }),
  };
  return { storage, removed };
}

const BYTES = new TextEncoder().encode("synthetic chat export");

describe("deleteParsedRawSource (QA-L1, D14)", () => {
  it("refuses to delete the raw upload of a source that is not parsed", async () => {
    for (const state of ["uploaded", "failed", "parsing"]) {
      const { client, calls } = fakeClient({ raw_source_for_processing: { data: { raw_storage_path: "raw/h/s", state } } });
      const { storage, removed } = fakeStorage(BYTES);
      await assert.rejects(deleteParsedRawSource(client, storage, SOURCE), (e: unknown) => e instanceof DbError && e.code === "precondition_failed");
      assert.equal(removed.length, 0, `nothing removed in state ${state}`);
      assert.ok(!calls.some((c) => c.fn === "mark_source_raw_deleted"));
    }
  });

  it("deletes a parsed source's object, then marks it", async () => {
    const { client, calls } = fakeClient({ raw_source_for_processing: { data: { raw_storage_path: "raw/h/s", state: "parsed" } } });
    const { storage, removed } = fakeStorage(BYTES);
    await deleteParsedRawSource(client, storage, SOURCE);
    assert.deepEqual(removed, [["raw/h/s"]]);
    assert.equal(calls.at(-1)?.fn, "mark_source_raw_deleted");
  });

  it("uses the database path, never a caller-supplied one, and is a no-op once deleted", async () => {
    const { client } = fakeClient({ raw_source_for_processing: { data: { raw_storage_path: null, state: "parsed" } } });
    const { storage, removed } = fakeStorage(BYTES);
    await deleteParsedRawSource(client, storage, SOURCE);
    assert.equal(removed.length, 0);
  });
});

describe("loadRawSourceForPreview (R2, §10.3 step 1)", () => {
  const target = async (sha256: string) => ({
    handover_id: HANDOVER, raw_storage_path: "raw/h/s", size_bytes: BYTES.byteLength, sha256,
    kind: "whatsapp_export", timezone: "Asia/Kolkata", date_order: null, original_filename: "chat.txt",
  });

  it("passes the verified actor to the SQL check and returns bytes with parse inputs", async () => {
    const { sha256 } = await measureBytes(BYTES);
    const { client, calls } = fakeClient({ source_preview_target: { data: await target(sha256) } });
    const out = await loadRawSourceForPreview(client, fakeStorage(BYTES).storage, actor, SOURCE);
    assert.equal(calls[0].args?.p_actor_profile_id, actor.profileId);
    assert.equal(out.handoverId, HANDOVER);
    assert.equal(out.kind, "whatsapp_export");
    assert.deepEqual(out.bytes, BYTES);
  });

  it("an integrity mismatch is precondition_failed and changes nothing (no parse-failed mark)", async () => {
    const { client, calls } = fakeClient({ source_preview_target: { data: await target("0".repeat(64)) } });
    await assert.rejects(loadRawSourceForPreview(client, fakeStorage(BYTES).storage, actor, SOURCE),
      (e: unknown) => e instanceof DbError && e.code === "precondition_failed");
    assert.deepEqual(calls.map((c) => c.fn), ["source_preview_target"]);
  });

  it("a missing object is precondition_failed", async () => {
    const { sha256 } = await measureBytes(BYTES);
    const { client } = fakeClient({ source_preview_target: { data: await target(sha256) } });
    await assert.rejects(loadRawSourceForPreview(client, fakeStorage(null).storage, actor, SOURCE),
      (e: unknown) => e instanceof DbError && e.code === "precondition_failed");
  });

  it("SQL refusals pass through unchanged", async () => {
    const { client } = fakeClient({ source_preview_target: { error: { code: "BTFB0", message: "x" } } });
    await assert.rejects(loadRawSourceForPreview(client, fakeStorage(BYTES).storage, actor, SOURCE),
      (e: unknown) => e instanceof DbError && e.code === "forbidden");
  });
});

describe("worker RPC wrappers", () => {
  it("completeJob sends the fencing attempt and maps a lost lease to conflict", async () => {
    const { client, calls } = fakeClient({ complete_processing_job: { error: { code: "BTCF0", message: "lease lost" } } });
    await assert.rejects(completeJob(client, { jobId: SOURCE, attempt: 2, outcome: "succeeded" }),
      (e: unknown) => e instanceof DbError && e.code === "conflict");
    assert.equal(calls[0].args?.p_attempt, 2);
  });

  it("heartbeatJob and listExtractionMessages pass their arguments", async () => {
    const { client, calls } = fakeClient({
      heartbeat_processing_job: { data: "running" },
      list_extraction_messages: { data: { accessLevel: "everyone", messages: [] } },
    });
    assert.equal(await heartbeatJob(client, { jobId: SOURCE, attempt: 1, leaseSeconds: 300, progress: { done: 1, total: 3 } }), "running");
    assert.equal(calls[0].args?.p_progress_done, 1);
    assert.deepEqual(await listExtractionMessages(client, { sourceId: SOURCE, afterSeq: -1, limit: 500 }), { accessLevel: "everyone", messages: [] });
  });

  it("getSourceSummary: malformed ids and invisible sources are not_found", async () => {
    const { client, calls } = fakeClient({});
    assert.deepEqual((await getSourceSummary(() => client, "nope")).ok, false);
    assert.equal(calls.length, 0);
    const r = await getSourceSummary(() => client, SOURCE);
    assert.equal(r.ok ? "ok" : r.error.code, "not_found");
  });
});
