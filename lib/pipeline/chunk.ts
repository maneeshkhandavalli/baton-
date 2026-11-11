/**
 * Extraction chunking (§10.6, §12.10 rule 4, W0 I2.4 / QA-M8). Pure and deterministic, so a resumed job
 * rebuilds the same chunk list and continues at `progress_done`.
 *
 * - The input is ONE source's persisted, masked messages, so every chunk has a single access level.
 * - A chunk never spans two conversations (documents have none: one stream).
 * - A chunk stays within `EXTRACT_REQUEST_LIMITS`: message count, and UTF-16 characters of bodies and
 *   author labels plus the handover's team name and role title (`measureExtractRequest`).
 * - A single message that cannot fit on its own is skipped and counted; empty bodies are skipped.
 */

import type { ExtractionMessage } from "../db/pipeline";

export interface ChunkLimits {
  maxMessages: number;
  maxChars: number;
}

export interface ChunkPlan {
  chunks: ExtractionMessage[][];
  skippedOversize: number;
  skippedEmpty: number;
}

const len = (s: string | null | undefined) => (s ? s.length : 0);

export function planChunks(
  messages: readonly ExtractionMessage[],
  handover: { teamName: string; roleTitle: string | null },
  limits: ChunkLimits,
): ChunkPlan {
  const base = len(handover.teamName) + len(handover.roleTitle);
  const chunks: ExtractionMessage[][] = [];
  let current: ExtractionMessage[] = [];
  let chars = base;
  let conversation: string | null | undefined;
  let skippedOversize = 0;
  let skippedEmpty = 0;

  const close = () => {
    if (current.length > 0) chunks.push(current);
    current = [];
    chars = base;
  };

  for (const m of messages) {
    if (m.body.trim().length === 0) {
      skippedEmpty += 1;
      continue;
    }
    const size = len(m.body) + len(m.authorLabel);
    if (base + size > limits.maxChars) {
      skippedOversize += 1;
      continue;
    }
    if (current.length > 0 && (m.conversationLocalId !== conversation || current.length >= limits.maxMessages || chars + size > limits.maxChars)) {
      close();
    }
    conversation = m.conversationLocalId;
    current.push(m);
    chars += size;
  }
  close();
  return { chunks, skippedOversize, skippedEmpty };
}
