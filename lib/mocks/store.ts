/**
 * In-memory mock store, shared by the mock queries (server components) and the mock actions
 * ("use server"). It lives on `globalThis` so every module instance and dev HMR reload sees the
 * same data. It resets when the server restarts.
 */

import { PIPELINE_STAGES, type PipelineStage, type RunStatus } from "@/lib/contracts/enums";

import { currentRevision, pointStatus, snapshotPoint, profileLabel } from "./derive";
import {
  CODECELL_ID,
  CODECELL_V1_KNOWN_GAPS,
  CODECELL_V1_POINT_NUMBERS,
  codecellExclusions,
  codecellGapQuestions,
  codecellHandover,
  codecellMembers,
  codecellParticipants,
  codecellPoints,
  codecellSources,
  codecellTokens,
} from "./fixtures/codecell";
import { previewFor } from "./exclusions";
import { generatePoints } from "./fixtures/generated";
import {
  ECELL_ID,
  ROBOTICS_ID,
  TEDX_ID,
  otherHandovers,
  otherMembers,
  otherRuns,
  otherSources,
  otherTokens,
} from "./fixtures/others";
import { MOCK_VIEWER_ID, PROFILES } from "./fixtures/profiles";
import { NS, newId, seedId } from "./ids";
import type { MockGapQuestion, MockPoint, MockPublication, MockRun, MockStore } from "./types";

function publication(
  store: MockStore,
  id: string,
  handoverId: string,
  points: MockPoint[],
  o: { version: number; publishedAt: string; publishedBy: string; summary: string | null; knownGaps?: string[] },
): MockPublication {
  const label = (pid: string) => profileLabel(store, pid);
  return {
    id,
    handoverId,
    version: o.version,
    publishedAt: o.publishedAt,
    publishedBy: o.publishedBy,
    summary: o.summary,
    points: points.map((p) => {
      const snap = snapshotPoint(store, p, label);
      if (o.knownGaps?.includes(p.id)) snap.content = { ...snap.content, isKnownGap: true };
      return snap;
    }),
    acknowledgements: [],
  };
}

function seed(): MockStore {
  const now = Date.now();
  const store: MockStore = {
    viewerId: process.env.BATON_MOCK_SCENARIO === "empty" ? seedId(NS.profile, 999) : MOCK_VIEWER_ID,
    readerSessionId: null,
    profiles: Object.values(PROFILES),
    handovers: [{ ...codecellHandover }, ...otherHandovers(now)],
    members: [...codecellMembers.map((m) => ({ ...m })), ...otherMembers()],
    sources: [...Object.values(codecellSources).map((s) => ({ ...s })), ...otherSources()],
    participants: codecellParticipants.map((p) => ({ ...p })),
    exclusions: codecellExclusions.map((e) => ({ ...e })),
    identityConfirmations: [],
    points: structuredClone(codecellPoints),
    gapQuestions: structuredClone(codecellGapQuestions),
    tokens: [...codecellTokens.map((t) => ({ ...t })), ...otherTokens()],
    publications: [],
    runs: otherRuns(now),
  };

  const sourcesOf = (hid: string) => store.sources.filter((s) => s.handoverId === hid);
  const robotics = generatePoints({ handoverId: ROBOTICS_ID, base: 1000, teamName: "Robotics Society", sources: sourcesOf(ROBOTICS_ID), mode: "approved", reviewerProfileId: PROFILES.priya.id, reviewerLabel: PROFILES.priya.displayName, at: "2026-10-30T09:00:00.000Z" });
  const tedx = generatePoints({ handoverId: TEDX_ID, base: 2000, teamName: "TEDx Campus", sources: sourcesOf(TEDX_ID), mode: "approved", reviewerProfileId: PROFILES.priya.id, reviewerLabel: PROFILES.priya.displayName, at: "2026-07-20T10:00:00.000Z" });
  const ecell = generatePoints({ handoverId: ECELL_ID, base: 3000, teamName: "E-Cell", sources: sourcesOf(ECELL_ID), mode: "approved", reviewerProfileId: PROFILES.rohit.id, reviewerLabel: PROFILES.rohit.displayName, at: "2026-11-04T07:30:00.000Z" });
  store.points.push(...robotics, ...tedx, ...ecell);

  const v1 = CODECELL_V1_POINT_NUMBERS.map((n) => store.points.find((p) => p.id === seedId(NS.point, n))!);
  store.publications.push(
    publication(store, seedId(NS.publication, 1), CODECELL_ID, v1, {
      version: 1,
      publishedAt: "2026-10-02T11:30:00.000Z",
      publishedBy: PROFILES.priya.id,
      summary:
        "CodeCell runs DevForge, weekly workshops and the club website. The biggest risks are the judging portal deploy, which only Priya knows, and the domain renewal due on 30 November.",
      knownGaps: CODECELL_V1_KNOWN_GAPS.map((n) => seedId(NS.point, n)),
    }),
    publication(store, seedId(NS.publication, 2), ROBOTICS_ID, robotics, { version: 1, publishedAt: "2026-10-30T09:15:00.000Z", publishedBy: PROFILES.priya.id, summary: "The treasurer keeps the expense sheet and runs a monthly budget review with the faculty advisor." }),
    publication(store, seedId(NS.publication, 3), TEDX_ID, tedx, { version: 1, publishedAt: "2026-07-20T10:00:00.000Z", publishedBy: PROFILES.priya.id, summary: "Speaker relations covers outreach, approvals and the speaker playbook." }),
    publication(store, seedId(NS.publication, 4), ECELL_ID, ecell, { version: 1, publishedAt: "2026-11-04T08:00:00.000Z", publishedBy: PROFILES.rohit.id, summary: "Sponsorship covers renewals, invoicing and sponsor introductions." }),
  );
  // Completed runs for handovers that were processed before the mock "now".
  [CODECELL_ID, ROBOTICS_ID, TEDX_ID, ECELL_ID].forEach((hid, i) => {
    const h = store.handovers.find((x) => x.id === hid)!;
    const finishedAt = h.evidenceAsOf ? new Date(Date.parse(h.evidenceAsOf) + 20 * 60_000).toISOString() : h.createdAt;
    store.runs.push({ id: seedId(NS.run, 10 + i), handoverId: hid, status: "succeeded", startedAt: new Date(Date.parse(finishedAt) - 9 * 60_000).toISOString(), durationMs: 9 * 60_000, finishedAt, error: null });
  });
  store.publications.find((p) => p.handoverId === TEDX_ID)!.acknowledgements.push({ profileId: PROFILES.meghna.id, at: "2026-07-22T14:00:00.000Z" });

  return store;
}

const globalForMocks = globalThis as typeof globalThis & { __batonMockStore?: MockStore; __batonMockSeq?: number };

export function getStore(): MockStore {
  globalForMocks.__batonMockStore ??= seed();
  return globalForMocks.__batonMockStore;
}

/** Unique id base for runtime-generated points. */
export function nextPointBase(): number {
  globalForMocks.__batonMockSeq = (globalForMocks.__batonMockSeq ?? 100) + 1;
  return globalForMocks.__batonMockSeq * 1000;
}

// ── Simulated pipeline worker ────────────────────────────────────────────────

const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  parse: 0.18,
  extract: 0.32,
  verify_quotes: 0.1,
  verify_support: 0.2,
  analyze: 0.1,
  prepare_review: 0.1,
};

export interface StageProgress {
  stage: PipelineStage;
  status: RunStatus;
  done: number;
  total: number;
}

export function runStages(store: MockStore, run: MockRun, now = Date.now()): StageProgress[] {
  const sources = store.sources.filter((s) => s.handoverId === run.handoverId && !s.removedAt);
  const messages = sources.reduce((n, s) => n + (s.basePreview?.stats.messagesKept ?? s.messageCount ?? 400), 0);
  const totals: Record<PipelineStage, number> = {
    parse: Math.max(1, sources.length),
    extract: Math.max(1, Math.ceil(messages / 400)),
    verify_quotes: 28,
    verify_support: 28,
    analyze: 1,
    prepare_review: 1,
  };
  const fraction = run.status === "succeeded" ? 1 : Math.min(1, (now - Date.parse(run.startedAt)) / run.durationMs);
  let cursor = 0;
  return PIPELINE_STAGES.map((stage) => {
    const start = cursor;
    cursor += STAGE_WEIGHTS[stage];
    if (run.status === "succeeded") return { stage, status: "succeeded" as const, done: totals[stage], total: totals[stage] };
    const raw = (fraction - start) / STAGE_WEIGHTS[stage];
    const local = Math.max(0, Math.min(1, raw > 0.9999 ? 1 : raw)); // weights don't sum exactly in floating point
    const status: RunStatus =
      run.status === "failed" || run.status === "cancelled"
        ? local >= 1
          ? "succeeded"
          : run.status
        : local >= 1
          ? "succeeded"
          : local > 0
            ? "running"
            : "queued";
    return { stage, status, done: Math.floor(local * totals[stage]), total: totals[stage] };
  });
}

/** Advance any running run; on completion, write the "extraction output" and move to in_review. */
export function tickRuns(store: MockStore, handoverId: string, now = Date.now()) {
  for (const run of store.runs.filter((r) => r.handoverId === handoverId && (r.status === "running" || r.status === "queued"))) {
    run.status = "running";
    const h = store.handovers.find((x) => x.id === handoverId);
    if (!h) continue;
    const sources = store.sources.filter((s) => s.handoverId === handoverId && !s.removedAt);
    const elapsed = now - Date.parse(run.startedAt);
    if (elapsed < run.durationMs) {
      for (const s of sources) if (s.state === "uploaded") s.state = "parsing";
      continue;
    }

    const finishedAt = new Date(Date.parse(run.startedAt) + run.durationMs).toISOString();
    run.status = "succeeded";
    run.finishedAt = finishedAt;
    for (const s of sources) {
      if (s.state === "parsed") continue;
      // Final parse with the current rules (§10.3 step 3). startProcessing already refused sources
      // with unresolved identity matches or stale conversation exclusions.
      const parsed = previewFor(store, s);
      const result = parsed.ok ? parsed.data : null;
      s.state = "parsed";
      s.rawDeletedAt = finishedAt;
      s.messageCount ??= result?.stats.messagesKept ?? (s.kind === "whatsapp_export" ? 1200 : 60);
      s.maskingCounts ??= result
        ? Object.fromEntries(Object.entries(result.masking.counts).filter(([, v]) => v > 0))
        : { phone: 3, email: 1 };
      s.firstMessageAt ??= result?.firstMessageAt ?? null;
      s.lastMessageAt ??= result?.lastMessageAt ?? null;
      for (const p of result?.participants ?? []) {
        store.participants.push({
          id: newId(),
          handoverId,
          sourceId: s.id,
          localId: p.localId,
          displayLabel: p.displayLabel,
          identityKind: p.identityKind,
          identityHash: p.identityHash,
          identityPepperVersion: p.identityPepperVersion,
          messageCount: p.messageCount,
        });
      }
    }

    const alreadyHasPoints = store.points.some((p) => p.handoverId === handoverId);
    if (!alreadyHasPoints) {
      const creator = store.profiles.find((p) => p.id === h.createdBy);
      const points = generatePoints({
        handoverId,
        base: nextPointBase(),
        teamName: h.teamName,
        sources,
        mode: "pending",
        reviewerProfileId: h.createdBy,
        reviewerLabel: creator?.displayName ?? "Reviewer",
        at: finishedAt,
      });
      store.points.push(...points);
      for (const p of points.filter((x) => pointStatus(x) === "missing")) {
        const q: MockGapQuestion = {
          id: newId(),
          handoverId,
          pointId: p.id,
          category: p.category,
          question: `${currentRevision(p).title.replace(/\?$/, "")}? Who should the incoming person ask?`,
          context: "No source covers this. It was added from Baton's standard handover checklist.",
          priority: p.category === "owner" || p.category === "account_access" || p.category === "open_task" || p.category === "blocker" ? "required" : "optional",
          status: "open",
          accessLevel: "everyone",
          answers: [],
          createdAt: finishedAt,
        };
        store.gapQuestions.push(q);
      }
    }

    const lastMessage = sources.map((s) => s.lastMessageAt).filter((x): x is string => !!x).sort().pop();
    h.evidenceAsOf = lastMessage ?? finishedAt;
    h.state = "in_review";
    h.hadSuccessfulRun = true;
    h.updatedAt = finishedAt;
  }
}
