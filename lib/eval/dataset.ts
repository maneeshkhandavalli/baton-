/**
 * Offline evaluation datasets (R3 Task 03, EXT-1 / VER-1..3). Synthetic WhatsApp-style conversations,
 * already pseudonymised and masked exactly as Baton stores them, because that is the only form any AI
 * provider ever receives. Files: fixtures/eval/handover-reliability/*.json.
 *
 * Every message is either part of a label (relevant handover material) or not; there is no "unlabelled"
 * state, so detection precision is well defined.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

export const LABEL_KINDS = [
  "decision",
  "deadline",
  "responsibility",
  "financial_commitment",
  "dependency",
  "contradiction",
  "reversed_decision",
  "unresolved_question",
] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

/** Point categories that count as extracting a label of each kind. */
export const KIND_CATEGORIES: Readonly<Record<LabelKind, readonly string[]>> = {
  decision: ["decision"],
  deadline: ["open_task", "next_action", "risk", "decision", "dependency"],
  responsibility: ["owner", "open_task", "next_action", "account_access", "contact"],
  financial_commitment: ["decision", "open_task", "owner", "dependency", "next_action", "risk"],
  dependency: ["dependency", "blocker", "open_task", "risk"],
  contradiction: ["decision", "risk", "blocker", "open_task", "dependency", "recurring_problem"],
  reversed_decision: ["decision", "next_action", "open_task"],
  unresolved_question: ["open_task", "blocker", "risk", "next_action", "account_access", "dependency"],
};

const localId = z.string().regex(/^m\d{2,3}$/);

const datasetSchema = z.strictObject({
  id: z.string().regex(/^ds\d{2}-[a-z0-9-]+$/),
  description: z.string().min(1),
  team: z.strictObject({ name: z.string().min(1), roleTitle: z.string().nullable() }),
  messages: z
    .array(z.strictObject({ id: localId, author: z.string().nullable(), sentAt: z.string().nullable(), body: z.string().min(1) }))
    .min(1),
  labels: z.array(
    z.strictObject({
      id: z.string().regex(/^L\d{2}$/),
      kind: z.enum(LABEL_KINDS),
      messageIds: z.array(localId).min(1),
      reversedBy: z.array(localId).optional(),
      keywords: z.array(z.string()).min(1),
      owner: z.string().nullable(),
    }),
  ),
  supportPairs: z.array(
    z.strictObject({
      id: z.string().regex(/^S\d{2}$/),
      claim: z.strictObject({ category: z.string(), title: z.string(), statement: z.string(), attributes: z.record(z.string(), z.unknown()) }),
      messageId: localId,
      quote: z.string().min(1),
      expected: z.enum(["supports", "partial", "contradicts", "irrelevant"]),
    }),
  ),
});

export type RawDataset = z.output<typeof datasetSchema>;

export interface EvalMessage {
  /** Deterministic UUID (the extraction request requires UUIDs). */
  id: string;
  localId: string;
  seq: number;
  authorLabel: string | null;
  sentAt: string | null;
  body: string;
}

export interface EvalDataset extends Omit<RawDataset, "messages"> {
  messages: EvalMessage[];
  /** local id → UUID */
  uuid: (local: string) => string;
}

/** A stable UUID for (dataset, local message id). */
export function evalUuid(datasetId: string, local: string): string {
  const h = createHash("sha256").update(`baton-eval:${datasetId}:${local}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function parseDataset(raw: unknown): EvalDataset {
  const d = datasetSchema.parse(raw);
  const ids = new Set(d.messages.map((m) => m.id));
  if (ids.size !== d.messages.length) throw new Error(`${d.id}: duplicate message ids`);
  for (const l of d.labels) {
    for (const m of [...l.messageIds, ...(l.reversedBy ?? [])]) if (!ids.has(m)) throw new Error(`${d.id}/${l.id}: unknown message ${m}`);
    if (l.kind === "reversed_decision" && !(l.reversedBy && l.reversedBy.length > 0)) throw new Error(`${d.id}/${l.id}: reversedBy required`);
  }
  for (const s of d.supportPairs) {
    const body = d.messages.find((m) => m.id === s.messageId)?.body;
    if (!body || !body.includes(s.quote)) throw new Error(`${d.id}/${s.id}: quote is not in its message`);
  }
  const uuid = (local: string) => evalUuid(d.id, local);
  return {
    ...d,
    uuid,
    messages: d.messages.map((m, seq) => ({ id: uuid(m.id), localId: m.id, seq, authorLabel: m.author, sentAt: m.sentAt, body: m.body })),
  };
}

export const DEFAULT_DATASET_DIR = join(process.cwd(), "fixtures", "eval", "handover-reliability");

export function loadDatasets(dir: string = DEFAULT_DATASET_DIR): EvalDataset[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => parseDataset(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

/** Messages that are part of any label (the relevant set for detection metrics). */
export function relevantMessages(d: EvalDataset): Set<string> {
  const out = new Set<string>();
  for (const l of d.labels) for (const m of [...l.messageIds, ...(l.reversedBy ?? [])]) out.add(d.uuid(m));
  return out;
}
