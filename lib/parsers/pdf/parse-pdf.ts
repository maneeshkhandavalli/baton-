/**
 * PDF → document blocks (best-effort text layer; no dependency, no OCR).
 *
 * Walks the page tree from the catalog, interprets each page's content streams (and Form
 * XObjects it draws) for text operators (Tj, TJ, ', ", Td, TD, Tm, T*, TL, Tf), and groups text
 * lines into paragraph blocks by vertical spacing. Each block records `page` (1-based) and
 * `lineStart/lineEnd` (1-based line numbers within that page).
 *
 * Failure modes:
 *  - not a PDF → `unsupported_format`; encrypted (/Encrypt in a trailer) → `password_protected`;
 *  - no page tree → `corrupt_file`;
 *  - pages but no extractable text → `no_text_layer` (scanned documents; OCR is out of scope);
 *  - text drawn only with fonts that cannot be decoded → `unsupported_format`.
 */

import type { RawDocumentBlock } from "../build-source";
import { ParserAbort } from "../errors";
import { LIMITS } from "../limits";
import type { WarningCollector } from "../warnings";
import { FontDecoderCache, type FontDecoder } from "./fonts";
import {
  Lexer,
  isDict,
  isName,
  isRef,
  isStream,
  isString,
  loadPdf,
  type PdfDocument,
  type PdfOperator,
  type PdfValue,
} from "./objects";

export function isPdf(bytes: Uint8Array): boolean {
  const head = Math.min(bytes.length, 1024);
  for (let i = 0; i + 5 <= head; i++) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

interface TextLine {
  text: string;
  y: number;
  /** Largest effective font size used on the line (text-space units), 0 if unknown. */
  size: number;
}

interface PageStats {
  undecodableRuns: number;
  decodedRuns: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function dictOf(doc: PdfDocument, v: PdfValue | undefined): Map<string, PdfValue> | null {
  const r = doc.resolve(v);
  return isDict(r) ? r.v : isStream(r) ? r.dict : null;
}

class PageInterpreter {
  lines: TextLine[] = [];
  private current = "";
  private currentY: number | null = null;
  private currentSize = 0;
  /** Shared across all pages of the document, so each font's CMap is parsed once. */
  private readonly fonts: FontDecoderCache;
  private readonly doc: PdfDocument;
  readonly stats: PageStats = { undecodableRuns: 0, decodedRuns: 0 };

  constructor(doc: PdfDocument, fonts: FontDecoderCache) {
    this.doc = doc;
    this.fonts = fonts;
  }

  private newLine(y: number | null): void {
    if (this.current.trim() !== "") {
      this.lines.push({ text: this.current.replace(/\s+$/, ""), y: this.currentY ?? 0, size: this.currentSize });
    }
    this.current = "";
    this.currentSize = 0;
    this.currentY = y;
  }

  finish(): void {
    this.newLine(null);
  }

  run(content: Uint8Array, resources: Map<string, PdfValue> | null, depth: number): void {
    if (depth > 8) return;
    const doc = this.doc;
    const fonts = dictOf(doc, resources?.get("Font"));
    const xobjects = dictOf(doc, resources?.get("XObject"));
    const lexer = new Lexer(content);
    const operands: Array<PdfValue> = [];
    let font: FontDecoder | null = null;
    let fontSize = 0;
    let tm: Matrix = IDENTITY;
    let tlm: Matrix = IDENTITY;
    let leading = 0;
    let guard = 0;

    // Font names are scoped to this content stream's own resources (a form XObject may reuse a
    // name for a different font), so names are resolved here and decoders come from the
    // document-wide cache keyed by font object.
    const fontFor = (name: string): FontDecoder | null => {
      const ref = fonts?.get(name);
      return ref === undefined ? null : this.fonts.get(ref);
    };
    const moveTo = (m: Matrix) => {
      const prevY = tlm[5];
      const prevX = tlm[4];
      tlm = m;
      tm = m;
      if (this.currentY === null) this.currentY = m[5];
      else if (Math.abs(m[5] - prevY) > 0.01) this.newLine(m[5]);
      else if (m[4] > prevX && this.current !== "" && !/\s$/.test(this.current)) this.current += " ";
    };
    const show = (s: PdfValue) => {
      if (!isString(s)) return;
      if (!font) {
        this.stats.undecodableRuns++;
        return;
      }
      if (!font.decodable) {
        this.stats.undecodableRuns++;
        return;
      }
      const text = font.decode(s.v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
      if (text !== "") {
        this.stats.decodedRuns++;
        this.currentSize = Math.max(this.currentSize, Math.abs(fontSize * (Math.hypot(tm[2], tm[3]) || 1)));
      }
      if (this.currentY === null) this.currentY = tm[5];
      this.current += text;
    };

    for (;;) {
      if (++guard > 5_000_000) break;
      const tok = lexer.read();
      if (tok === undefined) break;
      if (!(typeof tok === "object" && tok !== null && !Array.isArray(tok) && tok.t === "op")) {
        operands.push(tok as PdfValue);
        if (operands.length > 64) operands.shift();
        continue;
      }
      const op = (tok as PdfOperator).v;
      const num = (i: number) => {
        const v = operands[operands.length - i];
        return typeof v === "number" ? v : 0;
      };
      switch (op) {
        case "BT":
          tm = IDENTITY;
          tlm = IDENTITY;
          break;
        case "ET":
          break;
        case "Tf": {
          const name = operands[operands.length - 2];
          font = isName(name) ? fontFor(name.v) : null;
          fontSize = num(1);
          break;
        }
        case "TL":
          leading = num(1);
          break;
        case "Td":
          moveTo(mul([1, 0, 0, 1, num(2), num(1)], tlm));
          break;
        case "TD":
          leading = -num(1);
          moveTo(mul([1, 0, 0, 1, num(2), num(1)], tlm));
          break;
        case "Tm":
          moveTo([num(6), num(5), num(4), num(3), num(2), num(1)]);
          break;
        case "T*":
          moveTo(mul([1, 0, 0, 1, 0, -leading], tlm));
          break;
        case "Tj":
          show(operands[operands.length - 1]);
          break;
        case "'":
          moveTo(mul([1, 0, 0, 1, 0, -leading], tlm));
          show(operands[operands.length - 1]);
          break;
        case '"':
          moveTo(mul([1, 0, 0, 1, 0, -leading], tlm));
          show(operands[operands.length - 1]);
          break;
        case "TJ": {
          const arr = operands[operands.length - 1];
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (typeof item === "number") {
                if (item < -200 && this.current !== "" && !/\s$/.test(this.current)) this.current += " ";
              } else show(item);
            }
          }
          break;
        }
        case "Do": {
          const name = operands[operands.length - 1];
          const xo = isName(name) ? doc.resolve(xobjects?.get(name.v)) : null;
          if (isStream(xo) && isName(xo.dict.get("Subtype"), "Form")) {
            const data = doc.decode(xo);
            if (data) {
              const own = dictOf(doc, xo.dict.get("Resources"));
              this.run(data, own ?? resources, depth + 1);
            }
          }
          break;
        }
        case "BI": {
          // Skip inline image data: find "ID", then the matching "EI".
          const b = lexer.bytes;
          let p = lexer.pos;
          while (p + 1 < b.length && !(b[p] === 0x49 && b[p + 1] === 0x44 && (b[p + 2] === 0x20 || b[p + 2] === 0x0a || b[p + 2] === 0x0d))) p++;
          p += 3;
          while (
            p + 2 < b.length &&
            !(
              (b[p - 1] === 0x20 || b[p - 1] === 0x0a || b[p - 1] === 0x0d) &&
              b[p] === 0x45 &&
              b[p + 1] === 0x49 &&
              (b[p + 2] === 0x20 || b[p + 2] === 0x0a || b[p + 2] === 0x0d)
            )
          )
            p++;
          lexer.pos = Math.min(b.length, p + 2);
          break;
        }
      }
      operands.length = 0;
    }
  }
}

function linesToBlocks(lines: TextLine[], page: number): RawDocumentBlock[] {
  if (lines.length === 0) return [];
  // A loop, not Math.min(...gaps): spreading one argument per line overflows the stack on huge pages.
  let minGap = Infinity;
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0 && g < minGap) minGap = g;
  }
  if (minGap === Infinity) minGap = 0;

  const blocks: RawDocumentBlock[] = [];
  let start = 0;
  const emit = (from: number, to: number) => {
    const body = lines
      .slice(from, to + 1)
      .map((l) => l.text)
      .join("\n")
      .normalize("NFC")
      .trim();
    if (body !== "") blocks.push({ body, page, lineStart: from + 1, lineEnd: to + 1 });
  };
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    // A paragraph break is a gap well above normal line spacing (about 1.2 x the font size), or,
    // without a known size, well above the tightest spacing on the page. Moving up = new column.
    const size = Math.max(lines[i - 1].size, lines[i].size);
    const isBreak = g <= 0 || (size > 0 ? g > size * 1.6 : minGap > 0 && g > minGap * 1.5);
    if (isBreak) {
      emit(start, i - 1);
      start = i;
    }
  }
  emit(start, lines.length - 1);
  return blocks;
}

function collectPages(doc: PdfDocument, root: Map<string, PdfValue>): Array<{ page: Map<string, PdfValue>; resources: Map<string, PdfValue> | null }> {
  const pages: Array<{ page: Map<string, PdfValue>; resources: Map<string, PdfValue> | null }> = [];
  const seen = new Set<number>();
  const visit = (v: PdfValue | undefined, inherited: Map<string, PdfValue> | null, depth: number) => {
    if (depth > LIMITS.maxPdfNesting) return;
    if (isRef(v)) {
      if (seen.has(v.n)) return;
      seen.add(v.n);
    }
    const node = dictOf(doc, v);
    if (!node) return;
    const resources = dictOf(doc, node.get("Resources")) ?? inherited;
    const kids = doc.resolve(node.get("Kids"));
    if (Array.isArray(kids) && !isName(node.get("Type"), "Page")) {
      for (const k of kids) {
        visit(k, resources, depth + 1);
        if (pages.length >= LIMITS.maxPdfPages) return;
      }
    } else {
      pages.push({ page: node, resources });
    }
  };
  visit(root.get("Pages"), null, 0);
  return pages;
}

export function parsePdf(bytes: Uint8Array, warnings: WarningCollector): { blocks: RawDocumentBlock[]; totalLines: number } {
  if (!isPdf(bytes)) throw new ParserAbort("unsupported_format", "The file is not a PDF.");
  const doc = loadPdf(bytes);
  if (doc.trailers.some((t) => t.has("Encrypt"))) throw new ParserAbort("password_protected");

  let root: Map<string, PdfValue> | null = null;
  for (let i = doc.trailers.length - 1; i >= 0 && !root; i--) root = dictOf(doc, doc.trailers[i].get("Root"));
  if (!root) {
    for (const v of doc.objects.values()) {
      if (isDict(v) && isName(v.v.get("Type"), "Catalog")) root = v.v;
    }
  }
  if (!root) throw new ParserAbort("corrupt_file", "The PDF's document catalog is missing.");

  const pages = collectPages(doc, root);
  if (pages.length === 0) throw new ParserAbort("corrupt_file", "The PDF has no pages.");
  if (pages.length >= LIMITS.maxPdfPages) {
    warnings.add("pdf_page_limit", `Only the first ${LIMITS.maxPdfPages} pages were read.`);
  }

  const blocks: RawDocumentBlock[] = [];
  let totalLines = 0;
  let undecodable = 0;
  let decoded = 0;
  const fontCache = new FontDecoderCache(doc);
  pages.forEach(({ page, resources }, idx) => {
    const interp = new PageInterpreter(doc, fontCache);
    const contents = doc.resolve(page.get("Contents"));
    const streams = Array.isArray(contents) ? contents.map((c) => doc.resolve(c)) : [contents];
    const parts: Uint8Array[] = [];
    for (const s of streams) {
      if (!isStream(s)) continue;
      const data = doc.decode(s);
      if (data) parts.push(data);
      else warnings.add("pdf_stream_skipped", "A page content stream uses an unsupported encoding and was skipped.");
    }
    // Content streams of one page are concatenated (they may split tokens across streams).
    const total = parts.reduce((n, p) => n + p.length + 1, 0);
    const joined = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      joined.set(p, off);
      off += p.length;
      joined[off++] = 0x0a;
    }
    interp.run(joined, resources, 0);
    interp.finish();
    undecodable += interp.stats.undecodableRuns;
    decoded += interp.stats.decodedRuns;
    totalLines += interp.lines.length;
    blocks.push(...linesToBlocks(interp.lines, idx + 1));
    if (blocks.length > LIMITS.maxMessagesPerSource) {
      throw new ParserAbort("too_large", `The document has more than ${LIMITS.maxMessagesPerSource} blocks.`);
    }
  });

  if (fontCache.anyTruncated) {
    warnings.add("pdf_cmap_truncated", "A font's character map was too large and was only partly read.");
  }
  if (fontCache.capped) {
    warnings.add("pdf_font_limit", `Only the first ${LIMITS.maxPdfFonts} fonts were decoded.`);
  }
  if (doc.budget.failures > 0) {
    warnings.add("pdf_decode_failures", `${doc.budget.failures} stream(s) could not be decompressed and were skipped.`);
  }
  if (blocks.length === 0) {
    if (undecodable > 0 && decoded === 0) {
      throw new ParserAbort("unsupported_format", "The PDF's text uses fonts that cannot be decoded.");
    }
    throw new ParserAbort("no_text_layer");
  }
  if (undecodable > 0) {
    warnings.add("pdf_undecodable_text", "Some text in the PDF uses fonts that cannot be decoded and was skipped.");
  }
  return { blocks, totalLines };
}
