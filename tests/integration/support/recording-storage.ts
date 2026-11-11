/**
 * RecordingStorage: a StorageClient (lib/db/storage.ts) backed by an in-memory object map. Records every
 * operation (also into a shared `events` list, so ordering against RecordingDb can be asserted) and can be
 * told to fail an operation. Replaces only the network boundary to Supabase Storage.
 */

import type { StorageBucketApi, StorageClient } from "../../../lib/db/storage";

type Op = "createSignedUploadUrl" | "download" | "remove";

export class RecordingStorage implements StorageClient {
  readonly objects = new Map<string, Uint8Array>();
  readonly ops: Array<{ op: Op; bucket: string; paths: string[] }> = [];
  private readonly failing = new Set<Op>();
  readonly events: string[];

  constructor(events: string[] = []) {
    this.events = events;
  }

  put(bucket: string, path: string, bytes: Uint8Array): this {
    this.objects.set(`${bucket}/${path}`, bytes);
    return this;
  }

  has(bucket: string, path: string): boolean {
    return this.objects.has(`${bucket}/${path}`);
  }

  failOn(op: Op): this {
    this.failing.add(op);
    return this;
  }

  removed(): string[] {
    return this.ops.filter((o) => o.op === "remove").flatMap((o) => o.paths);
  }

  from(bucket: string): StorageBucketApi {
    const log = (op: Op, paths: string[]) => {
      this.ops.push({ op, bucket, paths });
      this.events.push(`storage:${op}:${paths.join(",")}`);
    };
    const error = (op: Op) => (this.failing.has(op) ? { message: `synthetic ${op} failure` } : null);
    return {
      createSignedUploadUrl: async (path: string) => {
        log("createSignedUploadUrl", [path]);
        if (error("createSignedUploadUrl")) return { data: null, error: error("createSignedUploadUrl") };
        return { data: { signedUrl: `https://storage.example.test/upload/${path}?token=it`, token: "it-upload-token", path }, error: null };
      },
      download: async (path: string) => {
        log("download", [path]);
        const bytes = this.objects.get(`${bucket}/${path}`);
        if (error("download") || !bytes) return { data: null, error: { message: "object not found" } };
        return { data: new Blob([bytes as unknown as ArrayBuffer]), error: null };
      },
      remove: async (paths: string[]) => {
        log("remove", paths);
        if (error("remove")) return { data: null, error: error("remove") };
        for (const p of paths) this.objects.delete(`${bucket}/${p}`);
        return { data: paths, error: null };
      },
    };
  }
}
