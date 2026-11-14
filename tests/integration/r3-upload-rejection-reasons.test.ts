// QA-R3-16 end to end at the action level (Agent 3 ede850a + lead lib/db/errors.ts passthrough, Agent 1 wizard
// mapping): the REAL confirmSourceUploaded Server Function, over Recording* backends, returns
// `validation_failed` with `details.reason` set to exactly one of kind_mismatch / integrity_mismatch / too_large
// for the three causes, deletes the stored object in each case, and keeps the fixed safe message. Every other
// failure carries no `reason` at all, and no detail value is anything but a short snake_case token.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Result } from "../../lib/contracts/api";
import * as sources from "../../lib/actions/sources";
import { MAX_SOURCE_BYTES } from "../../lib/contracts/schemas";
import { SOURCE_BUCKET, rawSourcePath, type StorageBucketApi } from "../../lib/db/storage";
import { actionWorld, type ActionWorld } from "./support/actions";
import { RpcFailure } from "./support/recording-db";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const DOCX_LIKE = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0]); // a ZIP: not a PDF

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Buffer.from(digest).toString("hex");
}

/** A pending PDF source whose upload target is the given bytes; confirm_source_uploaded behaves like the DB (BTVF0 on mismatch). */
async function world(stored: Uint8Array, declared: Uint8Array = stored): Promise<ActionWorld & { path: string }> {
  const w = actionWorld();
  const path = rawSourcePath(w.ids.handover, w.ids.source);
  w.adminStorage.put(SOURCE_BUCKET, path, stored);
  const declaredSha = await sha256Hex(declared);
  w.adminDb.returns("source_upload_target", { raw_storage_path: path, size_bytes: declared.byteLength, sha256: declaredSha, kind: "pdf" });
  w.adminDb.on("confirm_source_uploaded", (args) => {
    if (args.p_measured_size !== declared.byteLength || args.p_measured_sha256_hex !== declaredSha) {
      throw new RpcFailure("BTVF0", "the uploaded file does not match what was declared");
    }
    return { state: "uploaded" };
  });
  return { ...w, path };
}

const confirm = (w: ActionWorld) => sources.confirmSourceUploaded({ sourceId: w.ids.source });

function rejection(r: Result<unknown>) {
  assert.equal(r.ok, false, "expected a failure");
  if (r.ok) throw new Error("unreachable");
  for (const [k, v] of Object.entries(r.error.details ?? {})) {
    assert.ok(typeof v === "string" ? /^[a-z_]{1,64}$/.test(v) || k === "requestId" : true, `detail ${k}=${String(v)} is not a structural token`);
  }
  return r.error;
}

describe("QA-R3-16: confirmSourceUploaded tells the three upload rejections apart", () => {
  it("kind_mismatch: the stored bytes are not the declared kind (a renamed file); object deleted", async () => {
    const w = await world(DOCX_LIKE);
    const e = rejection(await confirm(w));
    assert.equal(e.code, "validation_failed");
    assert.deepEqual(e.details, { reason: "kind_mismatch" });
    assert.equal(w.adminStorage.has(SOURCE_BUCKET, w.path), false, "the wrong file is removed");
    assert.equal(w.adminDb.calls.some((c) => c.fn === "confirm_source_uploaded"), false, "refused before the database compare");
  });

  it("integrity_mismatch: size/SHA-256 differ from the declaration (BTVF0); object deleted", async () => {
    const changed = new Uint8Array([...PDF, 0x0a]); // a valid PDF, but not the bytes that were hashed
    const w = await world(changed, PDF);
    const e = rejection(await confirm(w));
    assert.equal(e.code, "validation_failed");
    assert.deepEqual(e.details, { reason: "integrity_mismatch" });
    assert.equal(w.adminStorage.has(SOURCE_BUCKET, w.path), false);
  });

  it("too_large: the stored object is over the limit; object deleted, bytes never read", async () => {
    const w = await world(PDF);
    // A Blob-like over the limit without allocating 25 MB (host memory): only `size` is consulted first.
    let read = false;
    const real = w.adminStorage.from.bind(w.adminStorage);
    w.adminStorage.from = (bucket: string): StorageBucketApi => ({
      ...real(bucket),
      download: async () => ({
        data: { size: MAX_SOURCE_BYTES + 1, arrayBuffer: async () => ((read = true), new ArrayBuffer(0)) } as unknown as Blob,
        error: null,
      }),
    });
    const e = rejection(await confirm(w));
    assert.equal(e.code, "validation_failed");
    assert.deepEqual(e.details, { reason: "too_large" });
    assert.equal(read, false, "an oversized object is never read into memory");
    assert.ok(w.adminStorage.removed().includes(w.path), "the oversized object is removed");
  });

  it("the message is the same fixed safe text for all three (no cause, size or file name in it)", async () => {
    const messages = new Set<string>();
    // One world at a time: actionWorld() replaces the platform backends.
    for (const make of [() => world(DOCX_LIKE), () => world(new Uint8Array([...PDF, 0x0a]), PDF)]) messages.add(rejection(await confirm(await make())).message);
    assert.equal(messages.size, 1, JSON.stringify([...messages]));
    assert.doesNotMatch([...messages][0], /kind|integrity|sha|size|pdf|mismatch/i);
  });

  it("control: a matching upload confirms (no rejection)", async () => {
    const w = await world(PDF);
    w.userDb.on("get_source_summary", () => null); // the summary read after confirm is not under test here
    const r = await confirm(w);
    assert.ok(w.adminDb.calls.some((c) => c.fn === "confirm_source_uploaded"), "the database compare ran");
    if (!r.ok) assert.equal((r.error.details as { reason?: string } | undefined)?.reason, undefined, `unexpected reason on ${r.error.code}`);
  });

  describe("every other failure carries no reason", () => {
    const cases: Array<[string, (w: ActionWorld & { path: string }) => void, string]> = [
      ["object not uploaded yet", (w) => void w.adminStorage.objects.clear(), "precondition_failed"],
      ["source not found", (w) => void w.adminDb.fails("source_upload_target", "BTNF0"), "not_found"],
      ["not the actor's source", (w) => void w.adminDb.fails("source_upload_target", "BTFB0"), "forbidden"],
      ["database refuses the state", (w) => void w.adminDb.fails("confirm_source_uploaded", "BTIT0"), "invalid_transition"],
    ];
    for (const [label, arrange, code] of cases) {
      it(`${label} → ${code}, no details.reason`, async () => {
        const w = await world(PDF);
        arrange(w);
        if (code === "invalid_transition") w.adminDb.returns("raw_source_for_processing", { state: "pending_upload" });
        const e = rejection(await confirm(w));
        assert.equal(e.code, code);
        assert.equal((e.details as { reason?: string } | undefined)?.reason, undefined);
      });
    }

    it("invalid input → validation_failed with no reason and no backend call", async () => {
      const w = actionWorld();
      const e = rejection(await sources.confirmSourceUploaded({ sourceId: "not-a-uuid" }));
      assert.equal(e.code, "validation_failed");
      assert.equal((e.details as { reason?: string } | undefined)?.reason, undefined);
      assert.equal(w.adminDb.calls.length + w.userDb.calls.length, 0);
    });

    it("a smuggled reason in the input is ignored", async () => {
      const w = await world(PDF);
      w.adminDb.fails("source_upload_target", "BTNF0");
      const e = rejection(await sources.confirmSourceUploaded({ sourceId: w.ids.source, reason: "kind_mismatch" } as never));
      assert.notEqual((e.details as { reason?: string } | undefined)?.reason, "kind_mismatch");
    });
  });
});
