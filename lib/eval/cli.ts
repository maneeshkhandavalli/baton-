/**
 * Offline evaluation CLI (R3 Task 03).
 *
 *   npm run eval:extraction                       # fake adapter: deterministic plumbing baseline (no model)
 *   npm run eval:extraction -- --out report.json  # also write the JSON report
 *   npm run eval:extraction -- --write-baseline   # overwrite fixtures/eval/baselines/fake-baseline.json
 *
 * Real provider (billed calls, synthetic datasets only), opt-in exactly like the live injection suite:
 *   BATON_LIVE_AI=1 + a production provider, or an evaluation provider (AI_PROVIDER=omega, NODE_ENV=test,
 *   BATON_ALLOW_EVAL_PROVIDER=1, OMEGA_API_KEY, fixed AI_MODEL_EXTRACT / AI_MODEL_VERIFY), then
 *   npm run eval:extraction -- --provider configured --out eval-<provider>-<model>.json
 * The API key is never printed or written: reports carry provider, adapter, model and prompt ids only.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { getAiConfiguration, getAiProviderForRun } from "../ai/config";
import { createFakeProvider, fakeRunConfig } from "../ai/providers/fake";
import { loadDatasets } from "./dataset";
import { formatReport, runEvaluation } from "./run";

export const BASELINE_PATH = join(process.cwd(), "fixtures", "eval", "baselines", "fake-baseline.json");

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const which = arg("--provider") ?? "fake";
  const datasets = loadDatasets();

  let report;
  if (which === "fake") {
    report = await runEvaluation(datasets, createFakeProvider(), fakeRunConfig(), "fake adapter (deterministic plumbing baseline; NOT a model)");
  } else if (which === "configured") {
    if (process.env.BATON_LIVE_AI !== "1") throw new Error("real provider evaluation is opt-in: set BATON_LIVE_AI=1");
    const config = getAiConfiguration();
    if (!config.ok || (config.mode !== "production" && config.mode !== "evaluation")) throw new Error("no real AI provider is configured");
    const provider = getAiProviderForRun(config.runConfig);
    if (!provider.ok) throw new Error("provider unavailable");
    report = await runEvaluation(datasets, provider.data, config.runConfig, `${config.mode} provider ${config.provider.id}`, {
      signal: () => AbortSignal.timeout(180_000),
    });
  } else {
    throw new Error(`unknown --provider ${which}`);
  }

  console.log(formatReport(report));
  const out = arg("--out");
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  if (args.includes("--write-baseline")) {
    if (which !== "fake") throw new Error("only the deterministic fake baseline is committed");
    writeFileSync(BASELINE_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`baseline written: ${BASELINE_PATH}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "evaluation failed");
  process.exitCode = 1;
});
