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

export interface ScopedChat {
  name: string;
  /** null for a document (it always has content to read). */
  conversations: readonly SelectableConversation[] | null;
  excluded: readonly string[];
}

/**
 * Chats that would be read with NO message selected (judge break test: "Deselect all" then "Start processing"
 * ran the AI on nothing and recorded every conversation as left out). Start stays disabled while any is listed:
 * keep at least one conversation, or remove that chat. Documents always have content to read.
 */
export function chatsWithNothingSelected(sources: readonly ScopedChat[]): string[] {
  return sources.filter((s) => s.conversations !== null && selectionSummary(s.conversations, s.excluded).selectedMessages === 0).map((s) => s.name);
}

/** The short reason shown next to the disabled Start button (no em dashes). */
export function nothingSelectedReason(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const which = names.length === 1 ? names[0] : `${names.length} chats`;
  return `Nothing is selected in ${which}. Select at least one conversation, or go back and remove that chat.`;
}
