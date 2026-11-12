// Round 3 (D2): signed-upload flow robustness in lib/db/storage.ts — request checks, interrupted-upload
// retry, duplicate checksums, signing failures, idempotent confirm, oversized/empty objects, raw-path
// ownership and raw deletion. Fakes only; no network, no database, synthetic ids.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MULTIFORMAT_SET } from "../../../fixtures/demo/round3-multiformat/build";
import { buildDocx, buildPdf, buildZip, bytesOf } from "../../../fixtures/parser/builders";
import type { VerifiedActor } from "../actor-rules";
import type { DbClient } from "../client";
import { DbError } from "../errors";
import { ClaimLostError } from "../pipeline";
import {
  MAX_SOURCE_BYTES,
  bytesMatchKind,
  checkSourceUploadRequest,
  confirmSourceUpload,
  createSourceUpload,
  deleteHandoverRawObjects,
  downloadVerifiedRawSource,
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

describe("R3 D2: duplicate checksum", () => {
  // Reusing a stale pending_upload row for an interrupted upload is create_source's job (Agent 2, C2/C3);
  // the storage helper must pass every create failure through unchanged and create nothing else.
  it("conflict and other create failures are passed through untouched; nothing is signed", async () => {
    for (const code of ["BTCF0", "40001", "BTPF0", "BTIT0", "BTFB0", "BTNF0"]) {
      const { db, fns } = fakeDb({ create_source: { error: { code, message: "x" } } });
      const { storage, ops } = fakeStorage();
      await assert.rejects(createSourceUpload(db, actor, storage, request()), (e: unknown) => e instanceof DbError);
      assert.deepEqual(fns(), ["create_source"]);
      assert.deepEqual(ops, []);
    }
  });
  it("a duplicate checksum surfaces as conflict", async () => {
    const { db } = fakeDb({ create_source: { error: { code: "BTCF0", message: "this file was already uploaded" } } });
    await assert.rejects(createSourceUpload(db, actor, fakeStorage().storage, request()), isCode("conflict"));
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
    await assert.rejects(downloadVerifiedRawSourceWithMeta(db, storage, S, { jobId: "33333333-3333-4333-8333-333333333333", attempt: 1 }), isCode("internal"));
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

describe("R3-D5: raw cleanup on discard (deleteHandoverRawObjects)", () => {
  const S3 = "99999999-9999-4999-8999-999999999999";
  const OTHER_H = "22222222-2222-4222-8222-222222222222";
  const row = (sourceId: string, path: unknown = rawSourcePath(H, sourceId)) => ({ sourceId, rawStoragePath: path });

  /** Storage that fails `remove` for the listed paths only. */
  function storageFailingFor(failing: string[] = []) {
    const removed: string[][] = [];
    const storage: StorageClient = {
      from: () => ({
        createSignedUploadUrl: async () => ({ data: null, error: { message: "unused" } }),
        download: async () => ({ data: null, error: { message: "unused" } }),
        remove: async (paths) => {
          removed.push(paths);
          return paths.some((p) => failing.includes(p)) ? { data: null, error: { message: "synthetic remove failure" } } : { data: [], error: null };
        },
      }),
    };
    return { storage, removed };
  }

  it("lists with the actor, removes each owned object, then marks it; counts per source", async () => {
    const { db, calls } = fakeDb({ list_deleted_handover_raw_paths: { data: [row(S), row(S2), row(S3)] } });
    const { storage, removed } = storageFailingFor();
    assert.deepEqual(await deleteHandoverRawObjects(db, storage, actor, H), { deleted: 3, failed: 0 });
    assert.deepEqual(calls[0], { fn: "list_deleted_handover_raw_paths", args: { p_actor_profile_id: USER, p_handover_id: H } });
    assert.deepEqual(removed, [[rawSourcePath(H, S)], [rawSourcePath(H, S2)], [rawSourcePath(H, S3)]]);
    assert.deepEqual(calls.slice(1).map((c) => [c.fn, c.args?.p_source_id]), [
      ["mark_source_raw_deleted", S],
      ["mark_source_raw_deleted", S2],
      ["mark_source_raw_deleted", S3],
    ]);
  });

  it("nothing to delete: { deleted: 0, failed: 0 } and no storage call", async () => {
    for (const data of [[], null]) {
      const { db, fns } = fakeDb({ list_deleted_handover_raw_paths: { data } });
      const { storage, removed } = storageFailingFor();
      assert.deepEqual(await deleteHandoverRawObjects(db, storage, actor, H), { deleted: 0, failed: 0 });
      assert.deepEqual(fns(), ["list_deleted_handover_raw_paths"]);
      assert.deepEqual(removed, []);
    }
  });

  it("a Storage failure never throws: that source is counted failed, left unmarked, and the rest continue", async () => {
    const { db, calls } = fakeDb({ list_deleted_handover_raw_paths: { data: [row(S), row(S2), row(S3)] } });
    const { storage } = storageFailingFor([rawSourcePath(H, S2)]);
    assert.deepEqual(await deleteHandoverRawObjects(db, storage, actor, H), { deleted: 2, failed: 1 });
    assert.deepEqual(calls.filter((c) => c.fn === "mark_source_raw_deleted").map((c) => c.args?.p_source_id), [S, S3]);
  });

  it("a Storage client that throws is a failure too, not an exception", async () => {
    const { db } = fakeDb({ list_deleted_handover_raw_paths: { data: [row(S)] } });
    const storage: StorageClient = {
      from: () => ({
        createSignedUploadUrl: async () => ({ data: null, error: null }),
        download: async () => ({ data: null, error: null }),
        remove: async () => {
          throw new Error("synthetic network failure");
        },
      }),
    };
    assert.deepEqual(await deleteHandoverRawObjects(db, storage, actor, H), { deleted: 0, failed: 1 });
  });

  it("a marking failure after a successful remove counts as failed (the path stays listed for the sweep)", async () => {
    const { db } = fakeDb({
      list_deleted_handover_raw_paths: { data: [row(S)] },
      mark_source_raw_deleted: { error: { code: "BTNF0", message: "x" } },
    });
    assert.deepEqual(await deleteHandoverRawObjects(db, storageFailingFor().storage, actor, H), { deleted: 0, failed: 1 });
  });

  it("foreign or malformed paths are never removed: counted failed", async () => {
    const bad = [
      row(S, rawSourcePath(H, S2)), // another source's object
      row(S2, rawSourcePath(OTHER_H, S2)), // another handover's folder
      row(S3, `raw/${H}/../${S3}`),
      row(S, null),
      { sourceId: 42, rawStoragePath: rawSourcePath(H, S) },
      null,
    ];
    const { db, fns } = fakeDb({ list_deleted_handover_raw_paths: { data: bad } });
    const { storage, removed } = storageFailingFor();
    assert.deepEqual(await deleteHandoverRawObjects(db, storage, actor, H), { deleted: 0, failed: bad.length });
    assert.deepEqual(removed, []);
    assert.deepEqual(fns(), ["list_deleted_handover_raw_paths"]);
  });

  it("a refused listing (live handover, wrong actor) throws the DbError and touches nothing", async () => {
    for (const [code, expected] of [["BTPF0", "precondition_failed"], ["BTNF0", "not_found"], ["BTUA0", "unauthenticated"]] as const) {
      const { db, fns } = fakeDb({ list_deleted_handover_raw_paths: { error: { code, message: "x" } } });
      const { storage, removed } = storageFailingFor();
      await assert.rejects(deleteHandoverRawObjects(db, storage, actor, H), isCode(expected));
      assert.deepEqual(fns(), ["list_deleted_handover_raw_paths"]);
      assert.deepEqual(removed, []);
    }
  });

  it("idempotent: a second run after success finds nothing; a retry after a failure deletes the rest", async () => {
    const first = fakeDb({ list_deleted_handover_raw_paths: { data: [row(S), row(S2)] } });
    assert.deepEqual(await deleteHandoverRawObjects(first.db, storageFailingFor([rawSourcePath(H, S2)]).storage, actor, H), { deleted: 1, failed: 1 });
    const retry = fakeDb({ list_deleted_handover_raw_paths: { data: [row(S2)] } });
    assert.deepEqual(await deleteHandoverRawObjects(retry.db, storageFailingFor().storage, actor, H), { deleted: 1, failed: 0 });
  });
});

describe("QA-R3-06: the handover segment of a raw path is checked", () => {
  const OTHER_H = "22222222-2222-4222-8222-222222222222";
  it("bound to the handover when the caller knows it", () => {
    assert.ok(isOwnedRawPath(rawSourcePath(H, S), S, H));
    assert.ok(isOwnedRawPath(rawSourcePath(H, S), S, H.toUpperCase()), "UUID case is not significant");
    assert.ok(!isOwnedRawPath(rawSourcePath(OTHER_H, S), S, H), "same source id under another handover");
    assert.ok(!isOwnedRawPath(`raw/h/${S}`, S, H), "placeholder handover segment");
  });
  it("without a handover id, a real (UUID) source path needs a UUID handover segment", () => {
    assert.ok(isOwnedRawPath(rawSourcePath(OTHER_H, S), S), "shape only: any UUID handover");
    for (const seg of ["h", "x", "0", "raw", "11111111-1111-4111-8111"]) assert.ok(!isOwnedRawPath(`raw/${seg}/${S}`, S), seg);
  });
  it("deleteHandoverRawObjects never touches a path under another handover", async () => {
    const { db } = fakeDb({ list_deleted_handover_raw_paths: { data: [{ sourceId: S, rawStoragePath: rawSourcePath(OTHER_H, S) }] } });
    const removed: string[][] = [];
    const storage: StorageClient = {
      from: () => ({
        createSignedUploadUrl: async () => ({ data: null, error: null }),
        download: async () => ({ data: null, error: null }),
        remove: async (paths) => {
          removed.push(paths);
          return { data: [], error: null };
        },
      }),
    };
    assert.deepEqual(await deleteHandoverRawObjects(db, storage, actor, H), { deleted: 0, failed: 1 });
    assert.deepEqual(removed, []);
  });
  it("deleteRawSource and the parse job refuse a placeholder handover segment on a real source path", async () => {
    const { db, fns } = fakeDb({ raw_source_for_processing: { data: { raw_storage_path: `raw/x/${S}`, size_bytes: 1, sha256: "00", kind: "text" } } });
    await assert.rejects(downloadVerifiedRawSourceWithMeta(db, fakeStorage().storage, S, { jobId: "33333333-3333-4333-8333-333333333333", attempt: 1 }), isCode("internal"));
    await assert.rejects(deleteRawSource(db, fakeStorage().storage, S, `raw/x/${S}`), isCode("internal"));
    assert.deepEqual(fns(), ["raw_source_for_processing"]);
  });
});

describe("QA-R3-06: the preview is bound to the source's handover", () => {
  const OTHER_H = "22222222-2222-4222-8222-222222222222";
  const bytes = new TextEncoder().encode("14/02/2024, 10:00 - Asha Rao: synthetic chat");
  const target = async (path: string, handoverId: string) => {
    const m = await measureBytes(bytes);
    return { data: { raw_storage_path: path, size_bytes: m.sizeBytes, sha256: m.sha256, handover_id: handoverId, kind: "whatsapp_export",
                     timezone: "Asia/Kolkata", date_order: null, original_filename: "chat.txt" } };
  };
  it("a path under the source's own handover is read", async () => {
    const { db } = fakeDb({ source_preview_target: await target(rawSourcePath(H, S), H) });
    const out = await loadRawSourceForPreview(db, fakeStorage({ objects: { [rawSourcePath(H, S)]: bytes } }).storage, actor, S);
    assert.equal(out.handoverId, H);
    assert.deepEqual(out.bytes, bytes);
  });
  it("the same source id under another handover's folder is refused before any download", async () => {
    const { db } = fakeDb({ source_preview_target: await target(rawSourcePath(OTHER_H, S), H) });
    const { storage, ops } = fakeStorage({ objects: { [rawSourcePath(OTHER_H, S)]: bytes } });
    await assert.rejects(loadRawSourceForPreview(db, storage, actor, S), isCode("internal"));
    assert.deepEqual(ops, []);
  });
});

describe("DB-12: the parse job's integrity failure goes through the fenced writer", () => {
  const JOB = "33333333-3333-4333-8333-333333333333";
  const good = new TextEncoder().encode("14/02/2024, 10:00 - Asha Rao: synthetic chat");
  const tampered = new TextEncoder().encode("14/02/2024, 10:00 - Asha Rao: synthetic chaT");
  const row = async () => {
    const m = await measureBytes(good);
    return { data: { raw_storage_path: rawSourcePath(H, S), size_bytes: m.sizeBytes, sha256: m.sha256, kind: "whatsapp_export",
                     timezone: "Asia/Kolkata", date_order: null, original_filename: "chat.txt", state: "uploaded" } };
  };
  const storageWith = (b: Uint8Array) => fakeStorage({ objects: { [rawSourcePath(H, S)]: b } }).storage;

  it("with a claim: pipeline_mark_source_parse_failed(job, attempt), never the unfenced writer", async () => {
    const { db, calls, fns } = fakeDb({ raw_source_for_processing: await row() });
    await assert.rejects(downloadVerifiedRawSourceWithMeta(db, storageWith(tampered), S, { jobId: JOB, attempt: 2 }), isCode("validation_failed"));
    assert.deepEqual(fns(), ["raw_source_for_processing", "pipeline_mark_source_parse_failed"]);
    assert.deepEqual(calls[1].args, { p_job_id: JOB, p_attempt: 2, p_error_code: "integrity_mismatch" });
  });

  it("with a claim that was lost: ClaimLostError, and the source is not failed by this worker", async () => {
    const { db } = fakeDb({
      raw_source_for_processing: await row(),
      pipeline_mark_source_parse_failed: { error: { code: "BTLL0", message: "claim lost" } },
    });
    await assert.rejects(downloadVerifiedRawSource(db, storageWith(tampered), S, { jobId: JOB, attempt: 1 }), (e: unknown) => e instanceof ClaimLostError);
  });

  it("verified bytes never write anything", async () => {
    const { db, fns } = fakeDb({ raw_source_for_processing: await row() });
    assert.deepEqual(await downloadVerifiedRawSource(db, storageWith(good), S, { jobId: JOB, attempt: 1 }), good);
    assert.deepEqual(fns(), ["raw_source_for_processing"]);
  });

  it("the unfenced writer is never called (it is no longer granted, 20261113300600)", async () => {
    const { db, fns } = fakeDb({ raw_source_for_processing: await row() });
    await assert.rejects(downloadVerifiedRawSourceWithMeta(db, storageWith(tampered), S, { jobId: JOB, attempt: 3 }), isCode("validation_failed"));
    assert.ok(!fns().includes("mark_source_parse_failed"));
  });
});

describe("Request #4: confirm refuses bytes that are not the declared kind", () => {
  const pdf = buildPdf([{ paragraphs: [["Synthetic report"]] }], { compress: true });
  const zip = buildZip([{ name: "_chat.txt", data: "14/02/2024, 10:00 - Asha Rao: hi\n" }]);
  const docx = buildDocx([{ text: "Synthetic paragraph" }]);
  const chat = bytesOf("14/02/2024, 10:00 - Asha Rao: synthetic chat\n");
  const md = bytesOf("# Notes\n\nSynthetic.\n");
  const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  const utf16 = new Uint8Array([0xff, 0xfe, 0x31, 0x00, 0x34, 0x00]);
  const textPdf = bytesOf("%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF\n");

  it("bytesMatchKind: the expected pairs", () => {
    const yes: Array<[Uint8Array, Parameters<typeof bytesMatchKind>[1]]> = [
      [pdf, "pdf"], [textPdf, "pdf"], [docx, "docx"], [cfb, "docx"], [zip, "whatsapp_export"], [chat, "whatsapp_export"],
      [utf16, "whatsapp_export"], [md, "markdown"], [chat, "markdown"], [md, "text"], [bytesOf("\uFEFF# BOM notes\n"), "markdown"],
      [bytesOf("Notes mention %PDF- later on.\n"), "markdown"],
    ];
    for (const [b, k] of yes) assert.ok(bytesMatchKind(b, k), `${k} should accept`);
    const no: Array<[Uint8Array, Parameters<typeof bytesMatchKind>[1]]> = [
      [zip, "pdf"], [chat, "pdf"], [pdf, "docx"], [chat, "docx"], [pdf, "whatsapp_export"], [textPdf, "whatsapp_export"],
      [cfb, "whatsapp_export"], [zip, "markdown"], [docx, "markdown"], [pdf, "markdown"], [textPdf, "text"], [cfb, "text"],
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), "markdown"],
    ];
    for (const [b, k] of no) assert.ok(!bytesMatchKind(b, k), `${k} should refuse`);
  });

  it("every file of the multi-format QA set (including its failure cases) passes for its own kind", () => {
    for (const f of MULTIFORMAT_SET) assert.ok(bytesMatchKind(f.bytes(), f.kind), f.file);
  });

  const path = rawSourcePath(H, S);
  const targetFor = async (b: Uint8Array, kind?: string) => {
    const m = await measureBytes(b);
    return { data: { raw_storage_path: path, size_bytes: m.sizeBytes, sha256: m.sha256, ...(kind ? { kind } : {}) } };
  };

  it("a ZIP renamed to .pdf is removed and refused before the database confirms it", async () => {
    const { db, fns } = fakeDb({ source_upload_target: await targetFor(zip, "pdf") });
    const { storage, ops } = fakeStorage({ objects: { [path]: zip } });
    await assert.rejects(confirmSourceUpload(db, storage, actor, S), isCode("validation_failed"));
    assert.deepEqual(fns(), ["source_upload_target"]);
    assert.deepEqual(ops.at(-1), { op: "remove", path: [path] });
  });

  it("a PDF chosen as a chat export is refused the same way", async () => {
    const { db, fns } = fakeDb({ source_upload_target: await targetFor(pdf, "whatsapp_export") });
    await assert.rejects(confirmSourceUpload(db, fakeStorage({ objects: { [path]: pdf } }).storage, actor, S), isCode("validation_failed"));
    assert.deepEqual(fns(), ["source_upload_target"]);
  });

  it("matching bytes confirm normally", async () => {
    const { db, fns } = fakeDb({ source_upload_target: await targetFor(pdf, "pdf") });
    await confirmSourceUpload(db, fakeStorage({ objects: { [path]: pdf } }).storage, actor, S);
    assert.deepEqual(fns(), ["source_upload_target", "confirm_source_uploaded"]);
  });

  it("a database without the kind field (before 20261113200400) skips the check", async () => {
    const { db, fns } = fakeDb({ source_upload_target: await targetFor(zip) });
    await confirmSourceUpload(db, fakeStorage({ objects: { [path]: zip } }).storage, actor, S);
    assert.deepEqual(fns(), ["source_upload_target", "confirm_source_uploaded"]);
  });
});
