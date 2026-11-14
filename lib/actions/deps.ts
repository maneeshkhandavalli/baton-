import "server-only";

/**
 * The real dependencies of the server actions, built once per process. There is deliberately no setter,
 * override or reset: the actor comes only from the verified session (`requireVerifiedActor`, which uses
 * `auth.getUser()`), and tests exercise lib/actions/core with their own fakes instead.
 */

import { refresh } from "next/cache";

import { getAiConfiguration } from "../ai/config";
import type { Result } from "../contracts/api";
import { dbQueries, serverDb, serverStorage, userDb, userStorage } from "../db";
import { previewSource } from "../parsers/parse-source";
import { getVerifiedPepper } from "../pipeline/pepper";
import { planProcessingRun, type AiRunConfig } from "../pipeline/plan";
import { scheduleDrain } from "../pipeline/worker";
import { requireVerifiedActor } from "../supabase/auth";
import { requestClientIp } from "../supabase/request-ip";
import { getSiteUrl } from "../supabase/site-url";
import { failWith } from "./core/run";
import type { ActionDeps } from "./core/types";

/**
 * The server's AI run configuration (lib/ai, the only reader of the AI environment). D11 is open, so outside
 * an explicitly allowed fake adapter this is provider_not_configured and nothing is written.
 */
function aiRunConfig(): Result<AiRunConfig> {
  const config = getAiConfiguration();
  if (!config.ok) {
    return failWith("precondition_failed", {
      message: "AI processing isn't set up on this server yet. Ask the workspace admin.",
      details: { reason: "provider_not_configured" },
    });
  }
  return { ok: true, data: config.runConfig };
}

const DEPS: ActionDeps = Object.freeze({
  getActor: requireVerifiedActor,
  adminDb: serverDb,
  userDb,
  queries: dbQueries,
  userStorage,
  adminStorage: serverStorage,
  clientIp: requestClientIp,
  siteOrigin: getSiteUrl,
  aiRunConfig,
  verifiedPepper: getVerifiedPepper,
  previewParser: previewSource,
  planProcessingRun,
  scheduleDrain,
  revalidate: () => refresh(),
});

export function actionDeps(): ActionDeps {
  return DEPS;
}
