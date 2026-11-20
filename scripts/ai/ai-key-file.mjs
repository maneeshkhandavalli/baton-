// Reads a real-provider key file that lives OUTSIDE the repository and returns the environment for a
// synthetic-data-only run (NODE_ENV development/test). Never prints, logs or writes a value.
//
//   AI_API_KEY=<gemini key>    → production's Gemini provider and model ids
//   OMEGA_API_KEY=<omega key>  → Omega Plus, the EVALUATION-only provider (lib/ai/config.ts): BATON_ALLOW_EVAL_PROVIDER=1,
//                                fixed model ids. Optional lines: AI_MODEL_EXTRACT, AI_MODEL_VERIFY, OMEGA_OUTPUT_MODE,
//                                OMEGA_API_BASE_URL. Production refuses Omega whatever this file says.
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const GEMINI_MODELS = { extract: "gemini-3.6-flash", verify: "gemini-3.5-flash-lite" };
// Two different fixed ids (VER-1: separate extraction and verification identities). Dynamic `omega` routes are refused.
export const OMEGA_DEFAULT_MODELS = { extract: "claude-sonnet-5-5", verify: "claude-sonnet-5" };

const OMEGA_OPTIONAL = ["AI_MODEL_EXTRACT", "AI_MODEL_VERIFY", "OMEGA_OUTPUT_MODE", "OMEGA_API_BASE_URL"];

/** @returns {{ provider: "gemini" | "omega", set: Record<string, string>, unset: string[], label: string }} */
export function readAiKeyFile(keyFile, repo) {
  const abs = realpathSync(resolve(keyFile));
  const rel = relative(repo, abs);
  if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error("refusing: the key file must be outside the repository");
  const values = {};
  for (const line of readFileSync(abs, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*["']?([^"'\r\n]*?)["']?\s*$/.exec(line);
    if (m && m[2] !== "") values[m[1]] = m[2];
  }
  const unset = ["BATON_ALLOW_FAKE_AI", "AI_DATA_GOVERNANCE"];

  if ((values.OMEGA_API_KEY ?? "").length >= 20) {
    const set = {
      AI_PROVIDER: "omega",
      OMEGA_API_KEY: values.OMEGA_API_KEY,
      BATON_ALLOW_EVAL_PROVIDER: "1",
      AI_MODEL_EXTRACT: OMEGA_DEFAULT_MODELS.extract,
      AI_MODEL_VERIFY: OMEGA_DEFAULT_MODELS.verify,
    };
    for (const k of OMEGA_OPTIONAL) if (values[k]) set[k] = values[k];
    return {
      provider: "omega",
      set,
      unset: [...unset, "AI_API_KEY"],
      label: `REAL omega, evaluation only (${set.AI_MODEL_EXTRACT} / ${set.AI_MODEL_VERIFY}, output ${set.OMEGA_OUTPUT_MODE ?? "json_schema"}), synthetic data only`,
    };
  }
  if ((values.AI_API_KEY ?? "").length >= 20) {
    return {
      provider: "gemini",
      set: { AI_PROVIDER: "gemini", AI_API_KEY: values.AI_API_KEY, AI_MODEL_EXTRACT: GEMINI_MODELS.extract, AI_MODEL_VERIFY: GEMINI_MODELS.verify },
      unset: [...unset, "OMEGA_API_KEY", "BATON_ALLOW_EVAL_PROVIDER"],
      label: `REAL gemini (${GEMINI_MODELS.extract} / ${GEMINI_MODELS.verify}), synthetic data only`,
    };
  }
  throw new Error("refusing: the key file has no AI_API_KEY=<gemini key> or OMEGA_API_KEY=<omega key> line");
}

export function applyAiKeyFile(env, keyFile, repo) {
  const k = readAiKeyFile(keyFile, repo);
  for (const name of k.unset) delete env[name];
  Object.assign(env, k.set);
  return k;
}
