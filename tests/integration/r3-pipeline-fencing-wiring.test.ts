// Round 3 F1 (DB-12 / DB-13, owner Agent 4): the worker must USE the fenced pipeline API.
// 20261113300100_pipeline_fencing.sql added fenced twins (pipeline_*) and the atomic chunk writer, and their
// SQL behaviour is hard-tested in tests/integration/db/sql/it17_db12_db13_fencing.sql. This file checks the
// TypeScript side: no worker code path may call a legacy, unfenced writer. HARD since Agent 4's wiring
// (ab96beb, integrated): lib/db/pipeline.ts calls only pipeline_* writers (through fencedRpc) and the atomic
// chunk writer. The legacy writers' GRANTS are still open (DB-12-LEGACY, pending in it17).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const LEGACY_WRITERS = [
  "insert_extracted_point", "add_source_quote_evidence", "record_quote_check", "record_support_verdict",
  "create_system_gap_question", "set_point_sort_keys", "persist_parsed_source", "mark_source_parse_failed", "set_job_provenance",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

/** RPC names passed as string literals to callRpc/rpc in worker code (lib/db/pipeline.ts and lib/pipeline/**). */
function rpcNames(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of [join(ROOT, "lib", "db", "pipeline.ts"), ...files(join(ROOT, "lib", "pipeline"))]) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:callRpc|fencedRpc|\.rpc)\(\s*[A-Za-z_.()]*\s*,\s*"([a-z_]+)"/g)) {
      out.set(m[1], [...(out.get(m[1]) ?? []), f.slice(ROOT.length + 1)]);
    }
  }
  return out;
}

describe("DB-12/DB-13 wiring: the worker calls only fenced writers", () => {
  it("the scan finds the worker's RPCs at all (control)", () => {
    const names = rpcNames();
    assert.ok(names.has("claim_ready_processing_jobs") && names.has("complete_processing_job"), [...names.keys()].join(", "));
  });

  it("no legacy unfenced writer is called from lib/db/pipeline.ts or lib/pipeline/** (DB-12-TS, hard)", () => {
    const names = rpcNames();
    const legacy = LEGACY_WRITERS.filter((n) => names.has(n)).map((n) => `${n} (${names.get(n)!.join(", ")})`);
    assert.deepEqual(legacy, [], `legacy writers still called: ${legacy.join("; ")}`);
  });

  it("every fenced twin is the one the worker calls (DB-12-TS, hard)", () => {
    const names = rpcNames();
    const missing = LEGACY_WRITERS.filter((n) => !["insert_extracted_point", "add_source_quote_evidence"].includes(n))
      .map((n) => `pipeline_${n}`).filter((n) => !names.has(n));
    assert.deepEqual(missing, [], `fenced writers not used: ${missing.join(", ")}`);
  });

  it("extraction stores chunks atomically through pipeline_store_extract_chunk (DB-13-TS, hard)", () => {
    assert.ok(rpcNames().has("pipeline_store_extract_chunk"), "pipeline_store_extract_chunk is not called");
  });
});
