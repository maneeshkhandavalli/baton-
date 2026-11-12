// Round 3 B5: production refuses the fake adapter END TO END on the worker path, not only in
// getAiConfiguration. A run snapshotted with provider "fake" (e.g. created on a dev machine, or rows copied
// into production) reaches the real worker binding (POST /api/pipeline/drain → drainJobs → PIPELINE_AI →
// getAiProviderForRun(process.env)). Under any refused environment the AI stage must fail closed:
//   * the job completes as `failed` (not retried) with reason token provider_not_configured;
//   * no provenance is written, no masked message is read, no point/evidence is written;
//   * the response carries counts only.
// Control: the same job under the allowed local test adapter does proceed (so the refusal is not vacuous).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import * as drainRoute from "../../app/api/pipeline/drain/route";
import { claimed, jobContext } from "../../lib/pipeline/__tests__/fakes";
import { actionWorld } from "./support/actions";
import { captureConsole } from "./support/console-capture";
import { allowFakeAi, setAiEnv } from "./support/platform";

const SECRET = "r3-cron-secret-0123456789abcdefghijklmnop"; // synthetic, ≥ 32 chars
const AI_WRITES = ["set_job_provenance", "list_extraction_messages", "insert_extracted_point", "add_source_quote_evidence",
  "record_quote_check", "record_support_verdict", "create_system_gap_question"];
// verify_support reads its first page of links BEFORE resolving the provider (lazy prelude, by design: no
// call, no write); the refusal is asserted on a page with one link that needs a verdict.
const LINK = {
  pointEvidenceId: "e1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b", pointId: "b1808293-c4d5-4fe7-8081-92a3b4c5d6e7",
  revisionId: "d3a2a4b5-e6f7-4019-a2a3-b4c5d6e7f809",
  claim: { category: "decision", title: "Sponsor renewal", statement: "The sponsor renewal is due in March.", attributes: {} },
  evidenceKind: "source_quote", quote: { text: "Sponsorship renewal is due in March", authorLabel: "Asha", sentAt: null },
  context: [{ authorLabel: "Ravi", sentAt: null, body: "Noted, the form is on the shared drive" }],
};

const REFUSED: Array<[string, Parameters<typeof setAiEnv>[0]]> = [
  ["NODE_ENV=production with every flag set", { AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "production" }],
  ["NODE_ENV unset with every flag set", { AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: undefined }],
  ["NODE_ENV=staging", { AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "staging" }],
  ["development without BATON_ALLOW_FAKE_AI", { AI_PROVIDER: "fake", NODE_ENV: "development" }],
  ["development with AI_PROVIDER unset", { BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "development" }],
];

function world(stage: "extract" | "verify_support") {
  const w = actionWorld(false);
  process.env.CRON_SECRET = SECRET;
  let claims = 0;
  const job = claimed(stage, 1, stage === "extract" ? undefined : null);
  w.adminDb
    .returns("list_finishable_runs", [])
    .on("claim_ready_processing_jobs", () => (claims++ === 0 ? [job] : []))
    .returns("get_processing_job_context", jobContext(stage, { source: { state: "parsed" } }))
    .returns("heartbeat_processing_job", "running")
    .returns("set_job_provenance", null)
    .returns("list_extraction_messages", { accessLevel: "everyone", messages: [] })
    .returns("list_points_for_pipeline", [])
    .on("list_links_needing_support", () => (stage === "verify_support" ? [LINK] : []))
    .on("complete_processing_job", (args) => (args.p_outcome === "failed" ? "failed" : "succeeded"))
    .returns("list_run_jobs", { runStatus: "running", jobs: [] });
  return w;
}

const drain = async () =>
  (
    await captureConsole(() =>
      drainRoute.POST(new Request("https://baton.example.test/api/pipeline/drain", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } })),
    )
  ).result;

afterEach(() => {
  delete process.env.CRON_SECRET;
  allowFakeAi();
});

describe("B5: the worker refuses a 'fake' run outside development/test", () => {
  for (const stage of ["extract", "verify_support"] as const) {
    for (const [label, env] of REFUSED) {
      it(`${stage}: ${label}`, async () => {
        const w = world(stage);
        setAiEnv(env);
        const res = await drain();
        assert.equal(res.status, 200);
        const body = (await res.json()) as Record<string, unknown>;
        assert.ok(Object.values(body).every((v) => typeof v === "number"), "counts only");
        assert.equal(body.claimed, 1);
        assert.equal(body.failed, 1, JSON.stringify(body));

        const done = w.adminDb.last("complete_processing_job")?.args;
        assert.equal(done?.p_outcome, "failed", "not retried: a configuration problem never heals by retrying");
        assert.equal(done?.p_error_message, "provider_not_configured");
        const touched = AI_WRITES.filter((fn) => w.adminDb.called(fn));
        assert.deepEqual(touched, [], "no provenance, no message read, no AI-derived write");
      });
    }
  }

  it("control: under the allowed local test adapter the same extract job proceeds to provenance", async () => {
    const w = world("extract");
    allowFakeAi();
    const res = await drain();
    assert.equal(res.status, 200);
    assert.ok(w.adminDb.called("set_job_provenance"), "the stage got past the provider check");
    assert.notEqual(w.adminDb.last("complete_processing_job")?.args.p_error_message, "provider_not_configured");
  });
});
