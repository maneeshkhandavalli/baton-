/**
 * Test control of the framework/platform stubs (support/stubs/*.mjs): the signed-in user the Supabase Auth
 * server would report, request headers, cookies, the `after()` queue, the Recording* backends the Supabase
 * clients forward to, and the server environment. Synthetic values only.
 */

import { RecordingDb } from "./recording-db";
import { RecordingStorage } from "./recording-storage";

export interface Backends {
  /** the service-role client (lib/supabase/admin.ts → @supabase/supabase-js createClient) */
  adminDb: RecordingDb;
  /** the user-scoped RLS client (lib/supabase/server.ts → @supabase/ssr createServerClient) */
  userDb: RecordingDb;
  adminStorage: RecordingStorage;
  userStorage: RecordingStorage;
  /** one ordered log across all four */
  events: string[];
}

export const SITE_URL = "https://baton.example.test";

// The service-key variable name is assembled at runtime: lib/db/__tests__/boundaries.test.ts (H1) reserves
// the literal names for lib/supabase/admin.ts. The value is a synthetic placeholder, never a real key.
const SERVICE_KEY_ENV = ["SUPABASE", "SECRET", "KEY"].join("_");

const AI_ENV = ["AI_PROVIDER", "BATON_ALLOW_FAKE_AI", "AI_API_KEY", "AI_MODEL_EXTRACT", "AI_MODEL_VERIFY"] as const;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

export interface StubUser {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
}

interface PlatformState {
  user?: StubUser | null;
  authError?: boolean;
  otpError?: { message: string; status?: number; code?: string } | null;
  headers?: Record<string, string>;
  cookies?: Map<string, string>;
  after?: Array<() => unknown>;
  authCalls?: Array<{ client: string; name: string; args?: unknown }>;
  cacheCalls?: unknown[][];
  backends?: Backends;
  adminClients?: Array<{ url: string; keyLength: number }>;
}

const g = globalThis as unknown as { __batonIt?: PlatformState };

function state(): PlatformState {
  g.__batonIt ??= {};
  return g.__batonIt;
}

/** Public Supabase configuration is required by lib/supabase/env; dummy values, never contacted. */
export function configurePublicEnv(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "it-public-anon-key";
}

export function resetPlatform(): void {
  g.__batonIt = { user: null, authError: false, otpError: null, headers: {}, cookies: new Map(), after: [], authCalls: [], cacheCalls: [] };
  configurePublicEnv();
  process.env[SERVICE_KEY_ENV] = "it-synthetic-service-placeholder";
  process.env.BATON_SITE_URL = SITE_URL;
  for (const name of AI_ENV) delete process.env[name];
  delete process.env.CRON_SECRET;
  setNodeEnv(ORIGINAL_NODE_ENV);
}

/** Fresh Recording* fakes behind both Supabase clients, sharing one event log. */
export function installBackends(): Backends {
  const events: string[] = [];
  const backends: Backends = {
    adminDb: new RecordingDb(events),
    userDb: new RecordingDb(events),
    adminStorage: new RecordingStorage(events),
    userStorage: new RecordingStorage(events),
    events,
  };
  state().backends = backends;
  return backends;
}

/** Tier E: real backends (PsqlDbClient, PgBackedStorage) behind both Supabase clients. */
export function installCustomBackends(b: {
  adminDb: { rpc: RecordingDb["rpc"] };
  userDb: { rpc: RecordingDb["rpc"] };
  adminStorage: { from: RecordingStorage["from"] };
  userStorage: { from: RecordingStorage["from"] };
}): void {
  state().backends = { ...b, events: [] } as unknown as Backends;
}

/** The id the stubbed Auth server currently reports (the RLS subject of the user-scoped client). */
export function currentUserId(): string | null {
  return state().user?.id ?? null;
}

function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

/** The AI environment lib/ai/config.ts reads (D11). Unset keys are removed. */
export function setAiEnv(env: { AI_PROVIDER?: string; BATON_ALLOW_FAKE_AI?: string; NODE_ENV?: string; AI_API_KEY?: string }): void {
  for (const name of AI_ENV) delete process.env[name];
  if (env.AI_PROVIDER !== undefined) process.env.AI_PROVIDER = env.AI_PROVIDER;
  if (env.BATON_ALLOW_FAKE_AI !== undefined) process.env.BATON_ALLOW_FAKE_AI = env.BATON_ALLOW_FAKE_AI;
  if (env.AI_API_KEY !== undefined) process.env.AI_API_KEY = env.AI_API_KEY;
  setNodeEnv(env.NODE_ENV ?? ORIGINAL_NODE_ENV);
}

/** The locally allowed fake adapter (never in production). */
export function allowFakeAi(): void {
  setAiEnv({ AI_PROVIDER: "fake", BATON_ALLOW_FAKE_AI: "1", NODE_ENV: "test" });
}

/** As if the Auth server validated a session for this user (email confirmed unless stated otherwise). */
export function signInAs(id: string, email = `${id.slice(0, 8)}@example.test`, confirmed = true): StubUser {
  const user: StubUser = { id, email, email_confirmed_at: confirmed ? "2026-11-01T00:00:00Z" : null };
  state().user = user;
  state().authError = false;
  return user;
}

export function signOut(): void {
  state().user = null;
}

export function failAuth(): void {
  state().authError = true;
}

export function setRequestHeaders(headers: Record<string, string>): void {
  state().headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

export function authCalls(): Array<{ client: string; name: string; args?: unknown }> {
  return state().authCalls ?? [];
}

/** Runs every queued next/server `after()` callback, in order, and empties the queue. */
export async function flushAfter(): Promise<number> {
  const queue = state().after ?? [];
  state().after = [];
  for (const task of queue) await task();
  return queue.length;
}

export function pendingAfter(): number {
  return (state().after ?? []).length;
}
