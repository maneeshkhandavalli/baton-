// R3 Task 02 (PRIV-1, PRIV-3): pseudonymisation through the pipeline stages, with the real parser, the real
// pseudonymiser and vault crypto, and a fake DbClient / storage. Synthetic names and data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDENTITY_GOLDEN_TEST_CANARY, IDENTITY_GOLDEN_TEST_PEPPER } from "../../contracts/identity";
import type { ParsedSource } from "../../contracts/parser";
import type { ExtractionMessage, LinkNeedingSupport } from "../../db/pipeline";
import { measureBytes, type StorageClient } from "../../db/storage";
import { computeIdentityHash } from "../../privacy/identity";
import { getIdentityMapKey, openLabel, personKeyFor, sealLabel } from "../../privacy/identity-vault";
import type { CheckedCandidate } from "../ai";
import { createMemoryLogger } from "../log";
import { verifyIdentityPepper } from "../pepper-core";
import { createDrainer } from "../runner";
import type { StageContext } from "../stage-context";
import { runExtract } from "../stages/extract";
import { runVerifySupport } from "../stages/verify-support";
import { attemptRecord, claimed, fakeAi, fakeChunkStore, fakeDb, fakeStorage, IDS, jobContext, provenance } from "./fakes";

const goodPepper = () =>
  verifyIdentityPepper({ IDENTITY_PEPPER: IDENTITY_GOLDEN_TEST_PEPPER, IDENTITY_PEPPER_VERSION: "p1", IDENTITY_PEPPER_CANARY: IDENTITY_GOLDEN_TEST_CANARY });
const KEY = (() => {
  const k = getIdentityMapKey();
  assert.ok(k.ok, "fakes.ts sets a synthetic IDENTITY_MAP_KEY");
  return k.key;
})();
const NAMES = ["Asha", "Ravi", "Priya", "Sharma", "Kumar", "Rao"];

const enc = (s: string) => new TextEncoder().encode(s);
const CHAT_A = enc(
  [
    "20/02/2024, 08:00 - Asha Rao: Ravi Kumar has the stall keys",
    "20/02/2024, 08:01 - Ravi Kumar: Priya Sharma collects the fees, ask @Asha for the receipts",
    "",
  ].join("\n"),
);
const CHAT_B = enc(["21/02/2024, 09:00 - Priya Sharma: Fees collected. Thanks Asha Rao!", ""].join("\n"));
const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";

function storageByPath(files: Record<string, Uint8Array>): StorageClient {
  return {
    from: () => ({
      createSignedUploadUrl: async () => ({ data: null, error: { message: "unused" } }),
      download: async (path: string) => (files[path] ? { data: new Blob([files[path] as unknown as ArrayBuffer]), error: null } : { data: null, error: { message: "missing" } }),
      remove: async () => ({ data: null, error: null }),
    }),
  };
}

async function twoChatRun(opts: { mapKey?: false } = {}) {
  const path = (s: string) => `raw/${IDS.handover}/${s}`;
  const files = { [path(IDS.source)]: CHAT_A, [path(IDS.source2)]: CHAT_B };
  const meta = new Map<string, { sha: string; size: number; parsed: boolean }>();
  for (const [s, b] of [[IDS.source, CHAT_A], [IDS.source2, CHAT_B]] as const) {
    const m = await measureBytes(b);
    meta.set(s, { sha: m.sha256, size: m.sizeBytes, parsed: false });
  }
  const queue = [
    { ...claimed("parse"), id: JOB_A, source_id: IDS.source },
    { ...claimed("parse"), id: JOB_B, source_id: IDS.source2 },
  ];
  const persisted = new Map<string, ParsedSource>();
  const db = fakeDb({
    claim_ready_processing_jobs: () => {
      const j = queue.shift();
      return j ? [j] : [];
    },
    get_processing_job_context: (a: Record<string, unknown>) => {
      const sourceId = a.p_job_id === JOB_A ? IDS.source : IDS.source2;
      const base = jobContext("parse");
      return {
        ...base,
        job: { ...base.job, id: a.p_job_id, sourceId },
        run: { ...base.run, sourceIds: [IDS.source, IDS.source2] },
        handover: { ...base.handover, teamName: "Synthetic Robotics Club" },
      };
    },
    parse_exclusion_rules: [],
    raw_source_for_processing: (a: Record<string, unknown>) => {
      const s = a.p_source_id as string;
      const m = meta.get(s)!;
      return {
        raw_storage_path: m.parsed ? null : path(s),
        size_bytes: m.size,
        sha256: m.sha,
        state: m.parsed ? "parsed" : "uploaded",
        kind: "whatsapp_export",
        timezone: "Asia/Kolkata",
        date_order: null,
        original_filename: "chat.txt",
      };
    },
    heartbeat_processing_job: "running",
    pipeline_persist_parsed_source: (a: Record<string, unknown>) => {
      const s = a.p_job_id === JOB_A ? IDS.source : IDS.source2;
      persisted.set(s, a.p_parsed as ParsedSource);
      meta.get(s)!.parsed = true;
      return null;
    },
    complete_processing_job: (a: Record<string, unknown>) => ({ succeeded: "succeeded", failed: "failed", retry: "queued" })[a.p_outcome as string],
    list_run_jobs: { runStatus: "running", jobs: [] },
  });
  const logger = createMemoryLogger();
  await createDrainer({
    db: db.client,
    storage: storageByPath(files),
    logger,
    getPepper: goodPepper,
    ...(opts.mapKey === false ? { getIdentityMapKey: () => ({ ok: false as const, reason: "missing" as const }) } : {}),
    ai: fakeAi().ai,
    now: () => Date.UTC(2026, 10, 17),
  })({ maxJobs: 5 });
  return { db, persisted, logger };
}

describe("parse: participants pseudonymised with stable handover-wide placeholders", () => {
  it("labels and mentions become [PERSON_n]; the same person has the same number in both sources; nothing names anyone", async () => {
    const { db, persisted, logger } = await twoChatRun();
    const a = persisted.get(IDS.source)!;
    const b = persisted.get(IDS.source2)!;
    assert.ok(a && b, "both sources persisted");
    assert.deepEqual(a.participants.map((p) => p.displayLabel), ["[PERSON_1]", "[PERSON_2]"]); // Asha Rao, Ravi Kumar
    // Priya Sharma only writes in source B, yet source A (parsed first) already uses her number.
    assert.equal(a.messages[1].body, "[PERSON_3] collects the fees, ask [PERSON_1] for the receipts");
    assert.equal(a.messages[0].body, "[PERSON_2] has the stall keys");
    assert.deepEqual(b.participants.map((p) => p.displayLabel), ["[PERSON_3]"]);
    assert.equal(b.messages[0].body, "Fees collected. Thanks [PERSON_1]!");

    const stored = JSON.stringify([...persisted.values()]);
    for (const n of NAMES) assert.equal(stored.includes(n), false, `persisted content names ${n}`);

    // The vault rows hold only ciphertext; they decrypt with the server key, bound to this handover.
    const reserved = db.called("pipeline_reserve_handover_people").map((c) => c.args.p_people as Array<{ personKey: string; sealed: string }>);
    const all = JSON.stringify(reserved);
    for (const n of NAMES) assert.equal(all.includes(n), false, `reserve payload names ${n}`);
    const ravi = personKeyFor(KEY, IDS.handover, "name", computeIdentityHash("Ravi Kumar", IDENTITY_GOLDEN_TEST_PEPPER));
    const row = reserved[0].find((p) => p.personKey === ravi)!;
    assert.equal(openLabel(KEY, IDS.handover, ravi, row.sealed, "k1"), "Ravi Kumar");

    assert.equal(db.called("pipeline_persist_pseudonymized_source").length, 2);
    const logs = JSON.stringify(logger.records);
    for (const n of NAMES) assert.equal(logs.includes(n), false, `log names ${n}`);
    assert.ok(logs.includes("mentionsPseudonymized"));
  });

  it("fails closed without the identity-map key: retryable, nothing downloaded, reserved or persisted", async () => {
    const { db } = await twoChatRun({ mapKey: false });
    assert.equal(db.called("pipeline_reserve_handover_people").length, 0);
    assert.equal(db.called("pipeline_persist_pseudonymized_source").length, 0);
    const completions = db.called("complete_processing_job").map((c) => c.args);
    assert.ok(completions.every((c) => c.p_outcome === "retry" && c.p_error_message === "identity_map_key_unverified"));
  });
});

// ── extract and verify_support ───────────────────────────────────────────────────────────────────────────

const RAVI_KEY = personKeyFor(KEY, IDS.handover, "name", computeIdentityHash("Ravi Kumar", IDENTITY_GOLDEN_TEST_PEPPER));
const PEOPLE = [{ ordinal: 1, personKey: RAVI_KEY, sealed: sealLabel(KEY, IDS.handover, RAVI_KEY, "Ravi Kumar").sealed, keyVersion: "k1" }];
const M = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const message = (n: number, body: string): ExtractionMessage => ({ id: M(n), seq: n, conversationLocalId: "c_1", authorLabel: "[PERSON_1]", sentAt: null, kind: "text", body });

function ctx(stage: "extract" | "verify_support", db: ReturnType<typeof fakeDb>, ai: ReturnType<typeof fakeAi>["ai"], teamName = "Synthetic Robotics Club"): StageContext {
  const base = jobContext(stage, { source: { state: "parsed" } });
  return {
    claimed: claimed(stage, 1, stage === "verify_support" ? null : IDS.source),
    job: { ...base, handover: { ...base.handover, teamName, roleTitle: "Ravi Kumar's successor" } },
    db: db.client,
    storage: fakeStorage(null).storage,
    logger: createMemoryLogger(),
    now: () => 0,
    deadlineAt: Number.POSITIVE_INFINITY,
    getPepper: goodPepper,
    heartbeat: async () => {},
    ai,
  };
}

function candidate(statement: string, quote: string, title = "Keys holder"): CheckedCandidate {
  return {
    category: "owner",
    title,
    statement,
    attributes: { responsibility: "Stall keys", ownerLabel: null, since: null },
    citations: [{ messageId: M(0), quote, stance: "supports", quoteCheck: "exact", quoteStart: 0, quoteEnd: quote.length, matchedText: quote }],
    inferenceRationale: null,
  } as CheckedCandidate;
}

describe("extract: legacy gate, request pseudonymisation and output guard", () => {
  function extractDb(scheme: "person_v1" | null, rules: unknown[] = []) {
    const store = fakeChunkStore();
    const db = fakeDb({
      pipeline_list_handover_people: { people: PEOPLE, sourceIdentityScheme: scheme },
      parse_exclusion_rules: rules,
      list_extraction_messages: (a: Record<string, unknown>) => ({
        accessLevel: "everyone",
        messages: [message(0, "[PERSON_1] has the stall keys")].filter((m) => m.seq > (a.p_after_seq as number)),
      }),
      list_points_for_pipeline: [],
      pipeline_store_extract_chunk: store.handler,
      pipeline_set_job_provenance: null,
    });
    return { db, store };
  }

  it("a legacy (plain-text) source is never sent to the AI unless the owner override is set", async () => {
    const { db } = extractDb(null);
    const { ai, calls } = fakeAi();
    const out = await runExtract(ctx("extract", db, ai));
    assert.equal(out.kind, "failed");
    if (out.kind === "failed") assert.equal(out.failure.reason, "source_not_pseudonymized");
    assert.equal(calls.extract.length, 0);

    process.env.BATON_ALLOW_LEGACY_IDENTITY_SOURCES = "1";
    try {
      const again = extractDb(null);
      const second = fakeAi();
      assert.equal((await runExtract(ctx("extract", again.db, second.ai))).kind, "succeeded");
      assert.equal(second.calls.extract.length, 1);
    } finally {
      delete process.env.BATON_ALLOW_LEGACY_IDENTITY_SOURCES;
    }
  });

  it("team name and role title are pseudonymised before they are sent", async () => {
    const { db } = extractDb("person_v1");
    const { ai, calls } = fakeAi();
    await runExtract(ctx("extract", db, ai, "Ravi Kumar Robotics"));
    assert.deepEqual(calls.extract[0].handover, { teamName: "[PERSON_1] Robotics", roleTitle: "[PERSON_1]'s successor" });
  });

  it("drops a candidate whose model text reintroduces a participant or an excluded person; keeps placeholder text", async () => {
    const meeraRule = {
      kind: "participant",
      ruleId: IDS.rule,
      identityKind: "name",
      participantIdentityHash: computeIdentityHash("Meera Nair", IDENTITY_GOLDEN_TEST_PEPPER),
      identityPepperVersion: "p1",
      mode: "apply",
    };
    const { db, store } = extractDb("person_v1", [meeraRule]);
    const { ai } = fakeAi({
      extract: () => ({
        ok: true,
        data: {
          candidates: [
            candidate("[PERSON_1] holds the stall keys.", "[PERSON_1] has the stall keys"),
            candidate("Ravi Kumar holds the stall keys.", "[PERSON_1] has the stall keys", "Ravi's keys"),
            candidate("MEERA NAIR used to hold them.", "[PERSON_1] has the stall keys", "Old keys"),
          ],
          dropped: Object.fromEntries([]) as never,
          provenance: provenance("extract"),
          attempt: attemptRecord(),
        },
      }),
    });
    const c = ctx("extract", db, ai);
    const out = await runExtract(c);
    assert.equal(out.kind, "succeeded");
    assert.equal(store.points.length, 1);
    assert.equal(JSON.stringify(store.points).includes("Ravi"), false);
    assert.equal(JSON.stringify(store.points).toLowerCase().includes("meera"), false);
    const log = JSON.stringify((c.logger as ReturnType<typeof createMemoryLogger>).records);
    assert.match(log, /"identityDropped":2/);
  });
});

describe("verify_support: pseudonymised request, withheld rationale", () => {
  const link: LinkNeedingSupport = {
    pointEvidenceId: M(1),
    pointId: IDS.point1,
    revisionId: IDS.point3,
    // a reviewer typed a real name into the point
    claim: { category: "owner", title: "Ravi owns the keys", statement: "Ravi Kumar holds the stall keys.", attributes: { responsibility: "Keys", ownerLabel: "Ravi Kumar" } },
    evidenceKind: "source_quote",
    quote: { text: "[PERSON_1] has the stall keys", authorLabel: "[PERSON_1]", sentAt: null },
    context: [{ authorLabel: "Ravi Kumar", sentAt: null, body: "thanks Ravi" }],
  };

  it("no known name reaches the verifier, and a rationale naming one is not stored", async () => {
    const verified = new Set<string>();
    const db = fakeDb({
      pipeline_list_handover_people: { people: PEOPLE, sourceIdentityScheme: null },
      list_links_needing_support: () => (verified.size ? [] : [link]),
      pipeline_record_support_verdict: (a: Record<string, unknown>) => {
        verified.add(a.p_point_evidence_id as string);
        return null;
      },
      pipeline_set_job_provenance: null,
    });
    const { ai, calls } = fakeAi({
      verify: () => ({ ok: true, data: { verdict: "supports", rationale: "Ravi Kumar says he has them.", provenance: provenance("verify"), attempt: attemptRecord() } }),
    });
    const out = await runVerifySupport(ctx("verify_support", db, ai));
    assert.equal(out.kind, "succeeded");
    const sent = JSON.stringify(calls.verify[0]);
    assert.equal(sent.includes("Ravi"), false, sent);
    assert.equal(calls.verify[0].claim.statement, "[PERSON_1] holds the stall keys.");
    const rec = db.called("pipeline_record_support_verdict")[0].args;
    assert.equal(rec.p_verdict, "supports");
    assert.equal(rec.p_rationale, null);
  });
});
