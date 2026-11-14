/**
 * Picks the chat text out of a WhatsApp ZIP export (§11.4): `_chat.txt` (iOS) if present,
 * otherwise the single `.txt` file (Android). Attachments are never decompressed or read.
 *
 * Entry names are only compared, never used as filesystem paths. Even so, an entry whose name is
 * not a plain relative path (absolute, drive-qualified, `.`/`..` segments, empty segments or control
 * characters) is never selected (R3 D2): a real export never contains one, so such an archive was
 * crafted or re-packed and is treated as not containing a chat. Archives nested inside the export
 * are never opened (no recursion, so no nested zip bomb); a ZIP holding only another archive gets
 * its own message.
 */

import { ParserAbort } from "../errors";
import type { ZipArchive, ZipEntry } from "../zip/read-zip";

function normalizeName(name: string): string {
  return name.replace(/\\/g, "/");
}

function basename(name: string): string {
  const parts = normalizeName(name).split("/");
  return parts[parts.length - 1];
}

function isIgnorable(name: string): boolean {
  const n = normalizeName(name);
  return n.startsWith("__MACOSX/") || n.includes("/__MACOSX/") || basename(n).startsWith("._") || basename(n).startsWith(".");
}

/**
 * True if the entry name is a plain relative path: not absolute, no drive letter, no `.`/`..` or
 * empty segments, no control characters. Unsafe names are never selected.
 */
export function isSafeEntryName(name: string): boolean {
  if (name === "" || /[\u0000-\u001f\u007f]/.test(name)) return false;
  const n = normalizeName(name);
  if (n.startsWith("/") || /^[A-Za-z]:/.test(n)) return false;
  const segments = n.split("/");
  return segments.every((seg, i) => seg !== ".." && seg !== "." && (seg !== "" || i === segments.length - 1));
}

function isArchiveName(name: string): boolean {
  return /\.(zip|rar|7z|tar|gz|tgz)$/i.test(basename(name));
}

export function selectChatEntry(zip: ZipArchive): ZipEntry {
  const files = zip.entries.filter((e) => !e.isDirectory && !isIgnorable(e.name) && isSafeEntryName(e.name));
  const chat = files.filter((e) => basename(e.name) === "_chat.txt");
  if (chat.length === 1) return chat[0];
  if (chat.length > 1) throw new ParserAbort("unsupported_format", "The ZIP archive contains more than one chat.");
  const txt = files.filter((e) => basename(e.name).toLowerCase().endsWith(".txt"));
  if (txt.length === 1) return txt[0];
  if (txt.length === 0) {
    if (files.some((e) => isArchiveName(e.name))) {
      throw new ParserAbort("unsupported_format", "The ZIP archive contains another archive; upload the chat export itself.");
    }
    throw new ParserAbort("unsupported_format", "The ZIP archive does not contain a WhatsApp chat text file.");
  }
  throw new ParserAbort("unsupported_format", "The ZIP archive contains several text files; upload one chat export at a time.");
}
