/**
 * Pure helpers for the wizard's conversation selector (scope step). Selection is stored as before: the list of
 * EXCLUDED conversation ids on the draft source, so processing is unchanged.
 */

export interface SelectableConversation {
  localId: string;
  messageCount: number;
}

export interface SelectionSummary {
  selected: number;
  total: number;
  selectedMessages: number;
  totalMessages: number;
}

export function selectionSummary(conversations: readonly SelectableConversation[], excluded: readonly string[]): SelectionSummary {
  const out = new Set(excluded);
  let selected = 0;
  let selectedMessages = 0;
  let totalMessages = 0;
  for (const c of conversations) {
    totalMessages += c.messageCount;
    if (!out.has(c.localId)) {
      selected += 1;
      selectedMessages += c.messageCount;
    }
  }
  return { selected, total: conversations.length, selectedMessages, totalMessages };
}

/** Exclusion list for "Select all": nothing excluded. */
export function selectAll(): string[] {
  return [];
}

/** Exclusion list for "Deselect all": every conversation excluded. */
export function deselectAll(conversations: readonly SelectableConversation[]): string[] {
  return conversations.map((c) => c.localId);
}

/** Toggle one conversation in the exclusion list. */
export function toggleConversation(excluded: readonly string[], localId: string): string[] {
  return excluded.includes(localId) ? excluded.filter((x) => x !== localId) : [...excluded, localId];
}
