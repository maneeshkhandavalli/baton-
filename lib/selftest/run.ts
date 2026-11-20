/**
 * Builds the /test report. Every check runs in parallel under its own timeout and catches its own errors, so one
 * failure shows as a FAIL row and never breaks the page. The final rows pass through `redactSections` (defence in
 * depth: any secret env value that slipped into a detail is replaced).
 *
 * Dependencies are injected so tests can run the whole pipeline with a fake env, database and fetch.
 */

import {
  aiConfigChecks,
  buildInfoChecks,
  CONNECTOR_PROVIDERS,
  connectorConfigCheck,
  forbiddenFlagChecks,
  identityChecks,
  secretChecks,
  siteUrlCheck,
} from "./env-checks";
import { authCheck, bucketCheck, jobCountChecks, KEY_TABLES, lastRunCheck, tableCheck, workDueCheck, type SelfTestDb } from "./db-checks";
import { redactSections, secretValues } from "./redact";
import { omegaUsageCheck, PAGE_PATHS, pageCheck, telegramWebhookCheck, type FetchLike } from "./remote-checks";
import { fail, ok, summarise, warn, type CheckRow, type CheckSection, type SelfTestEnv, type SelfTestReport } from "./types";
import { parseSiteUrl } from "../supabase/site-url";

export const PER_CHECK_TIMEOUT_MS = 5_000;

/**
 * This build has no vercel.json, so there is no Vercel cron (asserted by lib/selftest/__tests__). On Hobby,
 * processing advances while someone keeps the processing page open (its nudges drain the queue).
 */
export const VERCEL_CRONS_CONFIGURED = false;

export interface SelfTestDeps {
  env: SelfTestEnv;
  now: Date;
  requestOrigin: string | null;
  /** null when the service key is missing (database checks then FAIL with a fixed message). */
  db: () => SelfTestDb | null;
  fetch: FetchLike;
  bucket: string;
  /** Presence of the Supabase service key (from lib/supabase/admin.ts, the only reader of its name). */
  serviceKeyPresent: boolean;
  timeoutMs?: number;
}

class CheckTimeout extends Error {}

/** Runs one check with a timeout; any throw or timeout becomes FAIL rows named `names` with a safe message. */
export async function guarded(names: string | string[], run: () => Promise<CheckRow | CheckRow[]>, timeoutMs = PER_CHECK_TIMEOUT_MS): Promise<CheckRow[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CheckTimeout()), timeoutMs);
      }),
    ]);
    return Array.isArray(result) ? result : [result];
  } catch (e) {
    const why = e instanceof CheckTimeout || (e as { name?: string })?.name === "TimeoutError" ? `timed out after ${Math.round(timeoutMs / 1000)} s` : "check failed (error hidden)";
    return (Array.isArray(names) ? names : [names]).map((n) => fail(n, why));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const sync = (rows: () => CheckRow | CheckRow[]) => async () => rows();

export async function runSelfTest(deps: SelfTestDeps): Promise<SelfTestReport> {
  const { env, now } = deps;
  const t = deps.timeoutMs ?? PER_CHECK_TIMEOUT_MS;
  let dbClient: SelfTestDb | null = null;
  try {
    dbClient = deps.db();
  } catch {
    dbClient = null;
  }
  const withDb = (names: string | string[], run: (db: SelfTestDb) => Promise<CheckRow | CheckRow[]>) =>
    dbClient ? guarded(names, () => run(dbClient!), t) : Promise.resolve((Array.isArray(names) ? names : [names]).map((n) => fail(n, "no service-role client (service key missing)")));

  const site = parseSiteUrl(env.BATON_SITE_URL);
  const telegramOn = connectorConfigCheck(env, "telegram").status === "ok";

  const [config, database, authStorage, worker, connectors, pages, omega, build] = await Promise.all([
    Promise.all([
      guarded("AI configuration", sync(() => aiConfigChecks(env)), t),
      guarded("BATON_SITE_URL", sync(() => siteUrlCheck(env, deps.requestOrigin)), t),
      guarded("Identity pepper", sync(() => identityChecks(env)), t),
      guarded("Secrets", sync(() => secretChecks(env)), t),
      guarded("Production flags", sync(() => forbiddenFlagChecks(env)), t),
      Promise.resolve([deps.serviceKeyPresent ? ok("Supabase service key", "present") : fail("Supabase service key", "not set")]),
    ]).then((r) => r.flat()),
    Promise.all([
      ...KEY_TABLES.map((table) => withDb(`Table ${table}`, (db) => tableCheck(db, table))),
      withDb(["Queued or running jobs", "Active processing runs", "Failed jobs, last 24h"], (db) => jobCountChecks(db, now)),
    ]).then((r) => r.flat()),
    Promise.all([withDb("Supabase Auth", authCheck), withDb(`Storage bucket ${deps.bucket}`, (db) => bucketCheck(db, deps.bucket))]).then((r) => r.flat()),
    Promise.all([
      withDb("Pipeline work due", workDueCheck),
      withDb("Last succeeded run", lastRunCheck),
      Promise.resolve([VERCEL_CRONS_CONFIGURED ? ok("Vercel cron", "configured in vercel.json") : ok("Vercel cron", "none (no vercel.json in this build)")]),
    ]).then((r) => r.flat()),
    Promise.all([
      ...CONNECTOR_PROVIDERS.map((p) => guarded(`${p} configured`, sync(() => connectorConfigCheck(env, p)), t)),
      telegramOn ? guarded("Telegram webhook", () => telegramWebhookCheck(env, deps.fetch), t) : Promise.resolve([] as CheckRow[]),
    ]).then((r) => r.flat()),
    site
      ? Promise.all(PAGE_PATHS.map((p) => guarded(`GET ${p}`, () => pageCheck(site, p, deps.fetch), t))).then((r) => r.flat())
      : Promise.resolve([warn("Pages", "skipped, BATON_SITE_URL is not a safe origin")]),
    env.AI_PROVIDER === "omega" ? guarded("Omega usage", () => omegaUsageCheck(env, deps.fetch), t) : Promise.resolve([] as CheckRow[]),
    guarded("Build", sync(() => buildInfoChecks(env, now)), t),
  ]);

  const sections: CheckSection[] = [
    { id: "config", title: "Config", rows: config },
    { id: "database", title: "Database", rows: database, note: "Read-only counts through the service-role client. Latest migration version is not shown (no read API for it)." },
    { id: "auth-storage", title: "Auth and storage", rows: authStorage },
    {
      id: "worker",
      title: "Processing worker",
      rows: worker,
      note: "On Vercel Hobby there is no frequent cron: processing completes while the processing page is open (it nudges the worker).",
    },
    { id: "connectors", title: "Connectors", rows: connectors },
    { id: "pages", title: "Pages", rows: pages, note: site ? `Fetched from ${new URL(site).host} without following redirects.` : undefined },
    ...(omega.length ? [{ id: "omega", title: "Omega usage", rows: omega }] : []),
    { id: "build", title: "Build info", rows: build },
  ];
  const safe = redactSections(sections, secretValues(env));
  return { generatedAt: now.toISOString(), sections: safe, summary: summarise(safe) };
}
