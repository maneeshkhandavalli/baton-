/**
 * PDF object syntax: lexer/parser for values, and a tolerant document loader that scans for
 * `N G obj` definitions (so a damaged xref table does not matter) and unpacks object streams.
 * Bounded by LIMITS (object count, nesting depth, decoded bytes).
 */

import { ParserAbort } from "../errors";
import { LIMITS } from "../limits";
import { decodeStream, type DecodeBudget } from "./filters";

export interface PdfName {
  t: "name";
  v: string;
}
export interface PdfString {
  t: "str";
  v: Uint8Array;
}
export interface PdfRef {
  t: "ref";
  n: number;
  g: number;
}
export interface PdfDict {
  t: "dict";
  v: Map<string, PdfValue>;
}
export interface PdfStream {
  t: "stream";
  dict: Map<string, PdfValue>;
  raw: Uint8Array;
}
export interface PdfOperator {
  t: "op";
  v: string;
}
export type PdfValue = null | boolean | number | PdfName | PdfString | PdfRef | PdfDict | PdfStream | PdfValue[];

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export function isName(v: PdfValue | undefined, name?: string): v is PdfName {
  return typeof v === "object" && v !== null && !Array.isArray(v) && v.t === "name" && (name === undefined || v.v === name);
}
export function isDict(v: PdfValue | undefined): v is PdfDict {
  return typeof v === "object" && v !== null && !Array.isArray(v) && v.t === "dict";
}
export function isStream(v: PdfValue | undefined): v is PdfStream {
  return typeof v === "object" && v !== null && !Array.isArray(v) && v.t === "stream";
}
export function isRef(v: PdfValue | undefined): v is PdfRef {
  return typeof v === "object" && v !== null && !Array.isArray(v) && v.t === "ref";
}
export function isString(v: PdfValue | undefined): v is PdfString {
  return typeof v === "object" && v !== null && !Array.isArray(v) && v.t === "str";
}

/** Byte-level lexer shared by object parsing and content streams. */
export class Lexer {
  pos = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  skipWs(): void {
    const b = this.bytes;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  private readRegular(): string {
    const b = this.bytes;
    const start = this.pos;
    while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) this.pos++;
    let s = "";
    for (let i = start; i < this.pos; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  private readName(): PdfName {
    this.pos++; // '/'
    const raw = this.readRegular();
    return { t: "name", v: raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) };
  }

  private readLiteralString(): PdfString {
    const b = this.bytes;
    this.pos++; // '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 0x5c) {
        const e = b[this.pos++];
        if (e === 0x6e) out.push(0x0a);
        else if (e === 0x72) out.push(0x0d);
        else if (e === 0x74) out.push(0x09);
        else if (e === 0x62) out.push(0x08);
        else if (e === 0x66) out.push(0x0c);
        else if (e === 0x0d) {
          if (b[this.pos] === 0x0a) this.pos++;
        } else if (e === 0x0a) {
          // line continuation
        } else if (e >= 0x30 && e <= 0x37) {
          let v = e - 0x30;
          for (let k = 0; k < 2 && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; k++) v = v * 8 + (b[this.pos++] - 0x30);
          out.push(v & 0xff);
        } else if (e !== undefined) out.push(e);
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        depth--;
        if (depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return { t: "str", v: Uint8Array.from(out) };
  }

  private readHexString(): PdfString {
    const b = this.bytes;
    this.pos++; // '<'
    const digits: number[] = [];
    while (this.pos < b.length && b[this.pos] !== 0x3e) {
      const c = b[this.pos++];
      const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
      if (v >= 0) digits.push(v);
    }
    this.pos++; // '>'
    if (digits.length % 2 === 1) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = digits[i * 2] * 16 + digits[i * 2 + 1];
    return { t: "str", v: out };
  }

  /** Reads one value or operator; returns undefined at EOF. `depth` bounds nesting. */
  read(depth = 0): PdfValue | PdfOperator | undefined {
    if (depth > LIMITS.maxPdfNesting) throw new ParserAbort("corrupt_file", "The PDF is nested too deeply.");
    this.skipWs();
    const b = this.bytes;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 0x2f) return this.readName();
    if (c === 0x28) return this.readLiteralString();
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) {
        this.pos += 2;
        const dict = new Map<string, PdfValue>();
        for (;;) {
          this.skipWs();
          if (this.pos >= b.length) break;
          if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) {
            this.pos += 2;
            break;
          }
          const key = this.read(depth + 1);
          if (key === undefined) break;
          if (!isName(key as PdfValue)) continue; // tolerate junk
          const value = this.readValue(depth + 1);
          dict.set((key as PdfName).v, value);
        }
        return { t: "dict", v: dict };
      }
      return this.readHexString();
    }
    if (c === 0x5b) {
      this.pos++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.skipWs();
        if (this.pos >= b.length) break;
        if (b[this.pos] === 0x5d) {
          this.pos++;
          break;
        }
        const v = this.read(depth + 1);
        if (v === undefined) break;
        if (typeof v === "object" && v !== null && !Array.isArray(v) && v.t === "op") {
          if (v.v === "R" && arr.length >= 2) {
            const g = arr.pop();
            const n = arr.pop();
            if (typeof n === "number" && typeof g === "number") arr.push({ t: "ref", n, g });
          }
          continue;
        }
        arr.push(v as PdfValue);
      }
      return arr;
    }
    if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
      this.pos++;
      return { t: "op", v: String.fromCharCode(c) };
    }
    const tok = this.readRegular();
    if (tok === "") {
      this.pos++;
      return { t: "op", v: "" };
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(tok)) return Number(tok);
    if (tok === "true") return true;
    if (tok === "false") return false;
    if (tok === "null") return null;
    return { t: "op", v: tok };
  }

  /** Reads a value in object context, resolving `n g R` into a reference. */
  readValue(depth = 0): PdfValue {
    const v = this.read(depth);
    if (v === undefined) return null;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
      const save = this.pos;
      const g = this.read(depth);
      if (typeof g === "number" && Number.isInteger(g)) {
        const r = this.read(depth);
        if (typeof r === "object" && r !== null && !Array.isArray(r) && r.t === "op" && r.v === "R") {
          return { t: "ref", n: v, g };
        }
      }
      this.pos = save;
      return v;
    }
    if (typeof v === "object" && v !== null && !Array.isArray(v) && v.t === "op") return null;
    return v as PdfValue;
  }
}

function latin1(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return s;
}

export interface PdfDocument {
  objects: Map<number, PdfValue>;
  trailers: Array<Map<string, PdfValue>>;
  resolve(v: PdfValue | undefined): PdfValue;
  decode(stream: PdfStream): Uint8Array | null;
  budget: DecodeBudget;
}

/**
 * Bounded parsing budget shared by every object, trailer and object-stream entry of one file.
 * Each parse is confined to a region (see `loadPdf`), and the regions are charged here, so total
 * parsing work is linear in the file size no matter how the file is damaged or crafted.
 */
class ParseBudget {
  private remaining: number = LIMITS.maxPdfParseBytes;

  charge(bytes: number): void {
    this.remaining -= bytes;
    if (this.remaining < 0) {
      throw new ParserAbort("corrupt_file", "The PDF's structure is malformed or too complex to read.");
    }
  }
}

/**
 * Linear-time repeated forward search for `needle`.
 *
 * It remembers both outcomes of its last scan:
 *  - a miss from p: `needle` is absent at or after p, so it is absent after any q >= p;
 *  - a hit h found from p: `needle` does not occur in [p, h), so for any q in [p, h] the first
 *    occurrence at or after q is h, with no rescan.
 * A new scan therefore only ever starts after the previous hit, so scanned ranges are disjoint
 * and the total work is O(text length) however many objects ask (a naive indexOf per object was
 * quadratic: 20,000 objects before one distant "endobj" rescanned the whole tail each time).
 */
export class ForwardSearch {
  private failedFrom = Infinity;
  private hitFrom = -1;
  private hitAt = -1;
  private readonly text: string;
  private readonly needle: string;
  /** Characters scanned so far (exposed for tests). */
  scanned = 0;

  constructor(text: string, needle: string) {
    this.text = text;
    this.needle = needle;
  }

  from(pos: number): number {
    if (pos >= this.failedFrom) return -1;
    if (this.hitAt >= pos && this.hitFrom <= pos) return this.hitAt;
    const i = this.text.indexOf(this.needle, pos);
    if (i < 0) {
      this.scanned += this.text.length - pos;
      this.failedFrom = pos;
    } else {
      this.scanned += i + this.needle.length - pos;
      this.hitFrom = pos;
      this.hitAt = i;
    }
    return i;
  }
}

/** Parses one value confined to bytes[start, end); returns the value and the absolute end position. */
function parseRegion(bytes: Uint8Array, start: number, end: number, budget: ParseBudget): { value: PdfValue; end: number } | null {
  if (end <= start) return null;
  budget.charge(end - start);
  // The lexer is total: malformed bytes yield tolerant values, and its only deliberate failure is
  // ParserAbort. Anything else is a programming defect and must propagate (D34), so there is no catch.
  const lexer = new Lexer(bytes.subarray(start, end));
  const value = lexer.readValue();
  lexer.skipWs();
  return { value, end: start + lexer.pos };
}

const OBJ_HEADER = /(\d{1,10})[ \t\r\n\f\0]+(\d{1,5})[ \t\r\n\f\0]+obj(?![A-Za-z])/g;

export function loadPdf(bytes: Uint8Array): PdfDocument {
  const text = latin1(bytes);
  const objects = new Map<number, PdfValue>();
  const trailers: Array<Map<string, PdfValue>> = [];
  const budget: DecodeBudget = { remaining: LIMITS.maxPdfTotalDecodedBytes, failures: 0 };
  const parseBudget = new ParseBudget();
  const endobj = new ForwardSearch(text, "endobj");
  const endstream = new ForwardSearch(text, "endstream");
  const objRe = new RegExp(OBJ_HEADER.source, "g");
  const nextHeaderRe = new RegExp(OBJ_HEADER.source, "g");
  let nextHeaderMissFrom = Infinity;
  let m: RegExpExecArray | null;
  let count = 0;

  while ((m = objRe.exec(text))) {
    if (++count > LIMITS.maxPdfObjects) throw new ParserAbort("too_large", "The PDF has too many objects.");
    const num = Number(m[1]);
    const bodyStart = m.index + m[0].length;

    // The object's value lies before its "endobj" and before the next object header; it never
    // extends past either, so an unterminated string or array cannot swallow the rest of the file.
    let regionEnd = Math.min(bytes.length, bodyStart + LIMITS.maxPdfObjectBytes);
    const eo = endobj.from(bodyStart);
    if (eo >= 0 && eo < regionEnd) regionEnd = eo;
    if (bodyStart < nextHeaderMissFrom) {
      nextHeaderRe.lastIndex = bodyStart;
      const next = nextHeaderRe.exec(text);
      if (next === null) nextHeaderMissFrom = bodyStart;
      else if (next.index < regionEnd) regionEnd = next.index;
    }

    const parsed = parseRegion(bytes, bodyStart, regionEnd, parseBudget);
    // Resume scanning where this object's region ended: regions never overlap.
    objRe.lastIndex = Math.max(objRe.lastIndex, parsed ? parsed.end : regionEnd);
    if (!parsed) continue;
    let value = parsed.value;

    if (isDict(value) && text.startsWith("stream", parsed.end)) {
      let start = parsed.end + 6;
      if (bytes[start] === 0x0d && bytes[start + 1] === 0x0a) start += 2;
      else if (bytes[start] === 0x0a || bytes[start] === 0x0d) start += 1;
      const len = value.v.get("Length");
      let end = -1;
      if (typeof len === "number" && Number.isInteger(len) && len >= 0 && start + len <= bytes.length) {
        // Accept the declared length only if "endstream" follows within a few EOL bytes.
        let p = start + len;
        while (p < bytes.length && p - (start + len) < 4 && (bytes[p] === 0x0a || bytes[p] === 0x0d || bytes[p] === 0x20)) p++;
        if (text.startsWith("endstream", p)) end = start + len;
      }
      if (end < 0) {
        const es = endstream.from(start);
        if (es < 0) continue;
        end = es;
        if (bytes[end - 1] === 0x0a) end--;
        if (bytes[end - 1] === 0x0d) end--;
      }
      value = { t: "stream", dict: value.v, raw: bytes.subarray(start, end) };
      objRe.lastIndex = Math.max(objRe.lastIndex, end);
    }
    objects.set(num, value);
  }

  const trailerRe = /trailer[\s\0]*<</g;
  while ((m = trailerRe.exec(text))) {
    const start = m.index + 7;
    const parsed = parseRegion(bytes, start, Math.min(bytes.length, start + LIMITS.maxPdfTrailerBytes), parseBudget);
    trailerRe.lastIndex = Math.max(trailerRe.lastIndex, parsed ? parsed.end : start + 1);
    if (parsed && isDict(parsed.value)) trailers.push(parsed.value.v);
  }

  const doc: PdfDocument = {
    objects,
    trailers,
    budget,
    resolve(v: PdfValue | undefined): PdfValue {
      let cur: PdfValue | undefined = v;
      for (let hops = 0; hops < 32 && isRef(cur); hops++) cur = objects.get(cur.n);
      return cur === undefined || isRef(cur) ? null : cur;
    },
    decode(stream: PdfStream): Uint8Array | null {
      return decodeStream(stream, doc, budget);
    },
  };

  // Cross-reference streams carry the trailer keys.
  for (const v of objects.values()) {
    if (isStream(v) && isName(v.dict.get("Type"), "XRef")) trailers.push(v.dict);
  }

  // Unpack object streams; objects defined directly take precedence. Each entry is parsed only
  // within its own slice [offset, next offset), so entries cannot re-read the whole stream.
  for (const v of Array.from(objects.values())) {
    if (!isStream(v) || !isName(v.dict.get("Type"), "ObjStm")) continue;
    const n = doc.resolve(v.dict.get("N"));
    const first = doc.resolve(v.dict.get("First"));
    if (typeof n !== "number" || typeof first !== "number" || first < 0) continue;
    const data = doc.decode(v);
    if (!data) continue;
    const header = new Lexer(data.subarray(0, Math.min(data.length, first)));
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < n && i < LIMITS.maxPdfObjects; i++) {
      const objNum = header.read();
      const offset = header.read();
      if (typeof objNum !== "number" || typeof offset !== "number" || offset < 0) break;
      pairs.push([objNum, offset]);
    }
    count += pairs.length;
    if (count > LIMITS.maxPdfObjects) throw new ParserAbort("too_large", "The PDF has too many objects.");
    const entries = pairs.map(([objNum, offset]) => ({ objNum, start: first + offset })).sort((a, b) => a.start - b.start);
    // nextStart[i] = the first entry start strictly after entries[i].start (linear, back to front).
    const nextStart = new Array<number>(entries.length);
    for (let i = entries.length - 1; i >= 0; i--) {
      const following = entries[i + 1];
      nextStart[i] = following === undefined ? data.length : following.start > entries[i].start ? following.start : nextStart[i + 1];
    }
    // Entries sharing an offset are parsed once, so slices are disjoint and work stays linear.
    const parsedAt = new Map<number, PdfValue | null>();
    entries.forEach((e, i) => {
      if (objects.has(e.objNum) || e.start >= data.length) return;
      let value = parsedAt.get(e.start);
      if (value === undefined) {
        const end = Math.min(nextStart[i], data.length, e.start + LIMITS.maxPdfObjectBytes);
        value = parseRegion(data, e.start, end, parseBudget)?.value ?? null;
        parsedAt.set(e.start, value);
      }
      if (value !== null) objects.set(e.objNum, value);
    });
  }
  return doc;
}
