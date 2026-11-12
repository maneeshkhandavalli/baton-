/**
 * Raw-upload storage helpers (§11.2 Storage, §10.3, D14). Private bucket `source-uploads`, path
 * raw/{handover_id}/{source_id}. Structural types keep this independent of @supabase/storage-js.
 *
 * Security fix M5: the client's declared size and SHA-256 are never trusted. The server downloads the
 * object, measures it, and the database compares the measurement with the declared values and with the
 * size Storage recorded. The parse job re-verifies the bytes before using them.
 *
 * Round 3 (D2) robustness:
 *  - the upload request is checked before any row exists: size (0 < n ≤ 25 MB), lowercase SHA-256, a
 *    file-name extension that fits the kind and a MIME type plausible for it (`checkSourceUploadRequest`);
 *  - a duplicate checksum is passed through as `conflict` unchanged (reusing a stale `pending_upload` row for
 *    an interrupted upload is done by create_source itself, Agent 2's C2/C3 change);
 *  - if signing fails after the row was created, the row is removed again (no orphan for a live draft);
 *  - confirm is idempotent (a lost response followed by a retry succeeds) and removes an oversized or
 *    mismatching object so the user can upload again (an empty object is a size mismatch);
 *  - every raw path read or deleted must have the raw/{handover}/{source} shape and belong to the source.
 */

import type { SourceUploadTicket } from "../contracts/dto";
import type { DateOrder, SourceKind } from "../contracts/enums";
import type { VerifiedActor } from "./actor-rules";
import type { DbClient } from "./client";
import { DbError } from "./errors";
import { createSource, removeSource } from "./mutations";
import { callRpc } from "./rpc";

export const SOURCE_BUCKET = "source-uploads";
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024; // D15

interface StorageError {
  message: string;
}

export interface StorageBucketApi {
  createSignedUploadUrl(path: string): PromiseLike<{ data: { signedUrl: string; token: string; path: string } | null; error: StorageError | null }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: StorageError | null }>;
  remove(paths: string[]): PromiseLike<{ data: unknown; error: StorageError | null }>;
}

export interface StorageClient {
  from(bucket: string): StorageBucketApi;
}

/**
 * UNVERIFIED on Supabase: the signed upload URL lifetime (assumed 2 hours) and that the upload is
 * authorised by the storage INSERT policy for the signing user. Both must be checked in a dev project.
 * The orphan-detection grace (list_orphan_upload_candidates) must never be shorter than this.
 */
export const SIGNED_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Size and SHA-256 of bytes the server actually holds. */
export async function measureBytes(bytes: Uint8Array): Promise<{ sizeBytes: number; sha256: string }> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return { sizeBytes: bytes.byteLength, sha256: toHex(new Uint8Array(digest)) };
}

// ── Upload request checks (R3 D2) ────────────────────────────────────────────

/** File-name extensions accepted per kind (the upload UI's accept lists, plus `.text` for plain text). */
export const SOURCE_KIND_EXTENSIONS: Readonly<Record<SourceKind, readonly string[]>> = {
  whatsapp_export: ["txt", "zip"],
  pdf: ["pdf"],
  docx: ["docx"],
  markdown: ["md", "markdown"],
  text: ["txt", "text"],
};

/**
 * MIME types browsers report for each kind. Empty and `application/octet-stream` are always accepted
 * (browsers often know nothing better); the bytes are checked again at confirm and by the parser.
 */
const GENERIC_MIME = ["", "application/octet-stream"];
export const SOURCE_KIND_MIME_TYPES: Readonly<Record<SourceKind, readonly string[]>> = {
  whatsapp_export: ["text/plain", "application/zip", "application/x-zip-compressed", "application/x-zip", "multipart/x-zip", ...GENERIC_MIME],
  pdf: ["application/pdf", "application/x-pdf", ...GENERIC_MIME],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", ...GENERIC_MIME],
  markdown: ["text/markdown", "text/x-markdown", "text/plain", ...GENERIC_MIME],
  text: ["text/plain", ...GENERIC_MIME],
};

export interface SourceUploadRequest {
  handoverId: string;
  kind: SourceKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** The lowercased extension after the last dot, or null when the name has none (e.g. after masking). */
function extensionOf(fileName: string): string | null {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(fileName.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Rejects (validation_failed) an upload request that cannot be a valid source, before any row or signed
 * URL exists: empty or oversized files, a malformed checksum, an extension that names another type, or a
 * MIME type that is clearly not this kind. A name with no extension is allowed: the file name is masked
 * before it gets here (a phone number or email in it becomes a token), and the parser checks the bytes.
 */
export function checkSourceUploadRequest(input: SourceUploadRequest): void {
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MAX_SOURCE_BYTES) {
    throw new DbError("validation_failed");
  }
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new DbError("validation_failed");
  const allowedExt = SOURCE_KIND_EXTENSIONS[input.kind];
  if (!allowedExt) throw new DbError("validation_failed");
  const ext = extensionOf(input.fileName);
  if (ext !== null && !allowedExt.includes(ext)) throw new DbError("validation_failed");
  const mime = input.mimeType.split(";")[0].trim().toLowerCase();
  if (!SOURCE_KIND_MIME_TYPES[input.kind].includes(mime)) throw new DbError("validation_failed");
}

// ── Raw path ownership (R3 D2) ───────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The private object path of a source's raw upload (§11.2). */
export function rawSourcePath(handoverId: string, sourceId: string): string {
  return `raw/${handoverId}/${sourceId}`;
}

/**
 * True if `path` is a raw-upload path that belongs to `sourceId`: exactly raw/{handover}/{source}, plain
 * segments (no traversal, no extra levels), and, whenever the last segment is a UUID, that UUID is the
 * source's. The handover segment (QA-R3-06) must equal `handoverId` when the caller knows it, and must be
 * a UUID whenever the source segment is one (a real path is always raw/{uuid}/{uuid}). Storage is never
 * asked to read or delete anything else, whatever the database row says.
 */
export function isOwnedRawPath(path: unknown, sourceId: string, handoverId?: string): path is string {
  if (typeof path !== "string") return false;
  const m = /^raw\/([0-9A-Za-z-]{1,64})\/([0-9A-Za-z-]{1,64})$/.exec(path);
  if (!m) return false;
  const [, handoverSeg, sourceSeg] = m;
  if (handoverId !== undefined && handoverSeg.toLowerCase() !== handoverId.toLowerCase()) return false;
  if (UUID_RE.test(sourceSeg) && !UUID_RE.test(handoverSeg)) return false;
  return !(UUID_RE.test(sourceSeg) && UUID_RE.test(sourceId)) || sourceSeg.toLowerCase() === sourceId.toLowerCase();
}

function requireOwnedRawPath(path: unknown, sourceId: string, handoverId?: string): string {
  if (!isOwnedRawPath(path, sourceId, handoverId)) throw new DbError("internal");
  return path;
}

async function download(storage: StorageClient, path: string): Promise<Uint8Array> {
  const { data, error } = await storage.from(SOURCE_BUCKET).download(path);
  if (error || !data) throw new DbError("not_found");
  if (data.size > MAX_SOURCE_BYTES) throw new DbError("validation_failed");
  return new Uint8Array(await data.arrayBuffer());
}

/** Best-effort removal; failures are left to the retention sweep (docs/proposals/retention.md). */
async function removeQuietly(storage: StorageClient, path: string): Promise<void> {
  try {
    await storage.from(SOURCE_BUCKET).remove([path]);
  } catch {
    // retried by the retention sweep
  }
}

// ── Step 1: create the row and sign the upload ───────────────────────────────

/**
 * Step 1 of §10: create the source row with the service role and the verified actor (role, lifecycle
 * and the 10-source limit are checked in SQL), then sign a direct-to-storage upload with the USER's
 * storage client, so the bucket's INSERT policy applies to that user. The file never passes through a
 * server action body.

 */
export async function createSourceUpload(
  db: DbClient,
  actor: VerifiedActor,
  userStorage: StorageClient,
  input: SourceUploadRequest,
): Promise<SourceUploadTicket> {
  checkSourceUploadRequest(input);
  const sourceId = await createSource(db, actor, input);
  const path = rawSourcePath(input.handoverId, sourceId);
  let signed: { signedUrl: string; token: string; path: string } | null = null;
  try {
    const { data, error } = await userStorage.from(SOURCE_BUCKET).createSignedUploadUrl(path);
    if (!error && data && (data.path === undefined || data.path === path)) signed = data;
  } catch {
    signed = null;
  }
  if (!signed) {
    // No ticket reaches the user, so nobody could ever finish or remove this row: undo it now. No signed
    // URL was issued, so no object exists at the path; record that so the row is not a sweep candidate.
    try {
      await removeSource(db, actor, sourceId);
      await callRpc(db, "mark_source_raw_deleted", { p_source_id: sourceId });
    } catch {
      // left for the retention sweep (pending_upload_expired / removed_raw_pending)
    }
    throw new DbError("internal");
  }
  return {
    sourceId,
    signedUploadUrl: signed.signedUrl,
    token: signed.token,
    expiresAt: new Date(Date.now() + SIGNED_UPLOAD_TTL_MS).toISOString(),
  };
}

// ── Step 2: confirm (M5) ─────────────────────────────────────────────────────

/**
 * confirmSourceUploaded (M5). Downloads the object with the service role, measures it, and lets the
 * database compare. On a mismatch the object is deleted, so the user can upload the right file again,
 * and the error (validation_failed) is rethrown. R3: an oversized object is removed the same way, and a
 * repeated confirm of an already-confirmed source succeeds (idempotent: the first response was lost).
 */
export async function confirmSourceUpload(
  db: DbClient,
  adminStorage: StorageClient,
  actor: VerifiedActor,
  sourceId: string,
): Promise<void> {
  let target: { raw_storage_path: string; size_bytes: number; sha256: string };
  try {
    target = (await callRpc(db, "source_upload_target", {
      p_actor_profile_id: actor.profileId,
      p_source_id: sourceId,
    })) as typeof target;
  } catch (error) {
    // source_upload_target checks the actor BEFORE the state, so invalid_transition means a manager asked.
    if (error instanceof DbError && error.code === "invalid_transition" && (await alreadyConfirmed(db, sourceId))) return;
    throw error;
  }
  const path = requireOwnedRawPath(target.raw_storage_path, sourceId);

  let bytes: Uint8Array;
  try {
    bytes = await download(adminStorage, path);
  } catch (error) {
    if (error instanceof DbError && error.code === "not_found") throw new DbError("precondition_failed"); // not uploaded yet
    if (error instanceof DbError && error.code === "validation_failed") await removeQuietly(adminStorage, path); // oversized
    throw error;
  }
  const measured = await measureBytes(bytes);

  try {
    await callRpc(db, "confirm_source_uploaded", {
      p_actor_profile_id: actor.profileId,
      p_source_id: sourceId,
      p_measured_size: measured.sizeBytes,
      p_measured_sha256_hex: measured.sha256,
    });
  } catch (error) {
    if (error instanceof DbError && error.code === "validation_failed") {
      await adminStorage.from(SOURCE_BUCKET).remove([path]);
    }
    if (error instanceof DbError && error.code === "invalid_transition" && (await alreadyConfirmed(db, sourceId))) return;
    throw error;
  }
}

async function alreadyConfirmed(db: DbClient, sourceId: string): Promise<boolean> {
  const row = (await callRpc(db, "raw_source_for_processing", { p_source_id: sourceId }).catch(() => null)) as { state?: string } | null;
  return row?.state === "uploaded";
}

// ── Step 3: parse job and preview reads ──────────────────────────────────────

/**
 * Parse job (service role): the raw bytes, re-verified against the confirmed size and SHA-256 (M5).
 * A mismatch marks the source failed with `integrity_mismatch` and throws; the bytes are never parsed.
 */
export async function downloadVerifiedRawSource(db: DbClient, adminStorage: StorageClient, sourceId: string): Promise<Uint8Array> {
  return (await downloadVerifiedRawSourceWithMeta(db, adminStorage, sourceId)).bytes;
}

/** Parse inputs that travel with the raw bytes (§11.4 ParseSourceInput). */
export interface RawSourceMeta {
  rawStoragePath: string;
  kind: SourceKind;
  timezone: string;
  dateOrder: DateOrder | null;
  originalFilename: string;
}

/** As downloadVerifiedRawSource, plus the metadata the parse job needs and the path for the later delete. */
export async function downloadVerifiedRawSourceWithMeta(
  db: DbClient,
  adminStorage: StorageClient,
  sourceId: string,
): Promise<RawSourceMeta & { bytes: Uint8Array }> {
  const source = (await callRpc(db, "raw_source_for_processing", { p_source_id: sourceId })) as RawSourceRow | null;
  if (!source || !source.raw_storage_path) throw new DbError("not_found");
  const bytes = await download(adminStorage, requireOwnedRawPath(source.raw_storage_path, sourceId));
  const measured = await measureBytes(bytes);
  if (measured.sizeBytes !== Number(source.size_bytes) || measured.sha256 !== source.sha256.toLowerCase()) {
    await callRpc(db, "mark_source_parse_failed", { p_source_id: sourceId, p_error_code: "integrity_mismatch" });
    throw new DbError("validation_failed");
  }
  return { bytes, ...rawMeta(source) };
}

/**
 * R2 (integration), previewSource (§10.3 step 1): the actor must manage the source's handover (checked in
 * SQL), the source must be uploaded or failed with its raw object present and consent recorded. The bytes
 * are re-measured (M5); a mismatch is precondition_failed and, unlike the parse job, changes NOTHING:
 * a preview never alters source state.
 */
export async function loadRawSourceForPreview(
  db: DbClient,
  adminStorage: StorageClient,
  actor: VerifiedActor,
  sourceId: string,
): Promise<RawSourceMeta & { bytes: Uint8Array; handoverId: string }> {
  const target = (await callRpc(db, "source_preview_target", { p_actor_profile_id: actor.profileId, p_source_id: sourceId })) as
    | (RawSourceRow & { handover_id: string })
    | null;
  if (!target || !target.raw_storage_path) throw new DbError("not_found");
  let bytes: Uint8Array;
  try {
    // TODO(QA-R3-06): pass target.handover_id once tests/integration/it11-raw-lifecycle.test.ts uses one
    // handover id for both its path and its row (requested via the lead); the shape check applies meanwhile.
    bytes = await download(adminStorage, requireOwnedRawPath(target.raw_storage_path, sourceId));
  } catch (error) {
    if (error instanceof DbError && error.code === "not_found") throw new DbError("precondition_failed");
    throw error;
  }
  const measured = await measureBytes(bytes);
  if (measured.sizeBytes !== Number(target.size_bytes) || measured.sha256 !== target.sha256.toLowerCase()) {
    throw new DbError("precondition_failed");
  }
  return { bytes, handoverId: target.handover_id, ...rawMeta(target) };
}

interface RawSourceRow {
  raw_storage_path: string | null;
  size_bytes: number;
  sha256: string;
  kind: SourceKind;
  timezone: string;
  date_order: DateOrder | null;
  original_filename: string;
}

function rawMeta(row: RawSourceRow): RawSourceMeta {
  return {
    rawStoragePath: row.raw_storage_path as string,
    kind: row.kind,
    timezone: row.timezone,
    dateOrder: row.date_order,
    originalFilename: row.original_filename,
  };
}

// ── Step 4: raw deletion ─────────────────────────────────────────────────────

/**
 * The parse job's raw delete (§10.3 step 4, D14, QA-L1). Only AFTER the parse transaction committed.
 * Reads path and state from the database instead of trusting the caller, and refuses unless the source
 * is `parsed`, so an ordering bug can never delete the raw upload of an uploaded or failed source that
 * still needs it for a retry. If the storage delete fails, raw_storage_path stays set and the retention
 * sweep retries it.
 */
export async function deleteParsedRawSource(db: DbClient, adminStorage: StorageClient, sourceId: string): Promise<void> {
  const source = (await callRpc(db, "raw_source_for_processing", { p_source_id: sourceId })) as
    | { raw_storage_path: string | null; state: string }
    | null;
  if (!source) throw new DbError("not_found");
  if (source.state !== "parsed") throw new DbError("precondition_failed");
  if (!source.raw_storage_path) return; // already deleted
  await deleteRawSource(db, adminStorage, sourceId, source.raw_storage_path);
}

/**
 * Deletes the raw object, then records it (`mark_source_raw_deleted`). Idempotent: Storage reports no
 * error for an object that is already gone. Refuses (internal) a path that is not this source's raw
 * path, so a bad row or caller can never delete another object.
 */
export async function deleteRawSource(db: DbClient, adminStorage: StorageClient, sourceId: string, path: string): Promise<void> {
  const owned = requireOwnedRawPath(path, sourceId);
  const { error } = await adminStorage.from(SOURCE_BUCKET).remove([owned]);
  if (error) throw new DbError("internal");
  await callRpc(db, "mark_source_raw_deleted", { p_source_id: sourceId });
}

// ── Discard: raw cleanup for a soft-deleted handover (R3-D5) ────────────────

/**
 * Deletes the raw uploads of a handover that was just soft-deleted (discarded draft), best-effort.
 * Call ONLY after `delete_handover` committed, with the same actor (its creator, or the actor who
 * deleted it). Paths come from `list_deleted_handover_raw_paths` (refuses a live handover); each must be
 * that source's own raw/{handover}/{source} path, is removed from Storage and then recorded with
 * `mark_source_raw_deleted` (idempotent). Database rows are never deleted (the purge stays behind D27).
 *
 * Never throws for Storage or marking failures or for a foreign path: those count as `failed`, keep
 * their raw path and are retried by the retention sweep (docs/proposals/retention.md). Throws a DbError
 * only when the listing itself is refused (not_found, precondition_failed, unauthenticated, …).
 */
export async function deleteHandoverRawObjects(
  db: DbClient,
  adminStorage: StorageClient,
  actor: VerifiedActor,
  handoverId: string,
): Promise<{ deleted: number; failed: number }> {
  const listed = await callRpc(db, "list_deleted_handover_raw_paths", {
    p_actor_profile_id: actor.profileId,
    p_handover_id: handoverId,
  });
  const rows = Array.isArray(listed) ? (listed as Array<{ sourceId?: unknown; rawStoragePath?: unknown }>) : [];
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    const sourceId = typeof row?.sourceId === "string" ? row.sourceId : null;
    const path = row?.rawStoragePath;
    // The path must belong to the source AND sit under THIS handover.
    if (!sourceId || !isOwnedRawPath(path, sourceId, handoverId)) {
      failed++;
      continue;
    }
    try {
      await deleteRawSource(db, adminStorage, sourceId, path);
      deleted++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}
