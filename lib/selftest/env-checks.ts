/**
 * Environment checks for /test. Pure functions of the environment passed in (testable with a fake env).
 * They report presence, lengths, names, versions, hosts and model ids only: never a secret value.
 */

import { aiDataGovernanceProfile, getAiConfiguration } from "../ai/config";
import { CONNECTOR_ENV, connectorConfigured } from "../connectors/config";
import type { ConnectorProvider } from "../connectors/types";
import { verifyIdentityPepper } from "../pipeline/pepper-core";
import { parseIdentityMapKey } from "../privacy/identity-vault";
import { parseSiteUrl } from "../supabase/site-url";
import { fail, ok, warn, type CheckRow, type SelfTestEnv } from "./types";

const MIN_SECRET = 32;

const isSet = (env: SelfTestEnv, k: string) => typeof env[k] === "string" && env[k]!.trim() !== "";

export function aiConfigChecks(env: SelfTestEnv): CheckRow[] {
  const config = getAiConfiguration({ ...env });
  const profile = aiDataGovernanceProfile({ ...env });
  const rows: CheckRow[] = [];
  if (config.ok) {
    rows.push(ok("AI configuration", `mode ${config.mode}, provider ${config.provider.id} (${config.provider.displayName})`));
    rows.push(ok("AI models", `extract ${config.runConfig.extract.model}, verify ${config.runConfig.verify.model}`));
  } else {
    const why = config.detail === "data_governance_unapproved" ? "data governance profile not approved for this provider" : "provider not configured";
    rows.push(fail("AI configuration", `${why} (AI_PROVIDER ${isSet(env, "AI_PROVIDER") ? `"${String(env.AI_PROVIDER).slice(0, 20)}"` : "unset"})`));
  }
  rows.push(profile ? ok("Data governance profile", profile) : warn("Data governance profile", "AI_DATA_GOVERNANCE is not set"));
  return rows;
}

/** BATON_SITE_URL must be a safe origin and should equal the origin this request was served from. */
export function siteUrlCheck(env: SelfTestEnv, requestOrigin: string | null): CheckRow {
  const site = parseSiteUrl(env.BATON_SITE_URL);
  if (!isSet(env, "BATON_SITE_URL")) return fail("BATON_SITE_URL", "not set");
  if (!site) return fail("BATON_SITE_URL", "set, but not a safe absolute origin");
  const siteHost = new URL(site).host;
  if (!requestOrigin) return warn("BATON_SITE_URL", `${siteHost}; request origin unknown`);
  let reqHost: string;
  try {
    reqHost = new URL(requestOrigin).host;
  } catch {
    return warn("BATON_SITE_URL", `${siteHost}; request origin unreadable`);
  }
  return siteHost === reqHost ? ok("BATON_SITE_URL", `${siteHost}, matches this request`) : warn("BATON_SITE_URL", `${siteHost}, but this request came to ${reqHost}`);
}

export function identityChecks(env: SelfTestEnv): CheckRow[] {
  const pepper = verifyIdentityPepper({ ...env });
  const pepperRow = pepper.ok
    ? ok("Identity pepper", `present and verified against the canary, version ${pepper.data.version}`)
    : fail("Identity pepper", `not verified (check: ${String((pepper.error.details as { check?: string } | undefined)?.check ?? "unknown")}), version ${isSet(env, "IDENTITY_PEPPER_VERSION") ? String(env.IDENTITY_PEPPER_VERSION).slice(0, 8) : "unset"}`);
  const key = parseIdentityMapKey(env.IDENTITY_MAP_KEY, env.IDENTITY_MAP_KEY_VERSION);
  const keyRow = key.ok ? ok("Identity map key", `present and valid, version ${key.key.version}`) : fail("Identity map key", key.reason === "missing" ? "not set" : "set, but invalid (needs 32 bytes as 64 hex or base64, version k1)");
  return [pepperRow, keyRow];
}

function secretRow(env: SelfTestEnv, name: string): CheckRow {
  if (!isSet(env, name)) return fail(name, "not set");
  const len = env[name]!.trim().length;
  return len >= MIN_SECRET ? ok(name, `present, at least ${MIN_SECRET} chars`) : fail(name, `present, but shorter than ${MIN_SECRET} chars`);
}

export function secretChecks(env: SelfTestEnv): CheckRow[] {
  const rows = ["CRON_SECRET", "CONNECTOR_STATE_SECRET", "CONNECTOR_SECRET_KEY", "CONNECTOR_SYNC_SECRET"].map((n) => secretRow(env, n));
  if (isSet(env, "CONNECTOR_SYNC_SECRET") && isSet(env, "CRON_SECRET")) {
    rows.push(
      env.CONNECTOR_SYNC_SECRET!.trim() === env.CRON_SECRET!.trim()
        ? fail("Sync secret differs from cron secret", "CONNECTOR_SYNC_SECRET equals CRON_SECRET; they must differ")
        : ok("Sync secret differs from cron secret", "yes"),
    );
  }
  return rows;
}

/** Development-only switches that must never be set in a production build. */
export const FORBIDDEN_IN_PRODUCTION = ["BATON_ALLOW_FAKE_AI", "BATON_ALLOW_EVAL_PROVIDER", "BATON_DEV_WORKER"] as const;

export function forbiddenFlagChecks(env: SelfTestEnv): CheckRow[] {
  const production = env.NODE_ENV === "production";
  return FORBIDDEN_IN_PRODUCTION.map((name) => {
    const set = typeof env[name] === "string" && env[name] !== "";
    if (!set) return ok(name, "not set");
    return production ? fail(name, "set in a production build; remove it") : warn(name, `set (allowed only because NODE_ENV is ${env.NODE_ENV ?? "unset"})`);
  });
}

export const CONNECTOR_PROVIDERS: readonly ConnectorProvider[] = ["telegram", "discord", "slack", "github"];

/** Configured or not, with the names (never values) of missing variables. */
export function connectorConfigCheck(env: SelfTestEnv, provider: ConnectorProvider): CheckRow {
  if (connectorConfigured(provider, { ...env })) return ok(`${provider} configured`, "all variables present");
  const missing = CONNECTOR_ENV[provider].filter((k) => !isSet(env, k));
  const shared = ["BATON_SITE_URL", "CONNECTOR_STATE_SECRET", "CONNECTOR_SECRET_KEY"].filter((k) => !isSet(env, k) || (k !== "BATON_SITE_URL" && env[k]!.trim().length < MIN_SECRET));
  const all = [...missing, ...shared];
  return warn(`${provider} configured`, all.length ? `not configured; missing or too short: ${all.join(", ")}` : "not configured");
}

export function buildInfoChecks(env: SelfTestEnv, now: Date): CheckRow[] {
  const sha = (env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
  return [
    sha ? ok("Commit", sha.slice(0, 7)) : warn("Commit", "VERCEL_GIT_COMMIT_SHA not available"),
    ok("Deployment", `${env.VERCEL_ENV ? `Vercel ${env.VERCEL_ENV}` : "not on Vercel"}, NODE_ENV ${env.NODE_ENV ?? "unset"}${env.VERCEL_REGION ? `, region ${env.VERCEL_REGION}` : ""}`),
    ok("Server time", now.toISOString()),
  ];
}
