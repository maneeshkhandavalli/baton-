// Round 3 (D2): signed-upload flow robustness in lib/db/storage.ts — request checks, interrupted-upload
// retry, duplicate checksums, signing failures, idempotent confirm, oversized/empty objects, raw-path
// ownership and raw deletion. Fakes only; no network, no database, synthetic ids.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VerifiedActor } from "../actor-rules";
import type { DbClient } from "../client";
import { DbError } from "../errors";
import {
  MAX_SOURCE_BYTES,
  checkSourceUploadRequest,
  confirmSourceUpload,
  createSourceUpload,
  deleteRawSource,
  downloadVerifiedRawSourceWithMeta,
  isOwnedRawPath,
  loadRawSourceForPreview,
  measureBytes,
  rawSourcePath,
  type SourceUploadRequest,
  type StorageClient,
} from "../storage";

const USER = "44444444-4444-4444-8444-444444444444";
const H = "11111111-1111-4111-8111-111111111111";
const S = "66666666-6666-4666-8666-666666666666";
const S2 = "77777777-7777-4777-8777-777777777777";
const STALE = "88888888-8888-4888-8888-888888888888";
const SHA = "ab".repeat(32);

// Tests may mint actors directly (boundaries.test.ts allows casts only in tests and lib/db/actor.ts).
const actor = { profileId: USER, email: "a@example.test", emailConfirmed: true } as VerifiedActor;
const isCode = (code: string) => (e: unknown) => e instanceof DbError && e.code === code;

type Reply = { data?: unknown; error?: { code?: string; message: string } };
type Handler = Reply | Reply[] | ((args: Record<string, unknown> | undefined) => Reply);

function fakeDb(handlers: Record<string, Handler> = {}) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const counts = new Map<string, number>();
  const db: DbClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const n = counts.get(fn) ?? 0;
      counts.set(fn, n + 1);
      const h = handlers[fn];
      const r: Reply = typeof h === "function" ? h(args) : Array.isArray(h) ? (h[n] ?? h[h.length - 1]) : (h ?? { data: null });
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { db, calls, fns: () => calls.map((c) => c.fn) };
}

interface StorageOptions {
  sign?: "ok" | "error" | "throw" | "wrong-path";
  objects?: Record<string, Uint8Array | Blob>;
  removeError?: boolean;
}

function fakeStorage(opts: StorageOptions = {}) {
  const ops: Array<{ op: string; path: string | string[] }> = [];
  const storage: StorageClient = {
    from: () => ({
      createSignedUploadUrl: async (path) => {
        ops.push({ op: "sign", path });
        if (opts.sign === "error") return { data: null, error: { message: "synthetic signing failure" } };
        if (opts.sign === "throw") throw new Error("synthetic network failure");
        const p = opts.sign === "wrong-path" ? `raw/${H}/${S2}` : path;
        return { data: { signedUrl: `https://storage.example.test/object/upload/sign/source-uploads/${p}?token=t`, token: "t", path: p }, error: null };
      },
      download: async (path) => {
        ops.push({ op: "download", path });
        const o = opts.objects?.[path];
        if (!o) return { data: null, error: { message: "not found" } };
        return { data: o instanceof Uint8Array ? new Blob([o as unknown as ArrayBuffer]) : o, error: null };
      },
      remove: async (paths) => {
        ops.push({ op: "remove", path: paths });
        return opts.removeError ? { data: null, error: { message: "synthetic remove failure" } } : { data: [], error: null };
      },
    }),
  };
  return { storage, ops };
}

const request = (over: Partial<SourceUploadRequest> = {}): SourceUploadRequest => ({
  handoverId: H,
  kind: "whatsapp_export",
  fileName: "WhatsApp Chat with Club.txt",
  mimeType: "text/plain",
  sizeBytes: 100,
  sha256: SHA,
  ...over,
});

describe("R3 D2: upload request checks (before any row exists)", () => {
  const accepted: Array<Partial<SourceUploadRequest>> = [
    {},
    { fileName: "export.zip", mimeType: "application/zip" },
    { fileName: "export.zip", mimeType: "application/x-zip-compressed" }, // Windows browsers
    { fileName: "export.ZIP", mimeType: "" },
    { fileName: "chat.txt", mimeType: "text/plain; charset=utf-8" },
    { kind: "pdf", fileName: "report.pdf", mimeType: "application/pdf" },
    { kind: "pdf", fileName: "report.pdf", mimeType: "application/octet-stream" },
    { kind: "docx", fileName: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { kind: "markdown", fileName: "handbook.md", mimeType: "" },
    { kind: "markdown", fileName: "handbook.markdown", mimeType: "text/x-markdown" },
    { kind: "text", fileName: "notes.txt", mimeType: "text/plain" },
    { fileName: "WhatsApp Chat with [PHONE_1]", mimeType: "text/plain" }, // masked name, extension lost
    { sizeBytes: MAX_SOURCE_BYTES },
    { sizeBytes: 1 },
  ];
  for (const over of accepted) {
    it(`accepts ${JSON.stringify(over)}`, () => assert.doesNotThrow(() => checkSourceUploadRequest(request(over))));
  }

  const rejected: Array<[string, Partial<SourceUploadRequest>]> = [
    ["an empty file", { sizeBytes: 0 }],
    ["a negative size", { sizeBytes: -1 }],
    ["a fractional size", { sizeBytes: 10.5 }],
    ["an oversized file", { sizeBytes: MAX_SOURCE_BYTES + 1 }],
    ["an uppercase checksum", { sha256: SHA.toUpperCase() }],
    ["a short checksum", { sha256: "ab" }],
    ["a PDF declared as a chat export", { fileName: "report.pdf" }],
    ["an executable declared as a chat export", { fileName: "chat.exe", mimeType: "application/octet-stream" }],
    ["a .doc declared as DOCX", { kind: "docx", fileName: "notes.doc", mimeType: "application/msword" }],
    ["a PNG MIME type for a PDF", { kind: "pdf", fileName: "scan.pdf", mimeType: "image/png" }],
    ["a PDF MIME type for Markdown", { kind: "markdown", fileName: "notes.md", mimeType: "application/pdf" }],
    ["HTML declared as text", { kind: "text", fileName: "page.txt", mimeType: "text/html" }],
    ["an unknown kind", { kind: "spreadsheet" as never }],
  ];
  for (const [name, over] of rejected) {
    it(`rejects ${name}`, () => assert.throws(() => checkSourceUploadRequest(request(over)), isCode("validation_failed")));
  }

  it("an invalid request creates nothing and signs nothing", async () => {
    const { db, calls } = fakeDb();
    const { storage, ops } = fakeStorage();
    await assert.rejects(createSourceUpload(db, actor, storage, request({ sizeBytes: 0 })), isCode("validation_failed"));
    assert.deepEqual(calls, []);
    assert.deepEqual(ops, []);
  });
});

describe("R3 D2: create + sign", () => {
  it("happy path: one row, one signature on raw/{handover}/{source}", async () => {
    const { db, fns } = fakeDb({ create_source: { data: S } });
    const { storage, ops } = fakeStorage();
    const t = await createSourceUpload(db, actor, storage, request());
    assert.equal(t.sourceId, S);
    assert.deepEqual(fns(), ["create_source"]);
    assert.deepEqual(ops, [{ op: "sign", path: rawSourcePath(H, S) }]);
    assert.ok(Date.parse(t.expiresAt) > Date.now());
  });

  for (const mode of ["error", "throw", "wrong-path"] as const) {
    it(`signing ${mode}: the new row is removed again (no orphan for a live draft) and the call fails`, async () => {
      const { db, fns, calls } = fakeDb({ create_source: { data: S }, remove_source: { data: rawSourcePath(H, S) } });
      const { storage } = fakeStorage({ sign: mode });
      await assert.rejects(createSourceUpload(db, actor, storage, request()), isCode("internal"));
      assert.deepEqual(fns(), ["create_source", "remove_source", "mark_source_raw_deleted"]);
      assert.equal(calls[1].args?.p_source_id, S);
      assert.equal(calls[1].args?.p_actor_profile_id, USER);
    });
  }

  it("signing fails AND the compensation fails: still a clean internal error (the sweep reports the row)", async () => {
    const { db } = fakeDb({ create_source: { data: S }, remove_source: { error: { code: "BTIT0", message: "x" } } });
    await assert.rejects(createSourceUpload(db, actor, fakeStorage({ sign: "error" }).storage, request()), isCode("internal"));
  });
});

describe("R3 D2: duplicate checksum and retry after an interrupted upload", () => {
  const conflict = { error: { code: "BTCF0", message: "this file was already uploaded" } };

  it("the actor's own stale pending row is replaced and the retry succeeds", async () => {
    const { db, fns, calls } = fakeDb({
      create_source: [conflict, { data: S }],
      stale_pending_source: { data: STALE },
      remove_source: { data: rawSourcePath(H, STALE) },
    });
    const admin = fakeStorage();
    const t = await createSourceUpload(db, actor, fakeStorage().storage, request(), admin.storage);
    assert.equal(t.sourceId, S);
    assert.deepEqual(fns(), ["create_source", "stale_pending_source", "remove_source", "mark_source_raw_deleted", "create_source"]);
    assert.deepEqual(calls[1].args, { p_actor_profile_id: USER, p_handover_id: H, p_sha256_hex: SHA });
    assert.deepEqual(admin.ops, [{ op: "remove", path: [rawSourcePath(H, STALE)] }], "any partial object of the stale upload is deleted");
  });

  it("without admin storage the stale row is still replaced; its raw path is left for the sweep", async () => {
    const { db, fns } = fakeDb({
      create_source: [conflict, { data: S }],
      stale_pending_source: { data: STALE },
      remove_source: { data: rawSourcePath(H, STALE) },
    });
    await createSourceUpload(db, actor, fakeStorage().storage, request());
    assert.deepEqual(fns(), ["create_source", "stale_pending_source", "remove_source", "create_source"]);
  });

  it("a real duplicate (uploaded, parsed or another member's) still fails with conflict and removes nothing", async () => {
    const { db, fns } = fakeDb({ create_source: conflict, stale_pending_source: { data: null } });
    await assert.rejects(createSourceUpload(db, actor, fakeStorage().storage, request()), isCode("conflict"));
    assert.deepEqual(fns(), ["create_source", "stale_pending_source"]);
  });

  it("a retryable serialization conflict is not treated as a duplicate", async () => {
    const { db, fns } = fakeDb({ create_source: { error: { code: "40001", message: "serialization" } } });
    await assert.rejects(createSourceUpload(db, actor, fakeStorage().storage, request()), isCode("conflict"));
    assert.deepEqual(fns(), ["create_source"]);
  });

  it("other create failures (source limit, lifecycle) are passed through untouched", async () => {
    for (const code of ["BTPF0", "BTIT0", "BTFB0", "BTNF0"]) {
      const { db, fns } = fakeDb({ create_source: { error: { code, message: "x" } } });
      await assert.rejects(createSourceUpload(db, actor, fakeStorage().storage, request()), (e: unknown) => e instanceof DbError);
      assert.deepEqual(fns(), ["create_source"]);
    }
  });
});

describe("R3 D2: confirm", () => {
  const bytes = new TextEncoder().encode("14/02/2024, 10:00 - Asha Rao: synthetic chat");
  const path = rawSourcePath(H, S);
  const targetFor = async (b: Uint8Array) => {
    const m = await measureBytes(b);
    return { data: { raw_storage_path: path, size_bytes: m.sizeBytes, sha256: m.sha256 } };
  };
  const invalidTransition = { error: { code: "BTIT0", message: "source is not awaiting upload" } };

  it("happy path: target → download → confirm with the measured values", async () => {
    const { db, fns, calls } = fakeDb({ source_upload_target: await targetFor(bytes) });
    const { storage, ops } = fakeStorage({ objects: { [path]: bytes } });
    await confirmSourceUpload(db, storage, actor, S);
    assert.deepEqual(fns(), ["source_upload_target", "confirm_source_uploaded"]);
    assert.equal(calls[1].args?.p_measured_size, bytes.byteLength);
    assert.deepEqual(ops, [{ op: "download", path }]);
  });

  it("retry after a lost response: an already-confirmed source succeeds without touching storage", async () => {
    const { db, fns } = fakeDb({ source_upload_target: invalidTransition, raw_source_for_processing: { data: { state: "uploaded" } } });
    const { storage, ops } = fakeStorage();
    await confirmSourceUpload(db, storage, actor, S);
    assert.deepEqual(fns(), ["source_upload_target", "raw_source_for_processing"]);
    assert.deepEqual(ops, []);
  });

  it("two confirms racing: the loser's invalid_transition is success when the source is uploaded", async () => {
    const { db } = fakeDb({
      source_upload_target: await targetFor(bytes),
      confirm_source_uploaded: invalidTransition,
      raw_source_for_processing: { data: { state: "uploaded" } },
    });
    await confirmSourceUpload(db, fakeStorage({ objects: { [path]: bytes } }).storage, actor, S);
  });

  for (const state of ["parsed", "failed", "removed", "parsing"]) {
    it(`a confirm on a ${state} source is still invalid_transition`, async () => {
      const { db } = fakeDb({ source_upload_target: invalidTransition, raw_source_for_processing: { data: { state } } });
      await assert.rejects(confirmSourceUpload(db, fakeStorage().storage, actor, S), isCode("invalid_transition"));
    });
  }

  it("interrupted upload (no object yet): precondition_failed, nothing removed, row kept for a retry", async () => {
    const { db, fns } = fakeDb({ source_upload_target: await targetFor(bytes) });
    const { storage, ops } = fakeStorage();
    await assert.rejects(confirmSourceUpload(db, storage, actor, S), isCode("precondition_failed"));
    assert.deepEqual(fns(), ["source_upload_target"]);
    assert.ok(!ops.some((o) => o.op === "remove"));
  });

  it("an object larger than 25 MB is removed and refused before it is read", async () => {
    const big = { size: MAX_SOURCE_BYTES + 1, arrayBuffer: async () => assert.fail("must not be read") } as unknown as Blob;
    const { db, fns } = fakeDb({ source_upload_target: await targetFor(bytes) });
    const { storage, ops } = fakeStorage({ objects: { [path]: big } });
    await assert.rejects(confirmSourceUpload(db, storage, actor, S), isCode("validation_failed"));
    assert.deepEqual(fns(), ["source_upload_target"]);
    assert.deepEqual(ops.at(-1), { op: "remove", path: [path] });
  });

  it("an empty object (truncated upload) is measured as 0 bytes; the database refuses it and it is removed", async () => {
    const { db, calls } = fakeDb({
      source_upload_target: await targetFor(bytes),
      confirm_source_uploaded: { error: { code: "BTVF0", message: "mismatch" } },
    });
    const { storage, ops } = fakeStorage({ objects: { [path]: new Uint8Array(0) } });
    await assert.rejects(confirmSourceUpload(db, storage, actor, S), isCode("validation_failed"));
    assert.equal(calls[1].args?.p_measured_size, 0);
    assert.deepEqual(ops.at(-1), { op: "remove", path: [path] });
  });

  it("a path that is not this source's raw path is never downloaded", async () => {
    for (const bad of [`raw/${H}/${S2}`, `raw/${H}/../${S}`, `raw/${H}/${S}/x`, `public/${S}`, `raw//${S}`]) {
      const { db } = fakeDb({ source_upload_target: { data: { raw_storage_path: bad, size_bytes: 1, sha256: "00" } } });
      const { storage, ops } = fakeStorage();
      await assert.rejects(confirmSourceUpload(db, storage, actor, S), isCode("internal"), bad);
      assert.deepEqual(ops, [], bad);
    }
  });
});

describe("R3 D2: raw-path ownership on every read and delete", () => {
  it("isOwnedRawPath", () => {
    assert.ok(isOwnedRawPath(rawSourcePath(H, S), S));
    assert.ok(isOwnedRawPath(rawSourcePath(H, S).toUpperCase().replace("RAW", "raw"), S), "UUID case is not significant");
    assert.ok(isOwnedRawPath("raw/h/s", S), "placeholder segments are accepted (only UUIDs are bound)");
    for (const bad of [null, undefined, 42, "", `raw/${H}/${S2}`, `raw/${H}`, `raw/${H}/${S}/`, `raw/../${S}`, `/raw/${H}/${S}`, `raw/${H}/${S}?x`, `raw\\${H}\\${S}`]) {
      assert.ok(!isOwnedRawPath(bad, S), String(bad));
    }
  });

  it("the parse job refuses a foreign path and never marks the source failed for it", async () => {
    const { db, fns } = fakeDb({ raw_source_for_processing: { data: { raw_storage_path: `raw/${H}/${S2}`, size_bytes: 1, sha256: "00", kind: "text" } } });
    const { storage, ops } = fakeStorage();
    await assert.rejects(downloadVerifiedRawSourceWithMeta(db, storage, S), isCode("internal"));
    assert.deepEqual(fns(), ["raw_source_for_processing"]);
    assert.deepEqual(ops, []);
  });

  it("the preview refuses a foreign path", async () => {
    const { db } = fakeDb({ source_preview_target: { data: { raw_storage_path: `raw/${H}/../../etc`, size_bytes: 1, sha256: "00", handover_id: H } } });
    const { storage, ops } = fakeStorage();
    await assert.rejects(loadRawSourceForPreview(db, storage, actor, S), isCode("internal"));
    assert.deepEqual(ops, []);
  });

  it("deleteRawSource never deletes another source's object", async () => {
    const { db, fns } = fakeDb();
    const { storage, ops } = fakeStorage();
    await assert.rejects(deleteRawSource(db, storage, S, rawSourcePath(H, S2)), isCode("internal"));
    assert.deepEqual(ops, []);
    assert.deepEqual(fns(), []);
  });

  it("deleteRawSource is idempotent: an already-missing object is fine and the row is marked", async () => {
    const { db, fns } = fakeDb();
    const { storage, ops } = fakeStorage(); // no objects: Storage reports success for a missing path
    await deleteRawSource(db, storage, S, rawSourcePath(H, S));
    await deleteRawSource(db, storage, S, rawSourcePath(H, S));
    assert.deepEqual(fns(), ["mark_source_raw_deleted", "mark_source_raw_deleted"]);
    assert.equal(ops.length, 2);
  });

  it("deleteRawSource: a storage failure leaves the row unmarked (raw path kept for the sweep)", async () => {
    const { db, fns } = fakeDb();
    await assert.rejects(deleteRawSource(db, fakeStorage({ removeError: true }).storage, S, rawSourcePath(H, S)), isCode("internal"));
    assert.deepEqual(fns(), []);
  });
});
