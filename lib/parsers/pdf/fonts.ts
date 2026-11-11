/**
 * Font → Unicode decoding for PDF text extraction.
 *
 * Priority: the font's /ToUnicode CMap (bfchar, bfrange, codespace width); otherwise, for simple
 * fonts, /Encoding (WinAnsi, MacRoman subset, Standard, /Differences with Adobe glyph names and
 * uniXXXX names). Composite (Type0) fonts without /ToUnicode cannot be decoded without the
 * embedded font program and are reported as undecodable.
 *
 * Resource bounds (CMaps are attacker-controlled):
 *  - character codes are at most 2 bytes; wider codespace, bfchar and bfrange entries are ignored,
 *    so the code → text map has at most 65,536 keys;
 *  - bfrange expansion is capped per CMap (LIMITS.maxCMapRangeExpansion); past the cap the CMap
 *    is truncated and the decoder reports it;
 *  - a destination longer than 32 UTF-16 units is ignored (no huge strings copied per code);
 *  - decoders are cached per document (FontDecoderCache), so a CMap is parsed once, not per page.
 */

import { LIMITS } from "../limits";
import { Lexer, isDict, isName, isRef, isStream, isString, type PdfDocument, type PdfValue } from "./objects";

export interface FontDecoder {
  /** Bytes per character code (1 or 2). */
  codeBytes: 1 | 2;
  decodable: boolean;
  /** True when the ToUnicode CMap hit the expansion cap and was only partly read. */
  truncated: boolean;
  decode(bytes: Uint8Array): string;
}

const MAX_CODE_BYTES = 2;
const MAX_DEST_UNITS = 32;

// WinAnsi (cp1252) 0x80–0x9F; other bytes map to Latin-1.
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function winAnsi(code: number): string {
  return String.fromCharCode(CP1252[code] ?? code);
}

const GLYPHS: Record<string, string> = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&",
  quotesingle: "'", quoteright: "’", quoteleft: "‘", parenleft: "(", parenright: ")", asterisk: "*",
  plus: "+", comma: ",", hyphen: "-", minus: "−", period: ".", slash: "/", colon: ":", semicolon: ";",
  less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[", backslash: "\\",
  bracketright: "]", asciicircum: "^", underscore: "_", grave: "`", braceleft: "{", bar: "|",
  braceright: "}", asciitilde: "~", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", endash: "–", emdash: "—", bullet: "•",
  quotedblleft: "“", quotedblright: "”", ellipsis: "…", fi: "fi", fl: "fl", ff: "ff",
  ffi: "ffi", ffl: "ffl", rupee: "₹", Euro: "€", nbspace: "\u00A0", section: "§",
  copyright: "©", registered: "®", degree: "°", periodcentered: "·",
};

function glyphToUnicode(name: string): string | null {
  if (/^[A-Za-z]$/.test(name)) return name;
  if (GLYPHS[name] !== undefined) return GLYPHS[name];
  const uni = /^uni([0-9A-Fa-f]{4,6})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) {
    const cp = parseInt(uni[1], 16);
    if (cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) return String.fromCodePoint(cp);
  }
  return null;
}

function utf16be(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  if (bytes.length % 2 === 1) s += String.fromCharCode(bytes[bytes.length - 1]);
  return s;
}

function bytesToCode(bytes: Uint8Array): number {
  let v = 0;
  for (const b of bytes) v = v * 256 + b;
  return v;
}

export interface CMap {
  map: Map<number, string>;
  codeBytes: 1 | 2;
  truncated: boolean;
}

function codeOf(s: PdfValue): Uint8Array | null {
  return isString(s) && s.v.length >= 1 && s.v.length <= MAX_CODE_BYTES ? s.v : null;
}

function destOf(s: PdfValue): string | null {
  if (!isString(s) || s.v.length === 0 || s.v.length > MAX_DEST_UNITS * 2) return null;
  return utf16be(s.v);
}

/** Document-wide allowance of produced character codes, shared by every CMap of one file. */
export interface CMapBudget {
  remaining: number;
}

export function parseToUnicodeCMap(
  input: Uint8Array,
  budget: CMapBudget = { remaining: LIMITS.maxPdfCMapExpansionTotal },
): CMap {
  // Oversized streams are parsed only up to the cap and reported as truncated.
  const oversized = input.length > LIMITS.maxCMapStreamBytes;
  const data = oversized ? input.subarray(0, LIMITS.maxCMapStreamBytes) : input;
  const lexer = new Lexer(data);
  const map = new Map<number, string>();
  let codeBytes: 1 | 2 = 1;
  let expansion = 0;
  // Set when a budget stops parsing; `oversized` is reported separately so the capped prefix
  // of an oversized stream is still parsed.
  let truncated = false;
  const stack: Array<PdfValue | { t: "op"; v: string }> = [];
  let mode: "" | "codespace" | "bfchar" | "bfrange" = "";
  let guard = 0;
  /**
   * Charges `n` produced codes against this CMap's cap AND the document-wide budget; false (and
   * truncation) once either is reached.
   */
  const spend = (n: number): boolean => {
    if (expansion + n > LIMITS.maxCMapRangeExpansion || n > budget.remaining) {
      truncated = true;
      return false;
    }
    expansion += n;
    budget.remaining -= n;
    return true;
  };
  for (;;) {
    if (truncated) break;
    if (++guard > 2_000_000) {
      truncated = true;
      break;
    }
    const tok = lexer.read();
    if (tok === undefined) break;
    if (typeof tok === "object" && tok !== null && !Array.isArray(tok) && tok.t === "op") {
      const op = tok.v;
      if (op === "begincodespacerange") mode = "codespace";
      else if (op === "beginbfchar") mode = "bfchar";
      else if (op === "beginbfrange") mode = "bfrange";
      else if (op.startsWith("end")) {
        const items = stack.splice(0);
        if (mode === "codespace") {
          for (const it of items) {
            const c = codeOf(it as PdfValue);
            if (c && c.length === 2) codeBytes = 2;
          }
        } else if (mode === "bfchar") {
          for (let i = 0; i + 1 < items.length; i += 2) {
            const src = codeOf(items[i] as PdfValue);
            const dst = destOf(items[i + 1] as PdfValue);
            if (src === null || dst === null) continue;
            if (!spend(1)) break;
            if (src.length === 2) codeBytes = 2;
            map.set(bytesToCode(src), dst);
          }
        } else if (mode === "bfrange") {
          for (let i = 0; i + 2 < items.length; i += 3) {
            const lo = codeOf(items[i] as PdfValue);
            const hi = codeOf(items[i + 1] as PdfValue);
            const dst = items[i + 2] as PdfValue;
            if (lo === null || hi === null || lo.length !== hi.length) continue;
            if (lo.length === 2) codeBytes = 2;
            const a = bytesToCode(lo);
            const b = bytesToCode(hi);
            if (b < a) continue;
            if (Array.isArray(dst)) {
              const count = Math.min(dst.length, b - a + 1);
              if (!spend(count)) break;
              for (let k = 0; k < count; k++) {
                const d = destOf(dst[k]);
                if (d !== null) map.set(a + k, d);
              }
            } else {
              const base = destOf(dst);
              if (base === null) continue;
              if (!spend(b - a + 1)) break;
              const prefix = base.slice(0, -1);
              const lastCode = base.charCodeAt(base.length - 1);
              for (let c = a; c <= b; c++) map.set(c, prefix + String.fromCharCode((lastCode + (c - a)) & 0xffff));
            }
          }
        }
        mode = "";
      } else {
        // other operators (begincmap, def, …) reset operand collection outside sections
        if (mode === "") stack.length = 0;
      }
      continue;
    }
    if (mode !== "") {
      stack.push(tok);
      // A section never needs more operands than codes it may produce.
      if (stack.length > LIMITS.maxCMapRangeExpansion * 3) {
        truncated = true;
        break;
      }
    }
  }
  return { map, codeBytes, truncated: truncated || oversized };
}

function buildDifferences(doc: PdfDocument, enc: PdfValue): Map<number, string> {
  const diff = new Map<number, string>();
  if (!isDict(enc)) return diff;
  const d = doc.resolve(enc.v.get("Differences"));
  if (!Array.isArray(d)) return diff;
  let code = 0;
  for (const item of d) {
    const v = doc.resolve(item);
    if (typeof v === "number") code = v;
    else if (isName(v)) {
      const u = glyphToUnicode(v.v);
      if (u !== null) diff.set(code, u);
      code++;
    }
  }
  return diff;
}

/** Resolves a font's /ToUnicode entry to a parsed CMap (or null). */
export type CMapResolver = (toUnicode: PdfValue | undefined) => CMap | null;

/** Uncached resolver: decodes and parses the stream every time (used outside a document cache). */
function directCMapResolver(doc: PdfDocument): CMapResolver {
  const budget: CMapBudget = { remaining: LIMITS.maxPdfCMapExpansionTotal };
  return (toUnicode) => {
    const stream = doc.resolve(toUnicode);
    if (!isStream(stream)) return null;
    const data = doc.decode(stream);
    return data ? parseToUnicodeCMap(data, budget) : null;
  };
}

export function fontDecoder(doc: PdfDocument, fontValue: PdfValue, cmapFor: CMapResolver = directCMapResolver(doc)): FontDecoder {
  const font = doc.resolve(fontValue);
  if (!isDict(font)) return simpleDecoder(new Map());
  const subtype = doc.resolve(font.v.get("Subtype"));
  const isType0 = isName(subtype, "Type0");

  const cmap = cmapFor(font.v.get("ToUnicode"));
  if (cmap && cmap.map.size > 0) {
    const codeBytes: 1 | 2 = isType0 ? 2 : cmap.codeBytes;
    return {
      codeBytes,
      decodable: true,
      truncated: cmap.truncated,
      decode(bytes) {
        let s = "";
        for (let i = 0; i + codeBytes <= bytes.length; i += codeBytes) {
          const code = codeBytes === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i];
          const u = cmap.map.get(code);
          if (u !== undefined) s += u;
          else if (codeBytes === 1) s += winAnsi(code);
        }
        return s;
      },
    };
  }
  if (isType0) return UNDECODABLE;
  const enc = doc.resolve(font.v.get("Encoding"));
  return simpleDecoder(buildDifferences(doc, enc));
}

function simpleDecoder(differences: Map<number, string>): FontDecoder {
  return {
    codeBytes: 1,
    decodable: true,
    truncated: false,
    decode(bytes) {
      let s = "";
      for (const b of bytes) s += differences.get(b) ?? winAnsi(b);
      return s;
    },
  };
}

const UNDECODABLE: FontDecoder = { codeBytes: 2, decodable: false, truncated: false, decode: () => "" };

/**
 * Per-document font decoder cache.
 *  - Fonts are keyed by indirect object number (or by the inline dictionary object), so every page
 *    and form that uses a font shares one decoder.
 *  - Parsed CMaps are keyed by their UNDERLYING /ToUnicode stream object, so many distinct fonts
 *    pointing at one stream decode and parse it once (the second audit's N2 amplification).
 *  - All CMaps draw from one document-wide expansion budget (LIMITS.maxPdfCMapExpansionTotal).
 *  - The number of distinct fonts is capped (LIMITS.maxPdfFonts); beyond it fonts are treated as
 *    undecodable (their text is skipped and reported) rather than parsed.
 */
export class FontDecoderCache {
  private readonly byRef = new Map<number, FontDecoder>();
  private readonly byObject = new WeakMap<object, FontDecoder>();
  private readonly cmapByRef = new Map<number, CMap | null>();
  private readonly cmapByObject = new WeakMap<object, CMap | null>();
  private readonly cmapBudget: CMapBudget = { remaining: LIMITS.maxPdfCMapExpansionTotal };
  private distinct = 0;
  private readonly doc: PdfDocument;
  /** Number of decoder constructions (exposed for tests). */
  builds = 0;
  /** Number of ToUnicode streams decoded and parsed (exposed for tests). */
  cmapParses = 0;
  /** True if any cached decoder came from a truncated CMap. */
  anyTruncated = false;
  /** True if the distinct-font cap was reached. */
  capped = false;

  constructor(doc: PdfDocument) {
    this.doc = doc;
  }

  /** Parsed CMap for a /ToUnicode entry, cached by stream object. */
  private cmapFor = (toUnicode: PdfValue | undefined): CMap | null => {
    if (toUnicode === undefined) return null;
    if (isRef(toUnicode)) {
      if (this.cmapByRef.has(toUnicode.n)) return this.cmapByRef.get(toUnicode.n) ?? null;
      const cmap = this.parseCMap(toUnicode);
      this.cmapByRef.set(toUnicode.n, cmap);
      return cmap;
    }
    const resolved = this.doc.resolve(toUnicode);
    if (typeof resolved !== "object" || resolved === null) return null;
    if (this.cmapByObject.has(resolved)) return this.cmapByObject.get(resolved) ?? null;
    const cmap = this.parseCMap(toUnicode);
    this.cmapByObject.set(resolved, cmap);
    return cmap;
  };

  private parseCMap(toUnicode: PdfValue): CMap | null {
    const stream = this.doc.resolve(toUnicode);
    if (!isStream(stream)) return null;
    const data = this.doc.decode(stream);
    if (!data) return null;
    this.cmapParses++;
    const cmap = parseToUnicodeCMap(data, this.cmapBudget);
    if (cmap.truncated) this.anyTruncated = true;
    return cmap;
  }

  get(fontValue: PdfValue): FontDecoder {
    if (isRef(fontValue)) {
      const hit = this.byRef.get(fontValue.n);
      if (hit) return hit;
      const d = this.build(fontValue);
      this.byRef.set(fontValue.n, d);
      return d;
    }
    const resolved = this.doc.resolve(fontValue);
    if (typeof resolved !== "object" || resolved === null) return this.build(fontValue);
    const hit = this.byObject.get(resolved);
    if (hit) return hit;
    const d = this.build(fontValue);
    this.byObject.set(resolved, d);
    return d;
  }

  private build(fontValue: PdfValue): FontDecoder {
    if (++this.distinct > LIMITS.maxPdfFonts) {
      this.capped = true;
      return UNDECODABLE;
    }
    this.builds++;
    const d = fontDecoder(this.doc, fontValue, this.cmapFor);
    if (d.truncated) this.anyTruncated = true;
    return d;
  }
}
