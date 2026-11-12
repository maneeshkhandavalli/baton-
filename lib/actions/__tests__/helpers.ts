// Test doubles for lib/actions/core (no database, no Next.js). Synthetic data only.
import type { Result } from "../../contracts/api";
import type { PreviewSourceFn, PreviewSourceInput } from "../../contracts/parser";
import type { BatonQueries } from "../../contracts/queries";
import type { VerifiedActor } from "../../db/actor-rules";
import type { DbClient } from "../../db/client";
import type { StorageClient } from "../../db/storage";
import type { AiRunConfig, PlanInput, ProcessingPlan } from "../../pipeline/plan";
import type { ActionDeps } from "../core/types";

/** Synthetic, not a secret: never valid anywhere (no canary matches it). */
export const TEST_PEPPER = "synthetic-test-pepper-not-a-secret-0123456789";

export const PROVIDER_NOT_CONFIGURED: Result<never> = {
  ok: false,
  error: { code: "precondition_failed", message: "This can't be done yet.", retryable: false, details: { reason: "provider_not_configured" } },
};

export const FAKE_RUN_CONFIG: AiRunConfig = {
  provider: "fake",
  adapterVersion: "fake@1",
  extract: { model: "fake-extract", promptVersion: "p1", schemaVersion: "s1" },
  verify: { model: "fake-verify", promptVersion: "p1", schemaVersion: "s1" },
};

export const H = "11111111-1111-4111-8111-111111111111";
export const P = "22222222-2222-4222-8222-222222222222";
export const S = "33333333-3333-4333-8333-333333333333";
export const ACTOR_ID = "44444444-4444-4444-8444-444444444444";
export const OTHER_ID = "55555555-5555-4555-8555-555555555555";
export const NEW_ID = "66666666-6666-4666-8666-666666666666";
export const ORIGIN = "https://baton.example.test";

/** Synthetic values the masker must catch (from the identity golden vectors; not real people). */
export const SYNTHETIC_PHONE = "+91 99999 00001";
export const SYNTHETIC_EMAIL = "someone@example.test";

export const ACTOR = Object.freeze({ profileId: ACTOR_ID, email: "member@example.test", emailConfirmed: true }) as VerifiedActor;

type RpcResponse = { data?: unknown; error?: { code?: string; message: string } };
export type RpcHandler = RpcResponse | ((args: Record<string, unknown> | undefined) => RpcResponse);

export interface Call {
  fn: string;
  args?: Record<string, unknown>;
  client: "admin" | "user";
}

export interface StorageCall {
  op: "createSignedUploadUrl" | "download" | "remove";
  path: string | string[];
}

const QUERY_NAMES = [
  "listMyHandovers",
  "getHandover",
  "listMembers",
  "listSources",
  "listParticipants",
  "listExclusions",
  "getProcessingStatus",
  "listPoints",
  "getPoint",
  "getSourceMessageContext",
  "listGapQuestions",
  "getReadiness",
  "getPublishedHandover",
  "listAccessTokens",
  "listMyCreatorTransferOffers",
  "getGapInterview",
] as const satisfies ReadonlyArray<keyof BatonQueries>;

export interface FakeOptions {
  actor?: VerifiedActor | null;
  rpc?: Record<string, RpcHandler>;
  queries?: Partial<Record<keyof BatonQueries, (...args: unknown[]) => Promise<Result<unknown>>>>;
  siteOrigin?: () => string;
  aiRunConfig?: () => Result<AiRunConfig>;
  verifiedPepper?: () => Result<{ pepper: string; version: "p1" }>;
  previewParser?: PreviewSourceFn;
  planProcessingRun?: (input: PlanInput) => Result<ProcessingPlan>;
  scheduleDrainThrows?: boolean;
  storage?: { download?: Blob | null; removeError?: boolean };
  clientIp?: string | null;
}

export function fakeDeps(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const queryCalls: Array<{ name: string; args: unknown[] }> = [];
  const storageCalls: StorageCall[] = [];
  const parserInputs: PreviewSourceInput[] = [];
  const planInputs: PlanInput[] = [];
  /** RPC names and "scheduleDrain", in call order. */
  const events: string[] = [];
  let actorLookups = 0;
  let refreshes = 0;

  const client = (kind: "admin" | "user"): DbClient => ({
    rpc: async (fn, args) => {
      calls.push({ fn, args, client: kind });
      events.push(fn);
      const handler = options.rpc?.[fn];
      const r = typeof handler === "function" ? handler(args) : (handler ?? { data: null });
      return { data: r.data ?? null, error: r.error ?? null };
    },
  });

  const storage: StorageClient = {
    from: () => ({
      createSignedUploadUrl: async (path) => {
        storageCalls.push({ op: "createSignedUploadUrl", path });
        return { data: { signedUrl: `${ORIGIN}/storage/upload`, token: "upload-token", path }, error: null };
      },
      download: async (path) => {
        storageCalls.push({ op: "download", path });
        const blob = options.storage?.download ?? null;
        return blob ? { data: blob, error: null } : { data: null, error: { message: "missing" } };
      },
      remove: async (paths) => {
        storageCalls.push({ op: "remove", path: paths });
        return options.storage?.removeError ? { data: null, error: { message: "unavailable" } } : { data: [], error: null };
      },
    }),
  };

  const queries = Object.fromEntries(
    QUERY_NAMES.map((name) => [
      name,
      async (...args: unknown[]) => {
        queryCalls.push({ name, args });
        const impl = options.queries?.[name];
        if (impl) return impl(...args);
        return { ok: false, error: { code: "not_found", message: "We couldn't find that.", retryable: false } };
      },
    ]),
  ) as unknown as BatonQueries;

  const deps: ActionDeps = {
    getActor: async () => {
      actorLookups++;
      return options.actor === undefined ? ACTOR : options.actor;
    },
    adminDb: () => client("admin"),
    userDb: async () => client("user"),
    queries,
    userStorage: async () => storage,
    adminStorage: () => storage,
    clientIp: async () => (options.clientIp === undefined ? "203.0.113.7" : options.clientIp),
    siteOrigin: options.siteOrigin ?? (() => ORIGIN),
    aiRunConfig: options.aiRunConfig ?? (() => PROVIDER_NOT_CONFIGURED),
    verifiedPepper: options.verifiedPepper ?? (() => ({ ok: true, data: { pepper: TEST_PEPPER, version: "p1" } })),
    previewParser: async (input) => {
      parserInputs.push(input);
      if (options.previewParser) return options.previewParser(input);
      throw new Error("previewParser not expected in this test");
    },
    planProcessingRun: (input) => {
      planInputs.push(input);
      if (options.planProcessingRun) return options.planProcessingRun(input);
      throw new Error("planProcessingRun not expected in this test");
    },
    scheduleDrain: () => {
      events.push("scheduleDrain");
      if (options.scheduleDrainThrows) throw new Error("outside a request");
    },
    revalidate: () => {
      refreshes++;
    },
  };

  return {
    deps,
    calls,
    queryCalls,
    storageCalls,
    parserInputs,
    planInputs,
    events,
    get actorLookups() {
      return actorLookups;
    },
    get refreshes() {
      return refreshes;
    },
    fns: () => calls.map((c) => c.fn),
  };
}

/** Every string value anywhere in `value`, for "no raw PII reached the database" assertions. */
export function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}
