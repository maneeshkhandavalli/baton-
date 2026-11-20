/**
 * Round 4 (Worker 02): loads what the guidance needs through the existing BatonQueries (RLS, the user's session):
 * the user's roles and focus handovers (listMyHandovers) and, for the checklist, the focus handover's real state.
 * Takes the queries as a parameter, so previews pass createMockQueries() and render exactly the same components.
 */

import type { HandoverSummary } from "../contracts/dto";
import type { BatonQueries } from "../contracts/queries";
import { creatorChecklist, incomingChecklist, type Checklist, type ChecklistLinks } from "./checklist";
import { resolveGuideRoles, type GuideRoles } from "./role";
import type { GuideRole, OnboardingState } from "./state";
import { resolveTourSteps, tourAvailable, type TourPaths, type TourStep } from "./tour";

export interface GuidanceData {
  roles: GuideRoles;
  /** Each role's tour, resolved for this user (an empty list when it has nothing to show yet). */
  tours: Partial<Record<GuideRole, TourStep[]>>;
}

export async function loadGuidanceRoles(queries: BatonQueries): Promise<{ handovers: HandoverSummary[]; roles: GuideRoles } | null> {
  const list = await queries.listMyHandovers();
  if (!list.ok) return null;
  return { handovers: list.data, roles: resolveGuideRoles(list.data) };
}

export function guidanceFor(handovers: readonly HandoverSummary[], roles: GuideRoles, paths: TourPaths): GuidanceData {
  const tours: Partial<Record<GuideRole, TourStep[]>> = {};
  for (const role of roles.roles) {
    const focus = handovers.find((h) => h.id === roles.focus[role]) ?? null;
    const steps = resolveTourSteps(role, { focusHandoverId: focus?.id ?? null, published: !!focus?.currentPublicationId, acknowledges: focus?.viewerRole === "incoming" }, paths);
    tours[role] = tourAvailable(steps) ? steps : [];
  }
  return { roles, tours };
}

/** The checklist for one role, from the focus handover's real state. Failed reads stay "not done". */
export async function loadChecklist(
  queries: BatonQueries,
  handovers: readonly HandoverSummary[],
  roles: GuideRoles,
  role: GuideRole,
  state: OnboardingState,
  links: ChecklistLinks,
): Promise<Checklist> {
  const h = handovers.find((x) => x.id === roles.focus[role]) ?? null;
  const data = <T>(r: { ok: true; data: T } | { ok: false }) => (r.ok ? r.data : null);

  if (role === "incoming") {
    const published = h?.currentPublicationId ? data(await queries.getPublishedHandover(h.id)) : null;
    return incomingChecklist({ handover: h, published, publishedOpenedAt: state.publishedOpenedAt ?? null }, links);
  }
  if (!h) return creatorChecklist({ handover: null }, links);

  const early = h.state === "draft" || h.state === "processing";
  const [sources, processing, readiness, members, invites] = await Promise.all([
    queries.listSources(h.id),
    early ? queries.getProcessingStatus(h.id) : Promise.resolve(null),
    early ? Promise.resolve(null) : queries.getReadiness(h.id),
    h.viewerIsCreator ? queries.listMembers(h.id) : Promise.resolve(null),
    h.viewerIsCreator ? queries.listAccessTokens(h.id, { purpose: "member_invite", activeOnly: true }) : Promise.resolve(null),
  ]);
  return creatorChecklist(
    {
      handover: h,
      sources: data(sources),
      processing: processing && data(processing),
      readiness: readiness && data(readiness),
      members: members && data(members),
      invites: invites && data(invites),
    },
    links,
  );
}
