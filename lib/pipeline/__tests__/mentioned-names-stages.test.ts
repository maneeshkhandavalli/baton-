// R4 (audit 3.2 / 3.4 / S3): names of people who never sent a message, through the pipeline stages, with the
// real parser, pseudonymiser, local name detection and vault crypto, and a fake DbClient / storage.
// Synthetic names and data only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { IDENTITY_GOLDEN_TEST_CANARY, IDENTITY_GOLDEN_TEST_PEPPER } from "../../contracts/identity";
import type { ParsedSource } from "../../contracts/parser";
import type { ExtractionMessage, LinkNeedingSupport } from "../../db/pipeline";
import { measureBytes, type StorageClient } from "../../db/storage";
import { computeIdentityHash } from "../../privacy/identity";
import { getIdentityMapKey, openLabel, personKeyFor, sealLabel } from "../../privacy/identity-vault";
import { legacySourcesAllowed } from "../identity";
import { createMemoryLogger } from "../log";
import { verifyIdentityPepper } from "../pepper-core";
import { createDrainer } from "../runner";
import type { StageContext } from "../stage-context";
import { runExtract } from "../stages/extract";
import { buildVerifyRequest, runVerifySupport } from "../stages/verify-support";
import { claimed, fakeAi, fakeChunkStore, fakeDb, fakeStorage, IDS, jobContext } from "./fakes";

const goodPepper = () =>
  verifyIdentityPepper({ IDENTITY_PEPPER: IDENTITY_GOLDEN_TEST_PEPPER, IDENTITY_PEPPER_VERSION: "p1", IDENTITY_PEPPER_CANARY: IDENTITY_GOLDEN_TEST_CANARY });
const KEY = (() => {
  const k = getIdentityMapKey();
  assert.ok(k.ok, "fakes.ts sets a synthetic IDENTITY_MAP_KEY");
  return k.key;
})();
const enc = (s: string) => new TextEncoder().encode(s);

function storageByPath(files: Record<string, Uint8Array>): StorageClient {
  return {
    from: () => ({
      createSignedUploadUrl: async () => ({ data: null, error: { message: "unused" } }),
      download: async (path: string) => (files[path] ? { data: new Blob([files[path] as unknown as ArrayBuffer]), error: null } : { data: null, error: { message: "missing" } }),
      remove: async () => ({ data: null, error: null }),
    }),
  };
}

async function oneSourceRun(bytes: Uint8Array, kind: string, fileName: string, rules: unknown[] = []) {
  const path = `raw/${IDS.handover}/${IDS.source}`;
  const m = await measureBytes(bytes);
  let parsed = false;
  let persisted: ParsedSource | null = null;
  let claims = 0;
  const db = fakeDb({
    claim_ready_processing_jobs: () => (claims++ === 0 ? [claimed("parse")] : []),
    get_processing_job_context: jobContext("parse"),
    parse_exclusion_rules: rules,
    raw_source_for_processing: () => ({
      raw_storage_path: parsed ? null : path,
      size_bytes: m.sizeBytes,
      sha256: m.sha256,
      state: parsed ? "parsed" : "uploaded",
      kind,
      timezone: "Asia/Kolkata",
      date_order: null,
      original_filename: fileName,
    }),
    heartbeat_processing_job: "running",
    pipeline_persist_parsed_source: (a: Record<string, unknown>) => {
      persisted = a.p_parsed as ParsedSource;
      parsed = true;
      return null;
    },
    complete_processing_job: (a: Record<string, unknown>) => ({ succeeded: "succeeded", failed: "failed", retry: "queued" })[a.p_outcome as string],
    list_run_jobs: { runStatus: "running", jobs: [] },
  });
  const logger = createMemoryLogger();
  await createDrainer({
    db: db.client,
    storage: storageByPath({ [path]: bytes }),
    logger,
    getPepper: goodPepper,
    ai: fakeAi().ai,
    now: () => Date.UTC(2026, 10, 21),
  })({ maxJobs: 3 });
  return { db, logger, persisted: persisted as ParsedSource | null };
}

function vaultLabels(db: ReturnType<typeof fakeDb>): string[] {
  const out: string[] = [];
  for (const c of db.called("pipeline_reserve_handover_people")) {
    for (const p of c.args.p_people as Array<{ personKey: string; sealed: string | null }>) {
      if (p.sealed) out.push(openLabel(KEY, IDS.handover, p.personKey, p.sealed, "k1") ?? "?");
    }
  }
  return out;
}

describe("parse: mentioned-only names are pseudonymised before persistence", () => {
  it("document-only source (no senders): names are found, registered in the vault and replaced; nothing in clear", async () => {
    const DOC = enc(
      [
        "# Stall handover",
        "",
        "Owner: Deepa Nair. Ask Farhan Qureshi for the locker key before Monday.",
        "",
        "Mrs Lata Joshi signs the GST forms; Deepa will hand over the Excel sheet.",
        "",
      ].join("\n"),
    );
    const { db, logger, persisted } = await oneSourceRun(DOC, "markdown", "handover.md");
    assert.ok(persisted, "persisted");
    const stored = JSON.stringify(persisted);
    for (const n of ["Deepa", "Nair", "Farhan", "Qureshi", "Lata", "Joshi"]) assert.equal(stored.includes(n), false, `persisted names ${n}: ${stored}`);
    for (const w of ["Monday", "GST", "Excel", "Stall handover"]) assert.ok(stored.includes(w), `ordinary word ${w} kept`);
    assert.match(stored, /\[PERSON_\d+\]/);

    // Sealed in the vault, never in clear in the reserve payload or the logs.
    const reserved = JSON.stringify(db.called("pipeline_reserve_handover_people").map((c) => c.args));
    for (const n of ["Deepa", "Farhan", "Lata"]) assert.equal(reserved.includes(n), false);
    const labels = vaultLabels(db);
    for (const n of ["Deepa Nair", "Farhan Qureshi", "Lata Joshi"]) assert.ok(labels.includes(n), `${n} sealed in the vault (${labels.length} labels)`);
    // "Deepa" alone shares Deepa Nair's number (one person, one number).
    const deepa = personKeyFor(KEY, IDS.handover, "name", computeIdentityHash("Deepa Nair", IDENTITY_GOLDEN_TEST_PEPPER));
    assert.ok(db.called("pipeline_reserve_handover_people").some((c) => (c.args.p_people as Array<{ personKey: string }>).some((p) => p.personKey === deepa)));
    assert.equal(labels.includes("Deepa"), false);
    const logs = JSON.stringify(logger.records);
    for (const n of ["Deepa", "Farhan", "Lata"]) assert.equal(logs.includes(n), false);
    assert.match(logs, /"mentionedPeople":3/);
  });

  it("chat source: mentioned-only names, nicknames and joined forms of senders are replaced", async () => {
    const CHAT = enc(
      [
        "20/02/2024, 08:00 - Ravindra Shah: Kavya Menon has the stall keys, ask her before Friday",
        "20/02/2024, 08:01 - Priya Sharma: Ravibhai please send the receipts to Mr Iyer",
        "20/02/2024, 08:02 - Ravindra Shah: Preeya, the deposit is with @Arjun",
        "",
      ].join("\n"),
    );
    const { persisted } = await oneSourceRun(CHAT, "whatsapp_export", "chat.txt");
    assert.ok(persisted);
    const bodies = persisted.messages.map((m) => m.body);
    assert.equal(bodies[0], "[PERSON_3] has the stall keys, ask her before Friday");
    assert.equal(bodies[1], "[PERSON_1]-bhai please send the receipts to Mr [PERSON_4]");
    assert.equal(bodies[2], "[PERSON_2], the deposit is with [PERSON_5]");
    const stored = JSON.stringify(persisted);
    for (const n of ["Ravindra", "Ravi", "Shah", "Priya", "Preeya", "Kavya", "Menon", "Iyer", "Arjun"]) assert.equal(stored.includes(n), false, `persisted names ${n}`);
  });

  it("a mentioned name matching an exclusion rule is never registered in the vault", async () => {
    const rule = {
      kind: "participant",
      ruleId: IDS.rule,
      identityKind: "name",
      participantIdentityHash: computeIdentityHash("Meera Pillai", IDENTITY_GOLDEN_TEST_PEPPER),
      identityPepperVersion: "p1",
      mode: "apply",
    };
    const DOC = enc(["Ask Farhan Qureshi for the key.", ""].join("\n"));
    const { db } = await oneSourceRun(DOC, "markdown", "notes.md", [rule]);
    const labels = vaultLabels(db);
    assert.equal(labels.some((l) => /meera/i.test(l)), false);
  });
});

// ── verify_support and extract payloads ─────────────────────────────────────────────────────────────────

const RAVI_KEY = personKeyFor(KEY, IDS.handover, "name", computeIdentityHash("Ravindra Shah", IDENTITY_GOLDEN_TEST_PEPPER));
const PEOPLE = [{ ordinal: 1, personKey: RAVI_KEY, sealed: sealLabel(KEY, IDS.handover, RAVI_KEY, "Ravindra Shah").sealed, keyVersion: "k1" }];
const M = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function ctx(stage: "extract" | "verify_support", db: ReturnType<typeof fakeDb>, ai: ReturnType<typeof fakeAi>["ai"], roleTitle: string | null = null): StageContext {
  const base = jobContext(stage, { source: { state: "parsed" } });
  return {
    claimed: claimed(stage, 1, stage === "verify_support" ? null : IDS.source),
    job: { ...base, handover: { ...base.handover, teamName: "Synthetic Robotics Club", roleTitle } },
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

describe("verify_support: names a human typed never reach the verifier", () => {
  // A reviewer edit and an accepted Gap Interview answer that name people who never wrote in any source.
  const editLink: LinkNeedingSupport = {
    pointEvidenceId: M(1),
    pointId: IDS.point1,
    revisionId: IDS.point3,
    claim: { category: "owner", title: "Kavya Menon owns the stall keys", statement: "Ask Kavya Menon; Ravibhai has a spare.", attributes: { responsibility: "Keys", ownerLabel: "Kavya Menon" } },
    evidenceKind: "testimony",
    quote: { text: "The spare key is with Mrs Lata Joshi, call her before the audit", authorLabel: null, sentAt: null },
    context: [],
  };

  it("document-only handover (no known people): the pseudonymiser is not a no-op", () => {
    const req = buildVerifyRequest(editLink);
    assert.ok(req);
    const sent = JSON.stringify(req);
    for (const n of ["Kavya", "Menon", "Lata", "Joshi", "Ravibhai"]) assert.equal(sent.includes(n), false, sent);
    assert.equal(req.claim.title, "[PERSON] owns the stall keys");
    assert.equal(req.claim.category, "owner");
  });

  it("through the stage: known, fuzzy and unknown names are replaced; the stored quote text is the original", async () => {
    const verified = new Set<string>();
    const db = fakeDb({
      pipeline_list_handover_people: { people: PEOPLE, sourceIdentityScheme: null },
      list_links_needing_support: () => (verified.size ? [] : [editLink]),
      pipeline_record_support_verdict: (a: Record<string, unknown>) => {
        verified.add(a.p_point_evidence_id as string);
        return null;
      },
      pipeline_set_job_provenance: null,
    });
    const { ai, calls } = fakeAi();
    const out = await runVerifySupport(ctx("verify_support", db, ai));
    assert.equal(out.kind, "succeeded");
    const sent = JSON.stringify(calls.verify[0]);
    for (const n of ["Kavya", "Menon", "Lata", "Joshi", "Ravi"]) assert.equal(sent.includes(n), false, sent);
    assert.match(calls.verify[0].claim.statement, /\[PERSON_1\]-bhai/);
    const rec = db.called("pipeline_record_support_verdict")[0].args;
    // The verdict is bound to the ORIGINAL stored quote (its hash), not to the pseudonymised request text.
    assert.ok(String(rec.p_quote_sha256).includes(createHash("sha256").update(editLink.quote.text, "utf8").digest("hex")));
  });
});

describe("extract: owner-typed titles and the legacy gate", () => {
  it("a role title naming a person who never wrote is pseudonymised", async () => {
    const store = fakeChunkStore();
    const message = (n: number, body: string): ExtractionMessage => ({ id: M(n), seq: n, conversationLocalId: "c_1", authorLabel: "[PERSON_1]", sentAt: null, kind: "text", body });
    const db = fakeDb({
      pipeline_list_handover_people: { people: PEOPLE, sourceIdentityScheme: "person_v1" },
      parse_exclusion_rules: [],
      list_extraction_messages: (a: Record<string, unknown>) => ({
        accessLevel: "everyone",
        messages: [message(0, "[PERSON_1] has the stall keys")].filter((m) => m.seq > (a.p_after_seq as number)),
      }),
      list_points_for_pipeline: [],
      pipeline_store_extract_chunk: store.handler,
      pipeline_set_job_provenance: null,
    });
    const { ai, calls } = fakeAi();
    await runExtract(ctx("extract", db, ai, "Successor to Meera Iyer"));
    assert.deepEqual(calls.extract[0].handover, { teamName: "Synthetic Robotics Club", roleTitle: "Successor to [PERSON]" });
  });

  it("legacy sources stay fail-closed: only the exact override value enables them", () => {
    assert.equal(legacySourcesAllowed({}), false);
    assert.equal(legacySourcesAllowed({ BATON_ALLOW_LEGACY_IDENTITY_SOURCES: "true" }), false);
    assert.equal(legacySourcesAllowed({ BATON_ALLOW_LEGACY_IDENTITY_SOURCES: "0" }), false);
    assert.equal(legacySourcesAllowed({ BATON_ALLOW_LEGACY_IDENTITY_SOURCES: "1" }), true);
    assert.equal(process.env.BATON_ALLOW_LEGACY_IDENTITY_SOURCES, undefined);
  });
});
