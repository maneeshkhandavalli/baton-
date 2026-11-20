#!/usr/bin/env node
/**
 * Starts the single consolidated review preview on port 3110 against a chosen env file, without editing .env.local.
 *
 *   node scripts/connectors/preview-3110.mjs                               # baton-dev (.env.local only)
 *   node scripts/connectors/preview-3110.mjs .env.connectors-test.local    # isolated connector stack (127.0.0.1:55321)
 *   node scripts/connectors/preview-3110.mjs .env.connectors-test.local --ai-key-file <file outside the repo>
 *       # same, but REAL Gemini (production's model ids) for a synthetic-data end-to-end run. The file holds one line
 *       # AI_API_KEY=<key>; it is read here and passed to next dev only, never printed. next dev runs with
 *       # NODE_ENV=development, the documented synthetic-data mode (no data-governance gate); production keeps the gate.
 *       # A file with OMEGA_API_KEY=<key> instead selects Omega Plus (evaluation only), see scripts/ai/ai-key-file.mjs.
 *
 * Values from the given file are put in the process environment, which Next.js gives precedence over .env.local,
 * so every Supabase URL/key, BATON_SITE_URL and connector variable comes from that file. Runs `next dev` (the test
 * AI adapter only runs in development) with the background job worker off. Prints only the Supabase host and which
 * provider groups are filled in — never a value. Stop any running 3110 server first.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { applyAiKeyFile } from "../ai/ai-key-file.mjs";

const argv = process.argv.slice(2);
const aiIdx = argv.indexOf("--ai-key-file");
const aiKeyFile = aiIdx >= 0 ? argv[aiIdx + 1] : null;
const file = argv.find((a, i) => !a.startsWith("--") && (aiIdx < 0 || i !== aiIdx + 1)) ?? null;
const extra = {};
if (file) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && m[2] !== "") extra[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
const env = { ...process.env, ...extra, BATON_DEV_WORKER: "0" };
let aiLabel = "from env file";
if (aiKeyFile) aiLabel = applyAiKeyFile(env, aiKeyFile, process.cwd()).label;
if (!extra.BATON_SITE_URL) env.BATON_SITE_URL = "http://localhost:3110";
// A tunnel origin (e.g. https://x.ngrok-free.app) must be allowed to load Next's dev assets (next.config.ts).
try {
  const siteHost = new URL(env.BATON_SITE_URL).hostname;
  if (siteHost !== "localhost" && siteHost !== "127.0.0.1") env.BATON_DEV_ORIGINS = siteHost;
} catch {
  /* BATON_SITE_URL is validated by the app itself */
}

const host = (() => {
  try {
    return new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return "(from .env.local)";
  }
})();
const groups = { github: "GITHUB_APP_ID", discord: "DISCORD_BOT_TOKEN", slack: "SLACK_CLIENT_ID", telegram: "TELEGRAM_BOT_TOKEN" };
const filled = Object.entries(groups).filter(([, k]) => env[k]).map(([p]) => p);
console.log(`[preview-3110] env file: ${file ?? "none (.env.local)"} · supabase: ${host} · site: ${env.BATON_SITE_URL} · providers with values: ${filled.join(", ") || "none"} · AI: ${aiLabel}`);

// A fixed command string (no user input), so running it through the shell on Windows is safe and avoids DEP0190.
const child = process.platform === "win32" ? spawn("npx next dev -p 3110", { env, stdio: "inherit", shell: true }) : spawn("npx", ["next", "dev", "-p", "3110"], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
