// removeHandoverRawPrefix (account deletion, §12.9): empties raw/{handover}/ and nothing else.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DbError } from "../errors";
import { removeHandoverRawPrefix, type StorageClient } from "../storage";

const H = "11111111-1111-4111-8111-111111111111";

function fake(entries: Array<{ name?: unknown; id?: unknown }>, opts: { listError?: boolean; removeError?: boolean; sticky?: boolean; noList?: boolean } = {}) {
  let current = [...entries];
  const ops: string[] = [];
  const client: StorageClient = {
    from: (bucket) => ({
      createSignedUploadUrl: async () => ({ data: null, error: { message: "unused" } }),
      download: async () => ({ data: null, error: { message: "unused" } }),
      remove: async (paths) => {
        ops.push(`remove ${bucket} ${paths.join(",")}`);
        if (opts.removeError) return { data: null, error: { message: "down" } };
        if (!opts.sticky) current = current.filter((e) => !paths.includes(`raw/${H}/${String(e.name)}`));
        return { data: paths, error: null };
      },
      ...(opts.noList
        ? {}
        : {
            list: async (prefix: string) => {
              ops.push(`list ${bucket} ${prefix}`);
              return opts.listError ? { data: null, error: { message: "down" } } : { data: current, error: null };
            },
          }),
    }),
  };
  return { client, ops };
}

const isDb = (code: string) => (e: unknown) => e instanceof DbError && e.code === code;

describe("removeHandoverRawPrefix", () => {
  it("removes every plain object directly under raw/{handover}/ in the source bucket", async () => {
    const f = fake([{ name: "a", id: "1" }, { name: "b", id: "2" }]);
    assert.deepEqual(await removeHandoverRawPrefix(f.client, H.toUpperCase()), { removed: 2 });
    assert.deepEqual(f.ops, [`list source-uploads raw/${H}`, `remove source-uploads raw/${H}/a,raw/${H}/b`, `list source-uploads raw/${H}`]);
  });

  it("skips sub-folders (id null) and names that are not plain object names", async () => {
    const f = fake([{ name: "nested", id: null }, { name: "../escape", id: "x" }, { name: "", id: "y" }, { name: 7, id: "z" }]);
    assert.deepEqual(await removeHandoverRawPrefix(f.client, H), { removed: 0 });
    assert.ok(!f.ops.some((o) => o.startsWith("remove")));
  });

  it("refuses anything but a handover UUID", async () => {
    for (const bad of ["", "raw", "../x", `${H}/..`, "*"]) {
      await assert.rejects(removeHandoverRawPrefix(fake([]).client, bad), isDb("validation_failed"), bad);
    }
  });

  it("list or remove failures, a missing list API and a runaway loop are internal errors", async () => {
    await assert.rejects(removeHandoverRawPrefix(fake([], { listError: true }).client, H), isDb("internal"));
    await assert.rejects(removeHandoverRawPrefix(fake([{ name: "a", id: "1" }], { removeError: true }).client, H), isDb("internal"));
    await assert.rejects(removeHandoverRawPrefix(fake([], { noList: true }).client, H), isDb("internal"));
    await assert.rejects(removeHandoverRawPrefix(fake([{ name: "a", id: "1" }], { sticky: true }).client, H), isDb("internal"));
  });
});
