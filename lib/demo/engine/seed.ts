/**
 * The demo store's starting point (R3 Task 06): the CodeCell scenario (lib/demo/scenario) as a mock store, at the moment
 * Baton's pre-generated draft is ready and Kabir has approved the straightforward points. Pure and deterministic: every
 * id is derived from a counter, every time from the scenario clock. A fresh object on every call, never shared.
 */

import type { ChangeReviewItem } from "@/lib/contracts/change-review";
import { NS, seedId } from "@/lib/mocks/ids";
import { buildPoint, type SeedEvidence } from "@/lib/mocks/fixtures/builders";
import type { MockGapQuestion, MockMember, MockProfile, MockSource, MockStore } from "@/lib/mocks/types";

import {
  DEMO_CAST,
  DEMO_CLUB,
  DEMO_GAP_QUESTIONS,
  DEMO_POINTS,
  DEMO_SOURCES,
  DEMO_TIMELINE,
  DEMO_TIMEZONE,
  lineOf,
  whatsappSentAt,
  type DemoPersonKey,
  type DemoPointKey,
  type DemoSourceKey,
} from "../scenario/index";

/** Demo-only id namespace, so a demo id never looks like a dev-mock id. */
const DEMO_NS = 0xde;

const POINT_BASE = 0xde00;

export const DEMO_HANDOVER_ID = seedId(NS.handover, 0xde0);
export const demoProfileId = (key: DemoPersonKey) => seedId(NS.profile, 0xde0 + Object.keys(DEMO_CAST).indexOf(key));
export const demoSourceId = (key: DemoSourceKey) => seedId(NS.source, 0xde0 + Object.keys(DEMO_SOURCES).indexOf(key));
export const demoPointId = (key: DemoPointKey) => {
  const seed = DEMO_POINTS.find((p) => p.key === key);
  if (!seed) throw new Error(`unknown demo point ${key}`);
  return seedId(NS.point, POINT_BASE + seed.n);
};

/** A change-review item as the demo keeps it (the DTO's fields that don't depend on the point's current state). */
export interface DemoChangeReview {
  id: string;
  pointId: string;
  item: Omit<ChangeReviewItem, "point" | "base" | "basePublicationId">;
}

/** The demo store: a mock store plus the demo's own deterministic id counter and change reviews. */
export interface DemoStore extends MockStore {
  seq: number;
  changeReviews: DemoChangeReview[];
}

/** The next deterministic id (stable across replays of the same session). */
export function nextDemoId(store: DemoStore): string {
  store.seq += 1;
  return seedId(DEMO_NS, store.seq);
}

const HEADER = /^(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}) - /;

function whatsappStats(raw: string) {
  const lines = raw.split("\n").map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => HEADER.test(l) && /^[^-]+ - [^:]+: /.test(l));
  return {
    count: lines.length,
    first: lines.length ? whatsappSentAt(raw, lines[0].n) : null,
    last: lines.length ? whatsappSentAt(raw, lines[lines.length - 1].n) : null,
  };
}

function seedSources(): MockSource[] {
  return Object.values(DEMO_SOURCES).map((s) => {
    const chat = s.kind === "whatsapp_export" ? whatsappStats(s.raw) : null;
    return {
      id: demoSourceId(s.key),
      handoverId: DEMO_HANDOVER_ID,
      kind: s.kind,
      title: s.title,
      state: "parsed",
      accessLevel: s.accessLevel,
      sizeBytes: new TextEncoder().encode(s.raw).length,
      sha256: "de".repeat(32),
      consentRecordedAt: DEMO_TIMELINE.consentRecordedAt,
      rawDeletedAt: DEMO_TIMELINE.rawDeletedAt,
      firstMessageAt: chat?.first ?? null,
      lastMessageAt: chat?.last ?? null,
      messageCount: chat?.count ?? s.raw.split("\n").filter((l) => l.trim()).length,
      maskingCounts: s.kind === "whatsapp_export" ? { phone: 1 } : null,
      errorCode: null,
      timezone: DEMO_TIMEZONE,
      documentDate: s.documentDate,
      basePreview: null,
      removedAt: null,
    };
  });
}

export function seedDemoStore(): DemoStore {
  const profiles: MockProfile[] = Object.values(DEMO_CAST).map((p) => ({ id: demoProfileId(p.key), displayName: p.displayName, email: p.email }));
  const members: MockMember[] = Object.values(DEMO_CAST)
    .filter((p) => p.member)
    .map((p, i) => ({
      id: seedId(NS.member, 0xde0 + i),
      handoverId: DEMO_HANDOVER_ID,
      profileId: demoProfileId(p.key),
      displayName: p.displayName,
      email: p.email,
      role: p.member!.role,
      clearance: p.member!.clearance,
      ackRequired: p.member!.role === "incoming",
      removedAt: null,
    }));
  const sources = seedSources();
  const sourceOf = (key: DemoSourceKey) => sources.find((s) => s.id === demoSourceId(key))!;
  const kabir = DEMO_CAST.kabir.displayName;

  const points = DEMO_POINTS.map((seed) => {
    const evidence: SeedEvidence[] = seed.evidence.map((e) => {
      const src = DEMO_SOURCES[e.source];
      if (src.kind === "markdown") {
        return { quote: e.quote, by: null, at: null, source: sourceOf(e.source), line: e.block?.lineStart, heading: e.block?.heading, verdict: e.verdict, why: e.why };
      }
      const line = lineOf(src.raw, e.find ?? e.quote);
      return {
        quote: e.quote,
        by: e.by ? DEMO_CAST[e.by].displayName : null,
        at: whatsappSentAt(src.raw, line),
        source: sourceOf(e.source),
        line,
        verdict: e.verdict,
        why: e.why,
      };
    });
    const approved = seed.atReviewStart === "approved";
    const point = buildPoint(DEMO_HANDOVER_ID, POINT_BASE, {
      n: seed.n,
      category: seed.category,
      title: seed.title,
      statement: seed.statement,
      attributes: seed.attributes,
      evidence,
      rationale: seed.rationale,
      review: approved ? "approved" : "pending",
      updatedAt: approved ? DEMO_TIMELINE.kabirReviewedAt : DEMO_TIMELINE.runFinishedAt,
      history: approved ? [{ action: "approve", actor: kabir, at: DEMO_TIMELINE.kabirReviewedAt }] : [],
    });
    // Markdown blocks span their own lines (the parser groups list items); buildPoint assumes one line per quote line.
    seed.evidence.forEach((e, i) => {
      if (e.block && point.links[i].location) point.links[i].location = { ...point.links[i].location!, lineEnd: e.block.lineEnd };
    });
    return point;
  });

  const gapQuestions: MockGapQuestion[] = DEMO_GAP_QUESTIONS.map((q) => {
    const seed = DEMO_POINTS.find((p) => p.key === q.point)!;
    return {
      id: seedId(NS.gapQuestion, 0xde0 + q.n),
      handoverId: DEMO_HANDOVER_ID,
      pointId: demoPointId(q.point),
      category: seed.category,
      question: q.question,
      context: q.context,
      priority: q.priority,
      status: "open",
      accessLevel: "everyone",
      answers: [],
      createdAt: DEMO_TIMELINE.runFinishedAt,
    };
  });

  return {
    viewerId: demoProfileId("priya"),
    readerSessionId: null,
    profiles,
    handovers: [
      {
        id: DEMO_HANDOVER_ID,
        title: `${DEMO_CLUB.name} technical lead`,
        teamName: DEMO_CLUB.name,
        roleTitle: "Technical lead",
        description: "Priya hands the technical lead role over to Neha, who takes over on 1 December 2026. Everyone and everything here is fictional.",
        state: "in_review",
        createdBy: demoProfileId("priya"),
        currentPublicationId: null,
        createdAt: DEMO_TIMELINE.handoverCreatedAt,
        updatedAt: DEMO_TIMELINE.kabirReviewedAt,
        evidenceAsOf: DEMO_TIMELINE.evidenceAsOf,
        lastError: null,
        deletedAt: null,
        hadSuccessfulRun: true,
        pendingCreatorTransfer: null,
        purgedAt: null,
      },
    ],
    members,
    sources,
    participants: [],
    exclusions: [],
    identityConfirmations: [],
    points,
    gapQuestions,
    tokens: [],
    publications: [],
    runs: [
      {
        id: seedId(NS.run, 0xde0),
        handoverId: DEMO_HANDOVER_ID,
        status: "succeeded",
        startedAt: DEMO_TIMELINE.runStartedAt,
        durationMs: Date.parse(DEMO_TIMELINE.runFinishedAt) - Date.parse(DEMO_TIMELINE.runStartedAt),
        finishedAt: DEMO_TIMELINE.runFinishedAt,
        error: null,
      },
    ],
    seq: 0,
    changeReviews: seedChangeReviews(),
  };
}

// ── change reviews (shown once a version is published: an updated infra-notes export) ───────────────────

/** The second version of Priya's infrastructure notes, which the demo "received" after the first publication. */
export const DEMO_INFRA_V2_SOURCE_ID = seedId(NS.source, 0xdef);
const UPDATE_ID = seedId(DEMO_NS, 0xc000);

function seedChangeReviews(): DemoChangeReview[] {
  const base = {
    changeId: UPDATE_ID,
    state: "open" as const,
    staleReason: null,
    createdAt: DEMO_TIMELINE.nehaOpenedAt,
    decidedAt: null,
    sourceId: DEMO_INFRA_V2_SOURCE_ID,
    previousSourceId: demoSourceId("infra"),
    sourceTitle: DEMO_SOURCES.infra.title,
    fromVersion: 1,
    toVersion: 2,
    updateState: "processed",
    newEvidence: null,
    decisions: [],
  };
  const moved = "All club repositories live in the codecell-org GitHub organisation. Personal forks are archived.";
  const wifi = "College IT now sets up guest Wi-Fi in two working days if the request goes in by Monday.";
  return [
    {
      id: seedId(DEMO_NS, 0xc001),
      pointId: demoPointId("github_org"),
      item: {
        ...base,
        id: seedId(DEMO_NS, 0xc001),
        kind: "evidence_moved",
        detail: { location: "section_changed" },
        oldEvidence: null,
        newMessage: { id: seedId(DEMO_NS, 0xc101), body: moved, sentAt: null, authorLabel: null, quoteStart: 0, quoteEnd: moved.length },
      },
    },
    {
      id: seedId(DEMO_NS, 0xc002),
      pointId: demoPointId("guest_wifi"),
      item: {
        ...base,
        id: seedId(DEMO_NS, 0xc002),
        kind: "possible_contradiction",
        detail: { coverage: "after_watermark" },
        oldEvidence: null,
        newMessage: { id: seedId(DEMO_NS, 0xc102), body: wifi, sentAt: null, authorLabel: null, quoteStart: null, quoteEnd: null },
      },
    },
  ];
}
