import "server-only";

/**
 * The real SourceWriter (Round 4 contract §5): writes a connector transcript into the EXISTING source pipeline.
 *
 *   1. actor   getConnectorFlushActor(link) — the creator who consented to capture, re-checked by the database
 *              (link live, installation active, still the handover's creator);
 *   2. row     create_source (first flush) or create_source_version (later flushes) with kind `chat_import`;
 *   3. bytes   uploaded by the server to raw/{handover}/{source} with the service-role storage client;
 *   4. confirm confirmSourceUpload: size, SHA-256 and kind re-measured, exactly as for a browser upload.
 *
 * Consent for processing is NOT recorded here: the creator gives it in Baton like for any upload.
 */

import { getConnectorFlushActor } from "../db/actor";
import type { DbClient } from "../db/client";
import { DbError, isDbError } from "../db/errors";
import { createSource, createSourceVersion, removeSource } from "../db/mutations";
import { callRpc } from "../db/rpc";
import { confirmSourceUpload, measureBytes, rawSourcePath, SOURCE_BUCKET, type StorageClient } from "../db/storage";
import { createInputMasker } from "../actions/core/mask";
import type { FlushRefusal, SourceWriteInput, SourceWriter } from "./flush";

const MIME = "application/x-ndjson";

function refusalFor(error: unknown): FlushRefusal {
  if (!isDbError(error)) return "internal";
  switch (error.code) {
    case "invalid_transition":
      return "handover_not_accepting_updates";
    case "forbidden":
      return "creator_changed";
    case "precondition_failed":
      return "source_limit";
    case "not_found":
      return "source_removed";
    case "conflict":
      return "update_in_progress";
    default:
      return "internal";
  }
}

export function createSourceWriter(deps: { db: () => DbClient; storage: () => StorageClient }): SourceWriter {
  return {
    async write(input: SourceWriteInput) {
      const db = deps.db();
      const storage = deps.storage();
      const actor = await getConnectorFlushActor(db, input.linkId);
      if (!actor) return { ok: false, refusal: "creator_changed" };
      const { sizeBytes, sha256 } = await measureBytes(input.bytes);
      const fileName = createInputMasker().text(input.fileName);
      const request = { kind: "chat_import" as const, fileName, mimeType: MIME, sizeBytes, sha256 };

      let sourceId: string;
      let handoverId = input.handoverId;
      try {
        if (input.previousSourceId === null) {
          sourceId = await createSource(db, actor, { ...request, handoverId });
        } else {
          const r = await createSourceVersion(db, actor, { ...request, previousSourceId: input.previousSourceId });
          handoverId = r.handoverId;
          switch (r.outcome) {
            case "created":
            case "resumed":
              if (!r.sourceId) return { ok: false, refusal: "internal" };
              sourceId = r.sourceId;
              break;
            case "awaiting_confirmation":
              if (!r.sourceId) return { ok: false, refusal: "internal" };
              sourceId = r.sourceId; // a previous flush uploaded but did not confirm: confirm below re-measures
              break;
            case "awaiting_consent":
              return { ok: false, refusal: "awaiting_consent" };
            case "unchanged":
              return { ok: false, refusal: "unchanged" };
            case "stale":
            case "update_in_progress":
              return { ok: false, refusal: "update_in_progress" };
            default:
              return { ok: false, refusal: "source_removed" };
          }
        }
      } catch (error) {
        return { ok: false, refusal: refusalFor(error) };
      }

      const path = rawSourcePath(handoverId, sourceId);
      const bucket = storage.from(SOURCE_BUCKET);
      if (!bucket.upload) throw new DbError("internal"); // the service-role client always has upload
      const { error } = await bucket.upload(path, input.bytes, { contentType: MIME, upsert: true });
      if (error) {
        // nothing was confirmed: discard a NEW row so it does not block the next flush (a version row is resumed)
        if (input.previousSourceId === null) {
          await removeSource(db, actor, sourceId).catch(() => {});
          await callRpc(db, "mark_source_raw_deleted", { p_source_id: sourceId }).catch(() => {});
        }
        return { ok: false, refusal: "internal" };
      }
      try {
        await confirmSourceUpload(db, storage, actor, sourceId);
      } catch (e) {
        return { ok: false, refusal: refusalFor(e) };
      }
      return { ok: true, sourceId };
    },
  };
}
