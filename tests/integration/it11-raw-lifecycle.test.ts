// IT-11 (TypeScript half): the raw upload is deleted only for a parsed source, only from the path the
// database holds, and only after the database said so; a preview or an integrity failure never deletes it
// (§10.3, D14, M5, QA-L1, QA-M7/R2). Real lib/db/storage functions over RecordingDb + RecordingStorage
// sharing one event log. The database half is tests/integration/db/sql/it11_raw_lifecycle.sql.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import { getVerifiedActor } from "../../lib/db/actor";
import { isDbError } from "../../lib/db/errors";
import {
  SOURCE_BUCKET,
  deleteParsedRawSource,
  downloadVerifiedRawSourceWithMeta,
  loadRawSourceForPreview,
} from "../../lib/db/storage";
import { resetPlatform, signInAs } from "./support/platform";
import { RecordingDb } from "./support/recording-db";
import { RecordingStorage } from "./support/recording-storage";

/** DB-12: the parse job writes an integrity mismatch under its claim (fenced writer). */
const CLAIM = { jobId: randomUUID(), attempt: 1 };

const BYTES = new TextEncoder().encode("10/02/2024, 18:00 - Asha Rao: synthetic raw chat line\n");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const code = (c: string) => (e: unknown) => isDbError(e) && e.code === c;

function setup(row: Record<string, unknown> | null) {
  const events: string[] = [];
  const db = new RecordingDb(events);
  const storage = new RecordingStorage(events);
  const sourceId = randomUUID();
  const handoverId = randomUUID(); // the raw path and the row share one handover (QA-R3-06)
  const path = `raw/${handoverId}/${sourceId}`;
  storage.put(SOURCE_BUCKET, path, BYTES);
  const fullRow =
    row === null
      ? null
      : { raw_storage_path: path, size_bytes: BYTES.byteLength, sha256: SHA, kind: "whatsapp_export", timezone: "Asia/Kolkata",
          date_order: "dmy", original_filename: "chat.txt", handover_id: handoverId, ...row };
  db.returns("raw_source_for_processing", fullRow)
    .returns("source_preview_target", fullRow)
    .returns("mark_source_raw_deleted", null)
    .returns("pipeline_mark_source_parse_failed", null);
  return { events, db, storage, sourceId, path };
}

beforeEach(() => resetPlatform());

describe("IT-11 / QA-L1: deleteParsedRawSource", () => {
  for (const state of ["uploaded", "failed", "parsing", "pending_upload", "removed"]) {
    it(`refuses a ${state} source and deletes nothing`, async () => {
      const { db, storage, sourceId, path } = setup({ state });
      await assert.rejects(deleteParsedRawSource(db, storage, sourceId), code("precondition_failed"));
      assert.deepEqual(storage.removed(), []);
      assert.ok(storage.has(SOURCE_BUCKET, path), "the raw upload is still there for a retry");
      assert.ok(!db.called("mark_source_raw_deleted"));
    });
  }

  it("for a parsed source: reads the path from the database, removes it, then marks it deleted — in that order", async () => {
    const { db, storage, sourceId, path, events } = setup({ state: "parsed" });
    await deleteParsedRawSource(db, storage, sourceId);
    assert.deepEqual(events, ["db:raw_source_for_processing", `storage:remove:${path}`, "db:mark_source_raw_deleted"]);
    assert.deepEqual(storage.removed(), [path]);
    assert.deepEqual(db.last("mark_source_raw_deleted")?.args, { p_source_id: sourceId });
  });

  it("an already deleted raw upload is a no-op", async () => {
    const { db, storage, sourceId } = setup({ state: "parsed", raw_storage_path: null });
    await deleteParsedRawSource(db, storage, sourceId);
    assert.deepEqual(storage.removed(), []);
    assert.ok(!db.called("mark_source_raw_deleted"));
  });

  it("an unknown source is not_found", async () => {
    const { db, storage, sourceId } = setup(null);
    await assert.rejects(deleteParsedRawSource(db, storage, sourceId), code("not_found"));
    assert.deepEqual(storage.removed(), []);
  });

  it("a failed storage delete is not recorded as deleted (the retention sweep retries it)", async () => {
    const { db, storage, sourceId } = setup({ state: "parsed" });
    storage.failOn("remove");
    await assert.rejects(deleteParsedRawSource(db, storage, sourceId), code("internal"));
    assert.ok(!db.called("mark_source_raw_deleted"));
  });
});

describe("IT-11 / M5: the parse job re-verifies the raw bytes", () => {
  it("matching bytes come back with their metadata, and nothing is written", async () => {
    const { db, storage, sourceId, path } = setup({ state: "uploaded" });
    const got = await downloadVerifiedRawSourceWithMeta(db, storage, sourceId, CLAIM);
    assert.deepEqual([...got.bytes], [...BYTES]);
    assert.equal(got.rawStoragePath, path);
    assert.equal(got.dateOrder, "dmy");
    assert.deepEqual(db.fns(), ["raw_source_for_processing"]);
    assert.deepEqual(storage.removed(), []);
  });

  it("tampered bytes fail the source (integrity_mismatch), are never returned, and the raw upload is kept", async () => {
    const { db, storage, sourceId, path } = setup({ state: "uploaded", sha256: "00".repeat(32) });
    await assert.rejects(downloadVerifiedRawSourceWithMeta(db, storage, sourceId, CLAIM), code("validation_failed"));
    assert.deepEqual(db.last("pipeline_mark_source_parse_failed")?.args, { p_job_id: CLAIM.jobId, p_attempt: CLAIM.attempt, p_error_code: "integrity_mismatch" });
    assert.deepEqual(storage.removed(), []);
    assert.ok(storage.has(SOURCE_BUCKET, path));
  });
});

describe("IT-11 / QA-M7: loadRawSourceForPreview is actor-checked and read-only", () => {
  async function actor() {
    signInAs("0b6a1c1e-1f00-4c3b-9d7a-0000000000b2");
    const a = await getVerifiedActor();
    assert.ok(a);
    return a;
  }

  it("passes the verified actor to the database check and returns the bytes", async () => {
    const a = await actor();
    const { db, storage, sourceId } = setup({ state: "uploaded" });
    const got = await loadRawSourceForPreview(db, storage, a, sourceId);
    assert.equal(got.bytes.byteLength, BYTES.byteLength);
    assert.deepEqual(db.fns(), ["source_preview_target"], "no write of any kind");
    assert.deepEqual(db.last("source_preview_target")?.args, { p_actor_profile_id: a.profileId, p_source_id: sourceId });
    assert.deepEqual(storage.removed(), []);
  });

  it("a size/hash mismatch is precondition_failed and, unlike the parse job, changes nothing", async () => {
    const a = await actor();
    const { db, storage, sourceId } = setup({ state: "uploaded", size_bytes: 1 });
    await assert.rejects(loadRawSourceForPreview(db, storage, a, sourceId), code("precondition_failed"));
    assert.deepEqual(db.fns(), ["source_preview_target"]);
    assert.deepEqual(storage.removed(), []);
  });

  it("a missing object is precondition_failed", async () => {
    const a = await actor();
    const { db, storage, sourceId, path } = setup({ state: "uploaded" });
    await storage.from(SOURCE_BUCKET).remove([path]);
    await assert.rejects(loadRawSourceForPreview(db, storage, a, sourceId), code("precondition_failed"));
  });

  it("the database's refusal is passed through unchanged (forbidden for non-managers, not_found for strangers)", async () => {
    const a = await actor();
    for (const [sqlstate, expected] of [["BTFB0", "forbidden"], ["BTNF0", "not_found"], ["BTIT0", "invalid_transition"]] as const) {
      const { db, storage, sourceId } = setup({ state: "uploaded" });
      db.fails("source_preview_target", sqlstate);
      await assert.rejects(loadRawSourceForPreview(db, storage, a, sourceId), code(expected));
      assert.deepEqual(storage.ops, [], "storage is not touched when the database refuses");
    }
  });
});
