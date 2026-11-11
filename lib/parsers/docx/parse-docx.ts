/**
 * DOCX → document blocks (no dependency).
 *
 * Reads only `word/document.xml` from the OOXML package. Each `<w:p>` paragraph with text becomes
 * one block; paragraphs styled `Title`/`Heading N` (or with an outline level) are headings, and
 * every block records the most recent heading. `location.lineStart/lineEnd` is the 1-based
 * paragraph ordinal (DOCX has no stable page numbers without layout).
 *
 * Text handling: `<w:t>` text, `<w:tab/>` → tab, `<w:br/>`/`<w:cr/>` → newline. Tracked-change
 * deletions (`<w:delText>`, `<w:del>`) are dropped, so deleted text never reaches the output;
 * field instructions (`<w:instrText>`) are dropped. Headers, footers, footnotes, comments and
 * text boxes outside the main body flow are not read (documented limitation).
 *
 * XML: entities are decoded only for the five predefined entities and numeric references.
 * DOCTYPE declarations are rejected; nothing external is ever resolved.
 */

import type { RawDocumentBlock } from "../build-source";
import { ParserAbort } from "../errors";
import { LIMITS } from "../limits";
import { isZip, openZip } from "../zip/read-zip";

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function isCfb(bytes: Uint8Array): boolean {
  return CFB_MAGIC.every((b, i) => bytes[i] === b);
}

/** "EncryptionInfo" as UTF-16LE, the stream name Office uses for encrypted OOXML packages. */
function containsUtf16(bytes: Uint8Array, text: string): boolean {
  const needle = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) needle[i * 2] = text.charCodeAt(i);
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, ent: string) => {
    switch (ent) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    const cp = ent[1] === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
    return String.fromCodePoint(cp);
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? "");
}

interface Paragraph {
  text: string;
  isHeading: boolean;
}

interface Markup {
  start: number;
  end: number; // exclusive
  cdata?: string;
  /** Present for element tags only (absent for comments, PIs, CDATA and declarations). */
  tag?: { closing: boolean; prefix: string; local: string; attrs: string; selfClosing: boolean };
}

const TAG_INNER_RE = /^(\/?)([A-Za-z_][\w.\-]*:)?([A-Za-z_][\w.\-]*)([\s\S]*?)(\/?)$/;

function unterminated(what: string): never {
  throw new ParserAbort("corrupt_file", `The document contains an unterminated XML ${what}.`);
}

/**
 * Finds the next markup construct at or after `from` in linear time: every construct is closed
 * with one forward indexOf from its own start, and the scan resumes after it, so each byte is
 * examined a bounded number of times. An unterminated comment, CDATA section, processing
 * instruction or tag is `corrupt_file` (never retried from the next "<", which was quadratic).
 */
function nextMarkup(xml: string, from: number): Markup | null {
  const start = xml.indexOf("<", from);
  if (start < 0) return null;
  const close = (terminator: string, offset: number, what: string): number => {
    const i = xml.indexOf(terminator, start + offset);
    if (i < 0) unterminated(what);
    return i + terminator.length;
  };
  if (xml.startsWith("<!--", start)) return { start, end: close("-->", 4, "comment") };
  if (xml.startsWith("<![CDATA[", start)) {
    const end = close("]]>", 9, "CDATA section");
    return { start, end, cdata: xml.slice(start + 9, end - 3) };
  }
  if (xml.startsWith("<?", start)) return { start, end: close("?>", 2, "processing instruction") };
  if (xml.startsWith("<!", start)) return { start, end: close(">", 2, "declaration") };
  const end = close(">", 1, "tag");
  const inner = TAG_INNER_RE.exec(xml.slice(start + 1, end - 1));
  if (!inner) return { start, end };
  return {
    start,
    end,
    tag: { closing: inner[1] === "/", prefix: inner[2] ?? "", local: inner[3], attrs: inner[4], selfClosing: inner[5] === "/" },
  };
}

export function extractDocxParagraphs(xml: string): Paragraph[] {
  if (/<!DOCTYPE/i.test(xml)) throw new ParserAbort("corrupt_file", "The document contains an unsupported DOCTYPE.");
  const paragraphs: Paragraph[] = [];

  let inParagraph = 0;
  let text = "";
  let heading = false;
  let textMode: "t" | "skip" | null = null;
  let delDepth = 0;
  let last = 0;
  let mk: Markup | null;

  const flushText = (chunk: string) => {
    if (textMode === "t" && delDepth === 0 && inParagraph > 0) text += decodeEntities(chunk);
  };

  while ((mk = nextMarkup(xml, last))) {
    flushText(xml.slice(last, mk.start));
    last = mk.end;
    if (mk.cdata !== undefined) {
      if (textMode === "t" && delDepth === 0 && inParagraph > 0) text += mk.cdata;
      continue;
    }
    if (!mk.tag) continue; // comment, processing instruction or declaration
    const { closing, selfClosing, local, prefix, attrs } = mk.tag;
    if (prefix !== "w:") continue;

    switch (local) {
      case "p":
        if (closing) {
          inParagraph = Math.max(0, inParagraph - 1);
          if (inParagraph === 0) {
            paragraphs.push({ text, isHeading: heading });
            text = "";
            heading = false;
          }
        } else if (!selfClosing) {
          inParagraph++;
        } else {
          paragraphs.push({ text: "", isHeading: false });
        }
        break;
      case "t":
        if (!selfClosing) textMode = closing ? null : "t";
        break;
      case "delText":
      case "instrText":
        if (!selfClosing) textMode = closing ? null : "skip";
        break;
      case "del":
      case "moveFrom":
        if (!selfClosing) delDepth += closing ? -1 : 1;
        if (delDepth < 0) delDepth = 0;
        break;
      case "tab":
        if (!closing && inParagraph > 0 && delDepth === 0 && textMode === null) text += "\t";
        break;
      case "br":
      case "cr":
        if (!closing && inParagraph > 0 && delDepth === 0) text += "\n";
        break;
      case "pStyle": {
        const val = attr(attrs, "w:val") ?? "";
        if (/^(?:title|subtitle|heading\s*\d*)$/i.test(val) || /^Heading\d$/i.test(val)) heading = true;
        break;
      }
      case "outlineLvl": {
        const val = Number(attr(attrs, "w:val"));
        if (Number.isFinite(val) && val >= 0 && val <= 8) heading = true;
        break;
      }
    }
  }
  return paragraphs;
}

export function parseDocx(bytes: Uint8Array): { blocks: RawDocumentBlock[]; totalLines: number } {
  if (isCfb(bytes)) {
    if (containsUtf16(bytes, "EncryptionInfo")) throw new ParserAbort("password_protected");
    throw new ParserAbort("unsupported_format", "Legacy .doc files are not supported; save the file as .docx.");
  }
  if (!isZip(bytes)) throw new ParserAbort("unsupported_format", "The file is not a DOCX document.");
  const zip = openZip(bytes);
  const entry = zip.entries.find((e) => e.name === "word/document.xml");
  if (!entry) throw new ParserAbort("unsupported_format", "The file is not a DOCX document.");
  const raw = zip.read(entry, LIMITS.maxDocxXmlBytes);
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw new ParserAbort("encoding_error");
  }
  const paragraphs = extractDocxParagraphs(xml);

  const blocks: RawDocumentBlock[] = [];
  let heading: string | undefined;
  paragraphs.forEach((p, i) => {
    const body = p.text.replace(/[ \t]+$/gm, "").trim().normalize("NFC");
    if (body === "") return;
    if (p.isHeading) heading = body.replace(/\s+/g, " ");
    const block: RawDocumentBlock = { body, lineStart: i + 1, lineEnd: i + 1 };
    if (heading !== undefined) block.heading = heading;
    blocks.push(block);
  });
  if (blocks.length === 0) throw new ParserAbort("empty_source");
  return { blocks, totalLines: paragraphs.length };
}
