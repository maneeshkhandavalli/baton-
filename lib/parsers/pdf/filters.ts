/**
 * PDF stream filters: FlateDecode (with PNG/TIFF predictors), ASCIIHexDecode, ASCII85Decode.
 * Image filters (DCT, JPX, CCITT, JBIG2) and LZW return null: their streams are skipped.
 * Every decode is capped per stream and against a per-document budget.
 */

import { inflateSync, constants as zlibConstants } from "node:zlib";

import { ParserAbort } from "../errors";
import { LIMITS } from "../limits";
import type { PdfStream, PdfValue } from "./objects";

export interface DecodeBudget {
  remaining: number;
  failures: number;
}

interface Resolver {
  resolve(v: PdfValue | undefined): PdfValue;
}

function asArray(v: PdfValue): PdfValue[] {
  return Array.isArray(v) ? v : v === null ? [] : [v];
}

/**
 * Inflates one stream. Returns null for corrupt deflate data (a zlib "Z_*" error), throws
 * `too_large` when the output cap is hit, and lets any other error propagate (programming defect).
 */
function inflate(data: Uint8Array, cap: number): Uint8Array | null {
  try {
    const buf = inflateSync(data, { maxOutputLength: cap, finishFlush: zlibConstants.Z_SYNC_FLUSH });
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (e instanceof RangeError || code === "ERR_BUFFER_TOO_LARGE") {
      throw new ParserAbort("too_large", "The PDF expands to more data than is supported.");
    }
    if (typeof code === "string" && code.startsWith("Z_")) return null;
    throw e;
  }
}

function asciiHex(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let hi = -1;
  for (const c of data) {
    if (c === 0x3e) break;
    const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
    if (v < 0) continue;
    if (hi < 0) hi = v;
    else {
      out.push(hi * 16 + v);
      hi = -1;
    }
  }
  if (hi >= 0) out.push(hi * 16);
  return Uint8Array.from(out);
}

function ascii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let group: number[] = [];
  let i = 0;
  if (data[0] === 0x3c && data[1] === 0x7e) i = 2;
  for (; i < data.length; i++) {
    const c = data[i];
    if (c === 0x7e) break;
    if (c === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 0x21 || c > 0x75) continue;
    group.push(c - 33);
    if (group.length === 5) {
      let v = 0;
      for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
      group = [];
    }
  }
  if (group.length > 1) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    out.push(...bytes.slice(0, n - 1));
  }
  return Uint8Array.from(out);
}

function applyPredictor(data: Uint8Array, parms: Map<string, PdfValue> | null): Uint8Array {
  if (!parms) return data;
  const predictor = Number(parms.get("Predictor") ?? 1);
  if (predictor < 10) return data; // 1 = none; 2 (TIFF) is rare in text streams
  const colors = Number(parms.get("Colors") ?? 1);
  const bpc = Number(parms.get("BitsPerComponent") ?? 8);
  const columns = Number(parms.get("Columns") ?? 1);
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  if (!(rowLen > 0)) return data;
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowLen + 1)];
    const src = r * (rowLen + 1) + 1;
    const dst = r * rowLen;
    for (let i = 0; i < rowLen; i++) {
      const raw = data[src + i];
      const left = i >= bpp ? out[dst + i - bpp] : 0;
      const up = r > 0 ? out[dst - rowLen + i] : 0;
      const upLeft = r > 0 && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
      let v: number;
      if (type === 1) v = raw + left;
      else if (type === 2) v = raw + up;
      else if (type === 3) v = raw + ((left + up) >> 1);
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else v = raw;
      out[dst + i] = v & 0xff;
    }
  }
  return out;
}

export function decodeStream(stream: PdfStream, doc: Resolver, budget: DecodeBudget): Uint8Array | null {
  const filters = asArray(doc.resolve(stream.dict.get("Filter") ?? null));
  const parmsList = asArray(doc.resolve(stream.dict.get("DecodeParms") ?? null));
  let data: Uint8Array = stream.raw;
  for (let i = 0; i < filters.length; i++) {
    const f = doc.resolve(filters[i]);
    const name = typeof f === "object" && f !== null && !Array.isArray(f) && f.t === "name" ? f.v : "";
    const parmsValue = doc.resolve(parmsList[i] ?? null);
    const parms =
      typeof parmsValue === "object" && parmsValue !== null && !Array.isArray(parmsValue) && parmsValue.t === "dict"
        ? parmsValue.v
        : null;
    const cap = Math.min(LIMITS.maxPdfStreamBytes, budget.remaining);
    if (name === "FlateDecode" || name === "Fl") {
      const inflated = inflate(data, cap);
      if (inflated === null) {
        budget.failures++;
        return null;
      }
      data = applyPredictor(inflated, parms);
    } else if (name === "ASCIIHexDecode" || name === "AHx") data = asciiHex(data);
    else if (name === "ASCII85Decode" || name === "A85") data = ascii85(data);
    else return null;
  }
  budget.remaining -= data.length;
  if (budget.remaining < 0) throw new ParserAbort("too_large", "The PDF expands to more data than is supported.");
  return data;
}
