import type { BatonQueries } from "@/lib/contracts/queries";
import { guidanceFor, loadGuidanceRoles } from "@/lib/onboarding/load";
import { resolveGuideRoles } from "@/lib/onboarding/role";
import { EMPTY_ONBOARDING } from "@/lib/onboarding/state";
import { PROFILES, MOCK_VIEWER_ID } from "@/lib/mocks/fixtures/profiles";
import { createMockQueries } from "@/lib/mocks/queries";

import type { GuidanceInitData } from "./guidance";
import { PreviewGuidanceInit, type PreviewGuide } from "./preview-guidance";

/** The preview pages a tour step points at (dev only). */
const previewPaths = (guide: PreviewGuide) => ({ dashboard: `/preview/dashboard?guide=${guide}`, newHandover: "/preview/wizard?step=1", published: () => "/preview/published" });

export function previewQueries(guide: PreviewGuide): BatonQueries {
  return createMockQueries(guide === "incoming" ? PROFILES.neha.id : MOCK_VIEWER_ID);
}

async function dataFor(guide: PreviewGuide): Promise<GuidanceInitData> {
  const loaded = guide === "new" ? { handovers: [], roles: resolveGuideRoles([]) } : await loadGuidanceRoles(previewQueries(guide));
  const handovers = loaded?.handovers ?? [];
  const roles = loaded?.roles ?? resolveGuideRoles([]);
  const { tours } = guidanceFor(handovers, roles, previewPaths(guide));
  const firstName = guide === "incoming" ? PROFILES.neha.displayName.split(" ")[0] : PROFILES.priya.displayName.split(" ")[0];
  return { state: EMPTY_ONBOARDING, roles, tours, firstName, checklistHref: `/preview/dashboard?guide=${guide}&checklist=show#getting-started`, persist: false };
}

/** Server part of the preview guidance: every option computed from synthetic data, the client picks one. */
export async function PreviewGuidance() {
  const [creator, incoming, fresh] = await Promise.all([dataFor("creator"), dataFor("incoming"), dataFor("new")]);
  return <PreviewGuidanceInit options={{ creator, incoming, new: fresh }} />;
}
