import "server-only";

/**
 * The real dependencies of the server actions, built once per process. There is deliberately no setter,
 * override or reset: the actor comes only from the verified session (`requireVerifiedActor`, which uses
 * `auth.getUser()`), and tests exercise lib/actions/core with their own fakes instead.
 */

import { refresh } from "next/cache";

import type { Result } from "../contracts/api";
import { dbQueries, serverDb, serverStorage, userDb, userStorage } from "../db";
import { requireVerifiedActor } from "../supabase/auth";
import { requestClientIp } from "../supabase/request-ip";
import { getSiteUrl } from "../supabase/site-url";
import { failWith } from "./core/run";
import type { ActionDeps } from "./core/types";

/**
 * B3 wires this to lib/ai `getAiConfiguration()` (`runConfig.provider`). Until lib/ai is merged no provider
 * is configured (D11 open), so consent fails closed and nothing is written.
 */
function consentProvider(): Result<string> {
  return failWith("precondition_failed", { details: { reason: "provider_not_configured" } });
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
  consentProvider,
  revalidate: () => refresh(),
});

export function actionDeps(): ActionDeps {
  return DEPS;
}
