/**
 * What the server actions depend on (§11.1, D35). The real object is built once, server-only, in
 * lib/actions/deps.ts and has no override; tests pass their own fakes straight to the core functions.
 */

import type { ConsentDisclosure } from "../../contracts/consent";
import type { Result } from "../../contracts/api";
import type { PreviewSourceFn } from "../../contracts/parser";
import type { BatonQueries } from "../../contracts/queries";
import type { AiRunConfig, PlanInput, ProcessingPlan } from "../../pipeline/plan";
import type { VerifiedActor } from "../../db/actor-rules";
import type { DbClient } from "../../db/client";
import type { StorageClient } from "../../db/storage";
import type { EmailTransport } from "../../email/core";

export interface ActionDeps {
  /** The actor of the verified session (`auth.getUser()`), or null. The ONLY source of identity. */
  getActor(): Promise<VerifiedActor | null>;
  /** Service-role client for lib/db mutations; every SQL function re-checks the actor (§8.3). */
  adminDb(): DbClient;
  /** User-scoped client (RLS) for reads outside BatonQueries. */
  userDb(): Promise<DbClient>;
  /** User-scoped, RLS-protected reads used to re-read DTOs after a mutation. */
  queries: BatonQueries;
  userStorage(): Promise<StorageClient>;
  adminStorage(): StorageClient;
  /** For rate limiting only (§12.4). */
  clientIp(): Promise<string | null>;
  /** The trusted origin from BATON_SITE_URL (§12.3). Throws when it is missing or unsafe. */
  siteOrigin(): string;
  /**
   * The server's AI run configuration (lib/ai `getAiConfiguration().runConfig`), or precondition_failed with
   * `details.reason = "provider_not_configured"`. Its `provider` is what consent records (I3 amendment 1).
   */
  aiRunConfig(): Result<AiRunConfig>;
  /**
   * R3 Task 05E: the consent wording for the SAME server configuration (lib/ai getConsentDisclosure). Consent is
   * accepted only for exactly this statement version; the client's version or provider is never trusted.
   */
  consentDisclosure(): ConsentDisclosure;
  /** The verified identity pepper (lib/pipeline `getVerifiedPepper`); fails closed (D27, D30). */
  verifiedPepper(): Result<{ pepper: string; version: "p1" }>;
  /** The parser's read-only preview (lib/parsers `previewSource`). */
  previewParser: PreviewSourceFn;
  /** Pure run planning (lib/pipeline `planProcessingRun`). */
  planProcessingRun(input: PlanInput): Result<ProcessingPlan>;
  /** Fire-and-forget drain after the response (lib/pipeline `scheduleDrain`); never throws. */
  scheduleDrain(): void;
  /** Refreshes the client router after a successful write. */
  revalidate(): void;
  /** Account deletion (§12.9): the auth side, server-only (lib/supabase/account-auth.ts). */
  accountAuth: {
    /** Soft-deletes the actor's auth user (Admin API deleteUser(id, true)); throws when it could not. */
    softDeleteUser(profileId: string): Promise<void>;
    /** Ends this browser's session (Supabase cookies). Never throws. */
    endSession(): Promise<void>;
  };
  /** Server log for a cleanup step that failed after the point of no return (ids and counts only). */
  logIssue(event: string, details: Record<string, string | number>): void;
  /**
   * R3 Task 06: the invitation email transport (lib/email). Not configured unless RESEND_API_KEY and BATON_EMAIL_FROM
   * are set; tests pass a fake. Never reachable from the demo.
   */
  email(): EmailTransport;
}
