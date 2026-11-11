/**
 * Test control of the framework/platform stubs (support/stubs/*.mjs): the signed-in user the Supabase Auth
 * server would report, request headers, cookies and the `after()` queue. Synthetic values only.
 */

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
