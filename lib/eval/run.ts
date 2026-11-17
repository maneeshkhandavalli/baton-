/**
 * Offline extraction and verification evaluation (R3 Task 03). Repeatable: run it whenever the extraction
 * or verification model, the prompt, the adapter or the signal detector changes, and compare with the
 * recorded baseline (fixtures/eval/baselines/).
 *
 * It exercises the REAL lib/ai code paths (extractCandidates, verifySupport, quote checks, the PI-11 guard)
 * and the deterministic layers (lib/signals) on synthetic, pseudonymised datasets. The provider is passed
 * in: the fake adapter (deterministic plumbing baseline, NOT a model) or a configured real provider.
 *
 * Metrics (micro-averaged over all datasets; every ratio carries its numerator and denominator):
 *   detectionRecall        labelled messages that the signal pass flags / labelled messages
 *   detectionPrecision     flagged messages that are labelled / flagged messages
 *   extractionRecall       labels matched by a candidate (category fits the label kind, and a quote that was
 *                          FOUND cites one of the label's messages; for a reversal, the later message) / labels
 *   citationAccuracy       found citations on a labelled message / all citations of kept candidates
 *   supportPrecision       pairs judged `supports` that should be / pairs judged `supports` (model verdict,
 *                          before the PI-11 guard)
 *   supportAccuracy        verdicts equal to the expected verdict / pairs
 *   unsupportedClaimRate   kept candidates with no found citation on ANY labelled message / kept candidates
 *   attributionAccuracy    matched owner-labels whose candidate person field equals the labelled owner /
 *                          matched owner-labels whose candidate has a person field
 *   contradictionRecall    reversal/contradiction labels whose later message the deterministic retrieval
 *                          returns for a point anchored on the earlier message / such labels
 */

import { extractCandidates, type CheckedCandidate } from "../ai/extract";
import { EXTRACT_REQUEST_LIMITS } from "../ai/limits";
import type { AiProvider, AiRunConfig, ExtractRequest, VerifySupportRequest } from "../ai/provider";
import { verifySupport } from "../ai/verify-support";
import { POINT_CATEGORIES, type PointCategory } from "../contracts/enums";
import { planChunks } from "../pipeline/chunk";
import { checkAttribution, PERSON_FIELDS } from "../signals/attribution";
import { findContradictionCandidates } from "../signals/contradictions";
import { scanSourceSignals } from "../signals/detect";
import { SIGNAL_DETECTOR_VERSION } from "../signals/taxonomy";
import { KIND_CATEGORIES, relevantMessages, type EvalDataset } from "./dataset";

export interface Ratio {
  num: number;
  den: number;
  /** num / den, rounded to 4 places; null when den is 0. */
  value: number | null;
}

const ratio = (num: number, den: number): Ratio => ({ num, den, value: den === 0 ? null : Math.round((num / den) * 10_000) / 10_000 });

export const METRIC_NAMES = [
  "detectionRecall",
  "detectionPrecision",
  "extractionRecall",
  "citationAccuracy",
  "supportPrecision",
  "supportAccuracy",
  "unsupportedClaimRate",
  "attributionAccuracy",
  "contradictionRecall",
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

export interface DatasetResult {
  dataset: string;
  messages: number;
  labels: number;
  chunks: number;
  failedChunks: string[];
  candidates: number;
  droppedByLib: Record<string, number>;
  unmatchedLabels: string[];
  metrics: Record<MetricName, Ratio>;
  attributionResolutions: Record<string, number>;
  supportConfusion: Array<{ pair: string; expected: string; modelVerdict: string | null; verdict: string | null; guarded: boolean }>;
}

export interface EvalReport {
  label: string;
  provider: string;
  adapterVersion: string;
  extractModel: string;
  verifyModel: string;
  extractPrompt: string;
  verifyPrompt: string;
  detectorVersion: string;
  datasets: DatasetResult[];
  totals: Record<MetricName, Ratio>;
}

const sum = (rs: Ratio[]) => ratio(rs.reduce((a, r) => a + r.num, 0), rs.reduce((a, r) => a + r.den, 0));

function found(c: CheckedCandidate["citations"][number]): boolean {
  return c.quoteCheck !== "not_found";
}

function personField(c: CheckedCandidate): string | null {
  for (const f of PERSON_FIELDS[c.category as PointCategory] ?? []) {
    const v = (c.attributes as Record<string, unknown>)[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export async function evaluateDataset(d: EvalDataset, provider: AiProvider, runConfig: AiRunConfig, opts: { signal?: () => AbortSignal } = {}): Promise<DatasetResult> {
  const relevant = relevantMessages(d);

  // 1. Deterministic signal pass.
  const scan = scanSourceSignals(d.messages);
  const flagged = new Set(scan.signals.map((s) => s.messageId));
  const detectionRecall = ratio([...relevant].filter((m) => flagged.has(m)).length, relevant.size);
  const detectionPrecision = ratio([...flagged].filter((m) => relevant.has(m)).length, flagged.size);

  // 2. Extraction through lib/ai, chunked exactly like the pipeline.
  const plan = planChunks(
    d.messages.map((m) => ({ id: m.id, seq: m.seq, conversationLocalId: "c_1", authorLabel: m.authorLabel, sentAt: m.sentAt, kind: "text" as const, body: m.body })),
    { teamName: d.team.name, roleTitle: d.team.roleTitle },
    EXTRACT_REQUEST_LIMITS,
  );
  const candidates: CheckedCandidate[] = [];
  const failedChunks: string[] = [];
  const droppedByLib: Record<string, number> = {};
  for (const [i, chunk] of plan.chunks.entries()) {
    const req: ExtractRequest = {
      handover: { teamName: d.team.name, roleTitle: d.team.roleTitle },
      categories: POINT_CATEGORIES,
      messages: chunk.map((m) => ({ id: m.id, authorLabel: m.authorLabel, sentAt: m.sentAt, body: m.body })),
    };
    const r = await extractCandidates(provider, req, { attempt: 1, runConfig, signal: opts.signal?.() });
    if (!r.ok) {
      failedChunks.push(`${i}:${String(r.error.details?.reason ?? r.error.code)}`);
      continue;
    }
    candidates.push(...r.data.candidates);
    for (const [k, v] of Object.entries(r.data.dropped)) if (v > 0) droppedByLib[k] = (droppedByLib[k] ?? 0) + v;
  }

  // 3. Label matching.
  const unmatchedLabels: string[] = [];
  let matchedOwnerWithField = 0;
  let ownerCorrect = 0;
  for (const l of d.labels) {
    const targets = new Set((l.kind === "reversed_decision" ? l.reversedBy! : l.messageIds).map(d.uuid));
    const match = candidates.find(
      (c) => KIND_CATEGORIES[l.kind].includes(c.category) && c.citations.some((x) => found(x) && targets.has(x.messageId)),
    );
    if (!match) {
      unmatchedLabels.push(l.id);
      continue;
    }
    if (l.owner) {
      const v = personField(match);
      if (v !== null) {
        matchedOwnerWithField += 1;
        if (v.replace(/^@/, "") === l.owner) ownerCorrect += 1;
      }
    }
  }
  const extractionRecall = ratio(d.labels.length - unmatchedLabels.length, d.labels.length);
  const allCitations = candidates.flatMap((c) => c.citations);
  const citationAccuracy = ratio(allCitations.filter((x) => found(x) && relevant.has(x.messageId)).length, allCitations.length);
  const unsupportedClaimRate = ratio(candidates.filter((c) => !c.citations.some((x) => found(x) && relevant.has(x.messageId))).length, candidates.length);
  const attributionAccuracy = ratio(ownerCorrect, matchedOwnerWithField);

  // VER-3 checker over what was extracted (distribution only; not a metric of the model).
  const participants = new Set(d.messages.map((m) => m.authorLabel).filter((a): a is string => !!a));
  const byId = new Map(d.messages.map((m) => [m.id, m]));
  const attributionResolutions: Record<string, number> = {};
  for (const c of candidates) {
    const cited = c.citations.filter(found).map((x) => byId.get(x.messageId)).filter((m) => m !== undefined);
    for (const a of checkAttribution({ category: c.category, attributes: c.attributes as Record<string, unknown>, cited: cited.map((m) => ({ authorLabel: m!.authorLabel, body: m!.body })), participants })) {
      attributionResolutions[a.resolution] = (attributionResolutions[a.resolution] ?? 0) + 1;
    }
  }

  // 4. Semantic support (model verdict before the PI-11 guard).
  const supportConfusion: DatasetResult["supportConfusion"] = [];
  for (const s of d.supportPairs) {
    const m = d.messages.find((x) => x.localId === s.messageId)!;
    const req: VerifySupportRequest = {
      claim: { category: s.claim.category as PointCategory, title: s.claim.title, statement: s.claim.statement, attributes: s.claim.attributes as never },
      quote: { text: s.quote, authorLabel: m.authorLabel, sentAt: m.sentAt },
      context: [],
    };
    const r = await verifySupport(provider, req, { attempt: 1, runConfig, signal: opts.signal?.() });
    supportConfusion.push({
      pair: s.id,
      expected: s.expected,
      modelVerdict: r.ok ? (r.data.modelVerdict ?? r.data.verdict) : null,
      verdict: r.ok ? r.data.verdict : null,
      guarded: r.ok ? (r.data.injection?.guarded ?? false) : false,
    });
  }
  const judgedSupports = supportConfusion.filter((x) => x.modelVerdict === "supports");
  const supportPrecision = ratio(judgedSupports.filter((x) => x.expected === "supports").length, judgedSupports.length);
  const supportAccuracy = ratio(supportConfusion.filter((x) => x.modelVerdict === x.expected).length, supportConfusion.length);

  // 5. Deterministic contradiction retrieval (VER-2).
  const changeLabels = d.labels.filter((l) => l.kind === "reversed_decision" || l.kind === "contradiction");
  let retrieved = 0;
  for (const l of changeLabels) {
    const anchor = d.uuid(l.messageIds[0]);
    const later = new Set((l.kind === "reversed_decision" ? l.reversedBy! : l.messageIds.slice(1)).map(d.uuid));
    const anchorMsg = d.messages.find((m) => m.id === anchor)!;
    const found = findContradictionCandidates(
      [{ pointId: l.id, title: l.keywords.join(" "), statement: anchorMsg.body, attributes: null, citedMessageIds: [anchor] }],
      d.messages.map((m) => ({ id: m.id, sourceId: d.id, seq: m.seq, sentAt: m.sentAt, authorLabel: m.authorLabel, body: m.body })),
    );
    if (found.some((c) => later.has(c.messageId))) retrieved += 1;
  }
  const contradictionRecall = ratio(retrieved, changeLabels.length);

  return {
    dataset: d.id,
    messages: d.messages.length,
    labels: d.labels.length,
    chunks: plan.chunks.length,
    failedChunks,
    candidates: candidates.length,
    droppedByLib,
    unmatchedLabels,
    metrics: {
      detectionRecall,
      detectionPrecision,
      extractionRecall,
      citationAccuracy,
      supportPrecision,
      supportAccuracy,
      unsupportedClaimRate,
      attributionAccuracy,
      contradictionRecall,
    },
    attributionResolutions,
    supportConfusion,
  };
}

export async function runEvaluation(
  datasets: readonly EvalDataset[],
  provider: AiProvider,
  runConfig: AiRunConfig,
  label: string,
  opts: { signal?: () => AbortSignal } = {},
): Promise<EvalReport> {
  const results: DatasetResult[] = [];
  for (const d of datasets) results.push(await evaluateDataset(d, provider, runConfig, opts));
  const totals = Object.fromEntries(METRIC_NAMES.map((n) => [n, sum(results.map((r) => r.metrics[n]))])) as Record<MetricName, Ratio>;
  return {
    label,
    provider: runConfig.provider,
    adapterVersion: runConfig.adapterVersion,
    extractModel: runConfig.extract.model,
    verifyModel: runConfig.verify.model,
    extractPrompt: runConfig.extract.promptVersion,
    verifyPrompt: runConfig.verify.promptVersion,
    detectorVersion: SIGNAL_DETECTOR_VERSION,
    datasets: results,
    totals,
  };
}

export function formatReport(r: EvalReport): string {
  const pct = (x: Ratio) => (x.value === null ? "n/a" : `${(x.value * 100).toFixed(1)}% (${x.num}/${x.den})`);
  const lines = [
    `Evaluation: ${r.label}`,
    `provider=${r.provider} adapter=${r.adapterVersion} extract=${r.extractModel} (${r.extractPrompt}) verify=${r.verifyModel} (${r.verifyPrompt}) detector=${r.detectorVersion}`,
    "",
    `| metric | ${r.datasets.map((d) => d.dataset).join(" | ")} | total |`,
    `|---|${r.datasets.map(() => "---").join("|")}|---|`,
    ...METRIC_NAMES.map((n) => `| ${n} | ${r.datasets.map((d) => pct(d.metrics[n])).join(" | ")} | ${pct(r.totals[n])} |`),
  ];
  for (const d of r.datasets) {
    if (d.failedChunks.length > 0) lines.push(`${d.dataset}: FAILED chunks ${d.failedChunks.join(", ")}`);
  }
  return lines.join("\n");
}
