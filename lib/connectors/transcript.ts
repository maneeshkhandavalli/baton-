/**
 * The `chat_import` source format (Round 4 connector contract §3): UTF-8 JSON Lines, produced ONLY by the server
 * from buffered connector messages and parsed by lib/parsers/chat-import. Deterministic: the same messages give
 * the same bytes (so identical content is recognised as an unchanged source version by its SHA-256).
 *
 *   line 1   {"format":"baton.chat_import","version":1,"provider":"slack","channel":"#core-team"}
 *   line 2…  {"id":"…","at":"2026-11-19T10:00:00.000Z","author":"Asha","kind":"text","text":"…","reply_to":null}
 *
 * The header carries no provider ids. Message ids stay inside the file only so that a reply can name its parent;
 * the parser does not persist them.
 */

import type { ConnectorMessage, ConnectorProvider } from "./types";

export const CHAT_IMPORT_FORMAT = "baton.chat_import";
export const CHAT_IMPORT_VERSION = 1;

export interface ChatImportHeader {
  format: typeof CHAT_IMPORT_FORMAT;
  version: typeof CHAT_IMPORT_VERSION;
  provider: ConnectorProvider;
  channel: string;
}

export interface ChatImportLine {
  id: string;
  at: string;
  author: string;
  kind: ConnectorMessage["kind"];
  text: string;
  reply_to: string | null;
}

/** Oldest first; ties by provider id, so the order never depends on arrival order. */
export function orderMessages<T extends ConnectorMessage>(messages: readonly T[]): T[] {
  return [...messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || (a.providerMessageId < b.providerMessageId ? -1 : a.providerMessageId > b.providerMessageId ? 1 : 0));
}

export function serializeTranscript(provider: ConnectorProvider, channelLabel: string, messages: readonly ConnectorMessage[]): Uint8Array {
  const header: ChatImportHeader = { format: CHAT_IMPORT_FORMAT, version: CHAT_IMPORT_VERSION, provider, channel: channelLabel };
  const lines = [JSON.stringify(header)];
  for (const m of orderMessages(messages)) {
    const line: ChatImportLine = { id: m.providerMessageId, at: m.sentAt, author: m.authorLabel, kind: m.kind, text: m.text, reply_to: m.replyToId ?? null };
    lines.push(JSON.stringify(line));
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

/** File name used for the source title: "Slack · #core-team" style, extension .jsonl. Masked by the action layer. */
export function transcriptFileName(provider: ConnectorProvider, channelLabel: string): string {
  const name = { github: "GitHub", discord: "Discord", slack: "Slack", telegram: "Telegram" }[provider];
  const label = channelLabel.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "channel";
  return `${name} - ${label}.jsonl`;
}
