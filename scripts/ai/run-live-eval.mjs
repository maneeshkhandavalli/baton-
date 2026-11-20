#!/usr/bin/env node
// Real-provider AI check on SYNTHETIC datasets only (fixtures/eval/handover-reliability/*.json): extraction, quote
// verification and support verification through the production Gemini adapter, with production's provider and model
// identifiers. Billed or quota-counted calls (about 2 per dataset chunk). Never touches a database.
//
//   node scripts/ai/run-live-eval.mjs <key-file outside the repo> [--out report.json]
//
// <key-file> holds one line `AI_API_KEY=<key>` (a Gemini API key). It must live OUTSIDE this repository. The key is
// passed to the child process environment only; it is never printed, logged or written.
// NODE_ENV=test is the documented synthetic-data mode in which the data-governance gate does not apply
// (lib/ai/config.ts dataGovernanceApproved); production keeps the gate. Nothing here changes any configuration.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [keyFile, ...rest] = process.argv.slice(2);
if (!keyFile) {
  console.error("usage: node scripts/ai/run-live-eval.mjs <key-file outside the repo> [--out report.json]");
  process.exit(2);
}
const abs = realpathSync(resolve(keyFile));
const rel = relative(repo, abs);
if (!rel.startsWith("..") && !isAbsolute(rel)) {
  console.error("refusing: the key file must be outside the repository");
  process.exit(2);
}
const match = readFileSync(abs, "utf8").match(/^\s*AI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
if (!match || match[1].trim().length < 20) {
  console.error("refusing: no AI_API_KEY=<key> line found in the key file");
  process.exit(2);
}

// Production's provider and model identifiers (Vercel production, read 2026-11-20); not changed here.
const env = {
  ...process.env,
  NODE_ENV: "test",
  BATON_LIVE_AI: "1",
  AI_PROVIDER: "gemini",
  AI_MODEL_EXTRACT: "gemini-3.6-flash",
  AI_MODEL_VERIFY: "gemini-3.5-flash-lite",
  AI_API_KEY: match[1].trim(),
};
delete env.BATON_ALLOW_FAKE_AI;
delete env.AI_DATA_GOVERNANCE;

const out = rest.includes("--out") ? rest[rest.indexOf("--out") + 1] : join(repo, "eval-live-gemini.json");
const r = spawnSync(process.execPath, ["--import", "./lib/ai/__tests__/resolve-ai.mjs", "lib/eval/cli.ts", "--provider", "configured", "--out", out], {
  cwd: repo,
  env,
  stdio: "inherit",
});
process.exit(r.status ?? 1);
