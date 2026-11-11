/**
 * Picks the chat text out of a WhatsApp ZIP export (§11.4): `_chat.txt` (iOS) if present,
 * otherwise the single `.txt` file (Android). Attachments are never decompressed or read.
 */

import { ParserAbort } from "../errors";
import type { ZipArchive, ZipEntry } from "../zip/read-zip";

function basename(name: string): string {
  const parts = name.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

function isIgnorable(name: string): boolean {
  const n = name.replace(/\\/g, "/");
  return n.startsWith("__MACOSX/") || n.includes("/__MACOSX/") || basename(n).startsWith("._") || basename(n).startsWith(".");
}

export function selectChatEntry(zip: ZipArchive): ZipEntry {
  const files = zip.entries.filter((e) => !e.isDirectory && !isIgnorable(e.name));
  const chat = files.filter((e) => basename(e.name) === "_chat.txt");
  if (chat.length === 1) return chat[0];
  if (chat.length > 1) throw new ParserAbort("unsupported_format", "The ZIP archive contains more than one chat.");
  const txt = files.filter((e) => basename(e.name).toLowerCase().endsWith(".txt"));
  if (txt.length === 1) return txt[0];
  if (txt.length === 0) throw new ParserAbort("unsupported_format", "The ZIP archive does not contain a WhatsApp chat text file.");
  throw new ParserAbort("unsupported_format", "The ZIP archive contains several text files; upload one chat export at a time.");
}
