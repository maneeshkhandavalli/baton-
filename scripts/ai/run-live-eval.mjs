#!/usr/bin/env node
// Real-provider AI check on SYNTHETIC datasets only (fixtures/eval/handover-reliability/*.json): extraction, quote
// verification and support verification through the production Gemini adapter, with production's provider and model
// identifiers. Billed or quota-counted calls (about 2 per dataset chunk). Never touches a database.
//
//   node scripts/ai/run-live-eval.mjs <key-file outside the repo> [--out report.json]
//   node scripts/ai/run-live-eval.mjs <key-file outside the repo> --injection   # the live prompt-injection suite
//     (lib/ai/__tests__/prompt-injection.live.test.ts; required before any prompt-version bump, §11.8 rule 7)
//
// <key-file> holds one line `AI_API_KEY=<key>` (a Gemini API key) or `OMEGA_API_KEY=<key>` (Omega Plus, evaluation
// only; optional AI_MODEL_EXTRACT / AI_MODEL_VERIFY / OMEGA_OUTPUT_MODE lines). It must live OUTSIDE this repository. The key is
// passed to the child process environment only; it is never printed, logged or written.
// NODE_ENV=test is the documented synthetic-data mode in which the data-governance gate does not apply
// (lib/ai/config.ts dataGovernanceApproved); production keeps the gate. Nothing here changes any configuration.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAiKeyFile } from "./ai-key-file.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [keyFile, ...rest] = process.argv.slice(2);
if (!keyFile) {
  console.error("usage: node scripts/ai/run-live-eval.mjs <key-file outside the repo> [--out report.json]");
  process.exit(2);
}
// Gemini: production's provider and model identifiers (Vercel production, read 2026-11-20); not changed here.
// Omega (OMEGA_API_KEY=… in the key file): the evaluation-only provider, see scripts/ai/ai-key-file.mjs.
const env = { ...process.env, NODE_ENV: "test", BATON_LIVE_AI: "1" };
let ai;
try {
  ai = applyAiKeyFile(env, keyFile, repo);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
console.error(`[run-live-eval] AI: ${ai.label}`);

const out = rest.includes("--out") ? rest[rest.indexOf("--out") + 1] : join(repo, `eval-live-${ai.provider}.json`);
const childArgs = rest.includes("--injection")
  ? ["--import", "./lib/ai/__tests__/resolve-ai.mjs", "--test", "lib/ai/__tests__/prompt-injection.live.test.ts"]
  : ["--import", "./lib/ai/__tests__/resolve-ai.mjs", "lib/eval/cli.ts", "--provider", "configured", "--out", out];
const r = spawnSync(process.execPath, childArgs, {
  cwd: repo,
  env,
  stdio: "inherit",
});
process.exit(r.status ?? 1);
