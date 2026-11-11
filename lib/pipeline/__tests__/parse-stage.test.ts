// The parse job through the drain loop, with the real parser and a fake DbClient and storage.
// Synthetic data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDENTITY_GOLDEN_TEST_CANARY, IDENTITY_GOLDEN_TEST_PEPPER } from "../../contracts/identity";
import type { ParsedSource } from "../../contracts/parser";
import { measureBytes } from "../../db/storage";
import { computeIdentityHash } from "../../privacy/identity";
import { createMemoryLogger } from "../log";
import { verifyIdentityPepper } from "../pepper-core";
import { createDrainer } from "../runner";
import { claimed, fakeDb, fakeStorage, IDS, jobContext, rpcError } from "./fakes";

const SECRET_PHONE = "+91 99999 00042";
const CHAT = [
  "20/02/2024, 08:00 - Asha Rao: The club account login is with the treasurer",
  `20/02/2024, 08:01 - Ravi Kumar: Call me on ${SECRET_PHONE} for the venue booking`,
  "20/02/2024, 08:02 - Asha Rao: Venue deposit is due on Friday",
  "",
].join("\n");
const BYTES = new TextEncoder().encode(CHAT);

const goodPepper = () =>
  verifyIdentityPepper({ IDENTITY_PEPPER: IDENTITY_GOLDEN_TEST_PEPPER, IDENTITY_PEPPER_VERSION: "p1", IDENTITY_PEPPER_CANARY: IDENTITY_GOLDEN_TEST_CANARY });
const badPepper = () => verifyIdentityPepper({});

async function scenario(opts: {
  pepper?: typeof goodPepper;
  rules?: unknown[];
  persist?: unknown;
  sourceState?: string;
  rawState?: () => string;
  noObject?: boolean;
  declaredSha?: string;
  kind?: string;
}) {
  const log: string[] = [];
  const measured = await measureBytes(BYTES);
  let persisted = false;
  let claims = 0;
  const db = fakeDb(
    {
      claim_ready_processing_jobs: () => (claims++ === 0 ? [claimed("parse")] : []),
      get_processing_job_context: jobContext("parse", { source: { state: opts.sourceState ?? "uploaded" } }),
      parse_exclusion_rules: opts.rules ?? [],
      raw_source_for_processing: () => ({
        raw_storage_path: `raw/${IDS.handover}/${IDS.source}`,
        size_bytes: measured.sizeBytes,
        sha256: opts.declaredSha ?? measured.sha256,
        state: opts.rawState?.() ?? (persisted ? "parsed" : (opts.sourceState ?? "uploaded")),
        kind: opts.kind ?? "whatsapp_export",
        timezone: "Asia/Kolkata",
        date_order: null,
        original_filename: "chat.txt",
      }),
      heartbeat_processing_job: "running",
      persist_parsed_source: () => {
        if (opts.persist) return opts.persist;
        persisted = true;
        return null;
      },
      complete_processing_job: (args: Record<string, unknown>) =>
        ({ succeeded: "succeeded", failed: "failed", retry: "queued", skipped: "cancelled", yield: "queued" })[args.p_outcome as string],
      list_run_jobs: { runStatus: "running", jobs: [] },
    },
    log,
  );
  const { storage, removed } = fakeStorage(opts.noObject ? null : BYTES, log);
  const logger = createMemoryLogger();
  const report = await createDrainer({
    db: db.client,
    storage,
    logger,
    getPepper: opts.pepper ?? goodPepper,
    now: () => Date.UTC(2026, 10, 12),
  })({ maxJobs: 5 });
  const completion = db.called("complete_processing_job")[0]?.args;
  return { db, log, removed, logger, report, completion };
}

describe("parse stage (§10.3, D14)", () => {
  it("parses, persists masked rows, then deletes the raw upload only after the commit", async () => {
    const { db, log, removed, completion, report, logger } = await scenario({});
    assert.equal(completion?.p_outcome, "succeeded");
    assert.equal(report.succeeded, 1);

    const persist = db.called("persist_parsed_source")[0].args;
    assert.equal(persist.p_pepper_version, "p1");
    const parsed = persist.p_parsed as ParsedSource;
    assert.equal(parsed.messages.length, 3);
    assert.ok(parsed.messages.every((m) => !m.body.includes("99999")), "phone numbers are masked before persisting");

    assert.equal(removed.length, 1);
    assert.ok(log.indexOf("rpc:persist_parsed_source") < log.indexOf("storage:remove"), "raw deleted only after persist");
    assert.ok(log.indexOf("rpc:heartbeat_processing_job") < log.indexOf("rpc:persist_parsed_source"), "lease checked before persisting");
    assert.equal(db.called("mark_source_raw_deleted").length, 1);

    const logged = JSON.stringify(logger.records);
    for (const text of ["Asha", "Ravi", "treasurer", "99999", "chat.txt"]) assert.ok(!logged.includes(text), `log must not contain ${text}`);
  });

  it("fails closed without a verified pepper: retryable, nothing downloaded or parsed", async () => {
    const { db, log, completion } = await scenario({ pepper: badPepper });
    assert.equal(completion?.p_outcome, "retry");
    assert.equal(completion?.p_error_code, "processing_failed");
    assert.equal(completion?.p_error_message, "identity_pepper_unverified");
    assert.equal(completion?.p_next_attempt_at, new Date(Date.UTC(2026, 10, 12) + 30_000).toISOString());
    assert.ok(!log.includes("storage:download"));
    assert.equal(db.called("persist_parsed_source").length, 0);
    assert.equal(db.called("mark_source_parse_failed").length, 0, "the source is not failed for a configuration problem");
  });

  it("stops on an identity match before anything is persisted", async () => {
    const rule = {
      kind: "participant",
      ruleId: IDS.rule,
      identityKind: "name",
      participantIdentityHash: computeIdentityHash("Ravi Kumar", IDENTITY_GOLDEN_TEST_PEPPER),
      identityPepperVersion: "p1",
      mode: "detect",
    };
    const { db, removed, completion } = await scenario({ rules: [rule] });
    assert.equal(db.called("persist_parsed_source").length, 0);
    assert.equal(removed.length, 0, "raw upload kept");
    assert.equal(completion?.p_outcome, "failed");
    assert.equal(completion?.p_error_code, "precondition_failed");
    assert.equal(completion?.p_error_message, "identity_confirmation_required");
    assert.equal(db.called("mark_source_parse_failed")[0].args.p_error_code, "identity_confirmation_required");
  });

  it("an applied exclusion drops the participant's messages before persisting", async () => {
    const rule = {
      kind: "participant",
      ruleId: IDS.rule,
      identityKind: "name",
      participantIdentityHash: computeIdentityHash("Ravi Kumar", IDENTITY_GOLDEN_TEST_PEPPER),
      identityPepperVersion: "p1",
      mode: "apply",
    };
    const { db, completion } = await scenario({ rules: [rule] });
    assert.equal(completion?.p_outcome, "succeeded");
    const parsed = db.called("persist_parsed_source")[0].args.p_parsed as ParsedSource;
    assert.equal(parsed.messages.length, 2);
    assert.ok(!JSON.stringify(parsed).includes("Ravi"));
  });

  it("keeps the raw upload when persisting is refused", async () => {
    const { db, removed, completion } = await scenario({ persist: rpcError("BTCF0") });
    assert.equal(removed.length, 0);
    assert.equal(completion?.p_outcome, "failed");
    assert.equal(completion?.p_error_message, "excluded_participant_content");
    assert.equal(db.called("mark_source_parse_failed")[0].args.p_error_code, "excluded_participant_content");
  });

  it("retries a transient persistence error and keeps the raw upload", async () => {
    const { removed, completion } = await scenario({ persist: rpcError("40001") });
    assert.equal(removed.length, 0);
    assert.equal(completion?.p_outcome, "retry");
    assert.equal(completion?.p_error_message, "db_transient");
  });

  it("fails the source on a parser error with the parser code and keeps the raw upload", async () => {
    const { db, removed, completion } = await scenario({ kind: "pdf" });
    assert.equal(completion?.p_outcome, "failed");
    assert.match(String(completion?.p_error_message), /^parser:[a-z_]+$/);
    assert.ok(["parse_failed", "unsupported_file_type"].includes(String(completion?.p_error_code)));
    assert.equal(db.called("persist_parsed_source").length, 0);
    assert.equal(removed.length, 0);
    assert.equal(db.called("mark_source_parse_failed").length, 1);
  });

  it("never parses bytes that fail the integrity check", async () => {
    const { db, completion } = await scenario({ declaredSha: "00".repeat(32) });
    assert.equal(completion?.p_outcome, "failed");
    assert.equal(completion?.p_error_message, "integrity_mismatch");
    assert.equal(db.called("persist_parsed_source").length, 0);
    assert.equal(db.called("mark_source_parse_failed")[0].args.p_error_code, "integrity_mismatch");
  });

  it("retries when the raw object cannot be downloaded, without failing the source", async () => {
    const { db, completion } = await scenario({ noObject: true });
    assert.equal(completion?.p_outcome, "retry");
    assert.equal(completion?.p_error_message, "raw_unavailable");
    assert.equal(db.called("mark_source_parse_failed").length, 0);
    assert.equal(db.called("persist_parsed_source").length, 0);
  });

  it("is idempotent for an already parsed source: deletes a leftover raw upload, persists nothing", async () => {
    const { db, removed, completion } = await scenario({ sourceState: "parsed", rawState: () => "parsed" });
    assert.equal(completion?.p_outcome, "succeeded");
    assert.equal(db.called("persist_parsed_source").length, 0);
    assert.equal(removed.length, 1);
  });

  it("a failed raw delete after the commit does not fail the job", async () => {
    const log: string[] = [];
    const measured = await measureBytes(BYTES);
    let persisted = false;
    let claims = 0;
    const db = fakeDb(
      {
        claim_ready_processing_jobs: () => (claims++ === 0 ? [claimed("parse")] : []),
        get_processing_job_context: jobContext("parse"),
        parse_exclusion_rules: [],
        raw_source_for_processing: () => ({
          raw_storage_path: "raw/h/s",
          size_bytes: measured.sizeBytes,
          sha256: measured.sha256,
          state: persisted ? "parsed" : "uploaded",
          kind: "whatsapp_export",
          timezone: "Asia/Kolkata",
          date_order: null,
          original_filename: "chat.txt",
        }),
        heartbeat_processing_job: "running",
        persist_parsed_source: () => {
          persisted = true;
          return null;
        },
        complete_processing_job: "succeeded",
        list_run_jobs: { runStatus: "running", jobs: [] },
      },
      log,
    );
    const { storage } = fakeStorage(BYTES, log, true);
    const logger = createMemoryLogger();
    await createDrainer({ db: db.client, storage, logger, getPepper: goodPepper })({});
    assert.equal(db.called("complete_processing_job")[0].args.p_outcome, "succeeded");
    assert.equal(db.called("mark_source_raw_deleted").length, 0);
    assert.ok(logger.records.some((r) => r.event === "raw_delete_deferred"));
  });
});
