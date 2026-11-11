/**
 * Raw-upload storage helpers (§11.2 Storage, §10.3, D14). Private bucket `source-uploads`, path
 * raw/{handover_id}/{source_id}. Structural types keep this independent of @supabase/storage-js.
 *
 * Security fix M5: the client's declared size and SHA-256 are never trusted. The server downloads the
 * object, measures it, and the database compares the measurement with the declared values and with the
 * size Storage recorded. The parse job re-verifies the bytes before using them.
 */

import type { SourceUploadTicket } from "../contracts/dto";
import type { DateOrder, SourceKind } from "../contracts/enums";
import type { VerifiedActor } from "./actor-rules";
import type { DbClient } from "./client";
import { DbError } from "./errors";
import { createSource } from "./mutations";
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
 */
const SIGNED_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Size and SHA-256 of bytes the server actually holds. */
export async function measureBytes(bytes: Uint8Array): Promise<{ sizeBytes: number; sha256: string }> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return { sizeBytes: bytes.byteLength, sha256: toHex(new Uint8Array(digest)) };
}

async function download(storage: StorageClient, path: string): Promise<Uint8Array> {
  const { data, error } = await storage.from(SOURCE_BUCKET).download(path);
  if (error || !data) throw new DbError("not_found");
  if (data.size > MAX_SOURCE_BYTES) throw new DbError("validation_failed");
  return new Uint8Array(await data.arrayBuffer());
}

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
  input: Parameters<typeof createSource>[2],
): Promise<SourceUploadTicket> {
  const sourceId = await createSource(db, actor, input);
  const path = `raw/${input.handoverId}/${sourceId}`;
  const { data, error } = await userStorage.from(SOURCE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new DbError("internal");
  return {
    sourceId,
    signedUploadUrl: data.signedUrl,
    token: data.token,
    expiresAt: new Date(Date.now() + SIGNED_UPLOAD_TTL_MS).toISOString(),
  };
}

/**
 * confirmSourceUploaded (M5). Downloads the object with the service role, measures it, and lets the
 * database compare. On a mismatch the object is deleted, so the user can upload the right file again,
 * and the error (validation_failed) is rethrown.
 */
export async function confirmSourceUpload(
  db: DbClient,
  adminStorage: StorageClient,
  actor: VerifiedActor,
  sourceId: string,
): Promise<void> {
  const target = (await callRpc(db, "source_upload_target", {
    p_actor_profile_id: actor.profileId,
    p_source_id: sourceId,
  })) as { raw_storage_path: string; size_bytes: number; sha256: string };

  let measured: { sizeBytes: number; sha256: string };
  try {
    measured = await measureBytes(await download(adminStorage, target.raw_storage_path));
  } catch (error) {
    if (error instanceof DbError && error.code === "not_found") throw new DbError("precondition_failed"); // not uploaded yet
    throw error;
  }

  try {
    await callRpc(db, "confirm_source_uploaded", {
      p_actor_profile_id: actor.profileId,
      p_source_id: sourceId,
      p_measured_size: measured.sizeBytes,
      p_measured_sha256_hex: measured.sha256,
    });
  } catch (error) {
    if (error instanceof DbError && error.code === "validation_failed") {
      await adminStorage.from(SOURCE_BUCKET).remove([target.raw_storage_path]);
    }
    throw error;
  }
}

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
  const bytes = await download(adminStorage, source.raw_storage_path);
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
    bytes = await download(adminStorage, target.raw_storage_path);
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

/**
 * §10.3 step 4: only AFTER the parse transaction committed (or after removeSource). If the storage delete
 * fails, raw_storage_path stays set and the retention sweep retries it.
 */
/**
 * The parse job's raw delete (§10.3 step 4, D14, QA-L1). Reads path and state from the database instead of
 * trusting the caller, and refuses unless the source is `parsed`, so an ordering bug can never delete the
 * raw upload of an uploaded or failed source that still needs it for a retry.
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

export async function deleteRawSource(db: DbClient, adminStorage: StorageClient, sourceId: string, path: string): Promise<void> {
  const { error } = await adminStorage.from(SOURCE_BUCKET).remove([path]);
  if (error) throw new DbError("internal");
  await callRpc(db, "mark_source_raw_deleted", { p_source_id: sourceId });
}
