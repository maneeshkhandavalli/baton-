// DB-12 / DB-13 (Round 3, Agent 4): the fenced pipeline writers in lib/db/pipeline.ts.
// SQL behaviour is covered by supabase/tests/sql/98_pipeline_fencing.sql; this file pins the wrapper shapes:
// every job-scoped writer sends the claim, BTLL0 becomes ClaimLostError (never a DbError), and nothing in
// lib/pipeline calls an unfenced writer.
//   node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/db/__tests__/pipeline-fencing.test.ts"
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { DbClient } from "../client";
import { DbError } from "../errors";
import {
  ClaimLostError,
  createSystemGapQuestion,
  markSourceParseFailed,
  persistParsedSource,
  recordQuoteCheck,
  recordSupportVerdict,
  setJobProvenance,
  setPointSortKeys,
  storeExtractChunk,
  type JobClaim,
} from "../pipeline";

const CLAIM: JobClaim = { jobId: "9e6f7081-a2b3-4dc5-8e6f-708192a3b4c5", attempt: 2 };
const ID = "b1808293-c4d5-4fe7-8081-92a3b4c5d6e7";

function fakeClient(data: unknown = null, error: { code?: string; message: string } | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client: DbClient = {
    rpc: async (fn, args = {}) => {
      calls.push({ fn, args });
      return { data, error };
    },
  };
  return { client, calls };
}

type Writer = { name: string; fn: string; call: (db: DbClient) => Promise<unknown>; data?: unknown };

const WRITERS: Writer[] = [
  { name: "setJobProvenance", fn: "pipeline_set_job_provenance", call: (db) => setJobProvenance(db, CLAIM, { provider: "fake" }) },
  { name: "persistParsedSource", fn: "pipeline_persist_parsed_source", call: (db) => persistParsedSource(db, CLAIM, {} as never, "p1") },
  { name: "markSourceParseFailed", fn: "pipeline_mark_source_parse_failed", call: (db) => markSourceParseFailed(db, CLAIM, "parse_failed") },
  { name: "recordQuoteCheck", fn: "pipeline_record_quote_check", call: (db) => recordQuoteCheck(db, CLAIM, ID, "exact") },
  {
    name: "recordSupportVerdict",
    fn: "pipeline_record_support_verdict",
    call: (db) =>
      recordSupportVerdict(db, CLAIM, { pointEvidenceId: ID, revisionId: ID, verdict: "supports", rationale: null, provenance: {}, verifiedQuoteText: "q" }),
  },
  {
    name: "createSystemGapQuestion",
    fn: "pipeline_create_system_gap_question",
    call: (db) => createSystemGapQuestion(db, CLAIM, { pointId: null, category: "owner", question: "Who?", context: null, priority: "required", accessLevel: "everyone" }),
  },
  { name: "setPointSortKeys", fn: "pipeline_set_point_sort_keys", call: (db) => setPointSortKeys(db, CLAIM, [{ pointId: ID, sortKey: 1 }]), data: 1 },
  {
    name: "storeExtractChunk",
    fn: "pipeline_store_extract_chunk",
    call: (db) => storeExtractChunk(db, CLAIM, { chunkIndex: 0, chunkTotal: 1, accessLevel: "everyone", aiProvenance: {}, entries: [] }),
    data: { alreadyCommitted: false, entries: [] },
  },
];

describe("DB-12: every job-scoped writer is fenced", () => {
  for (const w of WRITERS) {
    it(`${w.name} sends the claim to ${w.fn}`, async () => {
      const { client, calls } = fakeClient(w.data ?? null);
      await w.call(client);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].fn, w.fn);
      assert.equal(calls[0].args.p_job_id, CLAIM.jobId);
      assert.equal(calls[0].args.p_attempt, CLAIM.attempt);
      for (const key of ["p_handover_id", "p_run_id", "p_source_id"]) {
        assert.ok(!(key in calls[0].args), `${key} comes from the claim in SQL, never from the caller`);
      }
    });

    it(`${w.name}: a stale claim (BTLL0) throws ClaimLostError, which is not a DbError`, async () => {
      const { client } = fakeClient(null, { code: "BTLL0", message: "claim lost" });
      await assert.rejects(w.call(client), (e: unknown) => e instanceof ClaimLostError && !(e instanceof DbError));
    });

    it(`${w.name}: other database errors pass through as DbError`, async () => {
      const { client } = fakeClient(null, { code: "BTCF0", message: "x" });
      await assert.rejects(w.call(client), (e: unknown) => e instanceof DbError && e.code === "conflict");
    });
  }
});

describe("DB-13: storeExtractChunk", () => {
  it("sends new points and merges in the SQL shape", async () => {
    const { client, calls } = fakeClient({ alreadyCommitted: false, entries: [{}, {}] });
    await storeExtractChunk(client, CLAIM, {
      chunkIndex: 3,
      chunkTotal: 5,
      accessLevel: "leads_only",
      aiProvenance: { provider: "fake" },
      entries: [
        { point: { category: "owner", title: "T", statement: "S", attributes: {}, inferenceRationale: null }, citations: [] },
        { pointId: ID, citations: [{ messageId: ID, quote: "q", quoteStart: null, quoteEnd: null }] },
      ],
    });
    const args = calls[0].args;
    assert.equal(args.p_chunk_index, 3);
    assert.equal(args.p_chunk_total, 5);
    assert.equal(args.p_access_level, "leads_only");
    assert.deepEqual(args.p_entries, [
      { pointId: null, point: { category: "owner", title: "T", statement: "S", attributes: {}, inferenceRationale: null }, citations: [] },
      { pointId: ID, point: null, citations: [{ messageId: ID, quote: "q", quoteStart: null, quoteEnd: null }] },
    ]);
  });

  it("returns alreadyCommitted for a repeated chunk", async () => {
    const { client } = fakeClient({ alreadyCommitted: true, entries: [] });
    const r = await storeExtractChunk(client, CLAIM, { chunkIndex: 0, chunkTotal: 1, accessLevel: "everyone", aiProvenance: {}, entries: [{ pointId: ID, citations: [] }] });
    assert.deepEqual(r, { alreadyCommitted: true, entries: [] });
  });

  it("fails closed on a malformed or mismatched response", async () => {
    for (const data of [null, { alreadyCommitted: false }, { alreadyCommitted: false, entries: [] }]) {
      const { client } = fakeClient(data);
      await assert.rejects(
        storeExtractChunk(client, CLAIM, { chunkIndex: 0, chunkTotal: 1, accessLevel: "everyone", aiProvenance: {}, entries: [{ pointId: ID, citations: [] }] }),
        (e: unknown) => e instanceof DbError && e.code === "internal",
      );
    }
  });
});

describe("DB-12: lib/pipeline never calls an unfenced writer", () => {
  const UNFENCED = [
    "insert_extracted_point",
    "add_source_quote_evidence",
    "record_quote_check",
    "record_support_verdict",
    "create_system_gap_question",
    "set_point_sort_keys",
    "persist_parsed_source",
    "mark_source_parse_failed",
    "set_job_provenance",
    "record_job_attempt",
    "claim_processing_jobs",
  ];
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
      return p.endsWith(".ts") ? [p] : [];
    });
  }
  it("no source file under lib/pipeline or lib/db/pipeline.ts names one", () => {
    const sources = [...files(join(process.cwd(), "lib", "pipeline")), join(process.cwd(), "lib", "db", "pipeline.ts")];
    assert.ok(sources.length > 5);
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const fn of UNFENCED) {
        assert.ok(!new RegExp(`["'\`]${fn}["'\`]`).test(text), `${file} calls the unfenced ${fn}`);
      }
    }
  });
});
