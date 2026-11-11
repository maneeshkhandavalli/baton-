/**
 * Byte-to-text decoding for text-based sources (WhatsApp .txt, Markdown, plain text).
 *
 * Accepts UTF-8 (with or without BOM) and UTF-16 LE/BE with a BOM. Invalid UTF-8 is an
 * `encoding_error`, never replaced with U+FFFD silently. NUL bytes in UTF-8 text mean the file is
 * binary, which is `unsupported_format`.
 */

import { ParserAbort } from "./errors";
import { LIMITS } from "./limits";

export function decodeText(bytes: Uint8Array): string {
  let text: string;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = decodeWith("utf-16le", bytes.subarray(2));
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = decodeWith("utf-16be", bytes.subarray(2));
  } else {
    const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    const body = bytes.subarray(start);
    if (body.indexOf(0) !== -1) {
      throw new ParserAbort("unsupported_format", "The file looks like binary data, not text.");
    }
    text = decodeWith("utf-8", body);
  }
  if (text.length > LIMITS.maxTextChars) throw new ParserAbort("too_large", "The extracted text is too long.");
  return text;
}

function decodeWith(encoding: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ParserAbort("encoding_error");
  }
}

/** Splits text into lines on CRLF, CR or LF, enforcing line limits. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > LIMITS.maxLines) throw new ParserAbort("too_large", "The file has too many lines.");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > LIMITS.maxLineChars) {
      throw new ParserAbort("unsupported_format", "A line in the file is too long to be a chat export.", i + 1);
    }
  }
  return lines;
}
