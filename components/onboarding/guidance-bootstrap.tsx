import { connection } from "next/server";

import { getQueries } from "@/lib/data";
import { guidanceFor, loadGuidanceRoles } from "@/lib/onboarding/load";
import { readSessionOnboarding } from "@/lib/onboarding/server";
import { routes } from "@/lib/routes";

import { GuidanceInit } from "./guidance";

export const GUIDANCE_PATHS = { dashboard: routes.dashboard, newHandover: routes.handover.new, published: routes.handover.published };
export const CHECKLIST_HREF = `${routes.dashboard}?checklist=show#getting-started`;

/**
 * Round 4 (Worker 02): the signed-in user's guidance data for the workspace shell (render inside <Suspense>).
 * Signed out, or when their handovers can't be read (so their role is unknown), it renders nothing: no guess
 * is ever made about which role's guidance to show.
 */
export async function GuidanceBootstrap() {
  await connection(); // session reads check token expiry against the current time; request-time only
  const session = await readSessionOnboarding();
  if (!session) return null;
  const loaded = await loadGuidanceRoles(getQueries());
  if (!loaded) return null;
  const { tours } = guidanceFor(loaded.handovers, loaded.roles, GUIDANCE_PATHS);
  return (
    <GuidanceInit
      data={{ state: session.state, roles: loaded.roles, tours, firstName: session.firstName, checklistHref: CHECKLIST_HREF, persist: true }}
    />
  );
}
