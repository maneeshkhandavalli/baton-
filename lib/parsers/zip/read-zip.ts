/**
 * Minimal, defensive ZIP reader (no dependency; uses node:zlib for DEFLATE).
 *
 * - Reads the central directory, never trusts local headers for sizes.
 * - Supports methods 0 (stored) and 8 (deflate). Anything else is `unsupported_format`.
 * - Encrypted entries (general-purpose flag bit 0) are `password_protected`.
 * - ZIP64 archives are `unsupported_format` (a 25 MB upload never needs ZIP64).
 * - Zip-bomb guards: declared size limit, compression-ratio limit, and an inflate output cap.
 * - CRC-32 of every entry we read is verified.
 * Entry names are only compared, never used as filesystem paths.
 */

import { inflateRawSync } from "node:zlib";

import { ParserAbort } from "../errors";
import { LIMITS } from "../limits";
import { crc32 } from "./crc32";

export interface ZipEntry {
  name: string;
  method: number;
  encrypted: boolean;
  compressedSize: number;
  uncompressedSize: number;
  crc: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

export interface ZipArchive {
  entries: ZipEntry[];
  read(entry: ZipEntry, maxBytes?: number): Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeName(raw: Uint8Array, utf8: boolean): string {
  if (utf8) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch (e) {
      if (!(e instanceof TypeError)) throw e; // only invalid UTF-8 falls through
      // fall through to latin1-ish decoding
    }
  }
  // CP437 is the spec default; for name matching ASCII is what matters. Map high bytes verbatim.
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return s;
}

export function openZip(bytes: Uint8Array): ZipArchive {
  const dv = view(bytes);
  // EOCD is in the last 22 + 65535 bytes.
  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ParserAbort("corrupt_file", "The ZIP archive's directory is missing.");

  const totalEntries = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ParserAbort("unsupported_format", "ZIP64 archives are not supported.");
  }
  if (totalEntries > LIMITS.maxZipEntries) throw new ParserAbort("too_large", "The ZIP archive has too many files.");
  if (cdOffset + cdSize > eocd) throw new ParserAbort("corrupt_file", "The ZIP archive's directory is damaged.");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < totalEntries; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== CDH_SIG) {
      throw new ParserAbort("corrupt_file", "The ZIP archive's directory is damaged.");
    }
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen > bytes.length) throw new ParserAbort("corrupt_file", "The ZIP archive's directory is damaged.");
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & 0x0800) !== 0);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new ParserAbort("unsupported_format", "ZIP64 archives are not supported.");
    }
    entries.push({
      name,
      method,
      encrypted: (flags & 0x0001) !== 0,
      compressedSize,
      uncompressedSize,
      crc,
      localHeaderOffset,
      isDirectory: name.endsWith("/"),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  function read(entry: ZipEntry, maxBytes: number = LIMITS.maxZipEntryBytes): Uint8Array {
    if (entry.encrypted) throw new ParserAbort("password_protected");
    if (entry.method !== 0 && entry.method !== 8) {
      throw new ParserAbort("unsupported_format", "The ZIP archive uses an unsupported compression method.");
    }
    if (entry.uncompressedSize > maxBytes) throw new ParserAbort("too_large", "A file inside the ZIP archive is too large.");
    if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > LIMITS.maxZipCompressionRatio) {
      throw new ParserAbort("too_large", "A file inside the ZIP archive is suspiciously highly compressed.");
    }
    const lh = entry.localHeaderOffset;
    if (lh + 30 > bytes.length || dv.getUint32(lh, true) !== LFH_SIG) {
      throw new ParserAbort("corrupt_file", "A file inside the ZIP archive is damaged.");
    }
    const dataStart = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > bytes.length) throw new ParserAbort("corrupt_file", "A file inside the ZIP archive is truncated.");
    const compressed = bytes.subarray(dataStart, dataEnd);

    let out: Uint8Array;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) {
        throw new ParserAbort("corrupt_file", "A file inside the ZIP archive is damaged.");
      }
      out = compressed;
    } else {
      try {
        // Cap output at the declared size (+1 to detect lies) and the hard limit.
        const buf = inflateRawSync(compressed, { maxOutputLength: Math.min(maxBytes, entry.uncompressedSize) + 1 });
        out = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (e) {
        if (e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
          throw new ParserAbort("too_large", "A file inside the ZIP archive is larger than declared.");
        }
        throw new ParserAbort("corrupt_file", "A file inside the ZIP archive could not be decompressed.");
      }
    }
    if (out.length !== entry.uncompressedSize) {
      throw new ParserAbort("corrupt_file", "A file inside the ZIP archive does not match its declared size.");
    }
    if (crc32(out) !== entry.crc) {
      throw new ParserAbort("corrupt_file", "A file inside the ZIP archive failed its integrity check.");
    }
    return out;
  }

  return { entries, read };
}
