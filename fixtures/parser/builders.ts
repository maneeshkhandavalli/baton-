/**
 * Deterministic builders for synthetic binary fixtures (ZIP, DOCX, PDF). Test-only.
 * Everything they produce is synthetic; no real exports, names or numbers.
 */

import { deflateRawSync, deflateSync } from "node:zlib";

import { crc32 } from "../../lib/parsers/zip/crc32";

const enc = new TextEncoder();

export function bytesOf(s: string): Uint8Array {
  return enc.encode(s);
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export interface ZipInput {
  name: string;
  data: Uint8Array | string;
  /** "deflate" (default) or "store". */
  method?: "deflate" | "store";
  /** Sets the "encrypted" flag bit without encrypting (to test detection). */
  encryptedFlag?: boolean;
  /** Overrides the declared uncompressed size (to test zip-bomb / lying headers). */
  declaredSize?: number;
  /** Corrupts the stored CRC. */
  badCrc?: boolean;
  /**
   * Streaming-writer layout (general-purpose flag bit 3, as Android exports use): the local header
   * carries zero CRC and sizes, and a data descriptor follows the data. The central directory is exact.
   */
  dataDescriptor?: boolean;
  /** Overrides the compression-method field (e.g. 99 = AES, 12 = bzip2) without changing the data. */
  methodField?: number;
}

export function buildZip(entries: ZipInput[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === "string" ? bytesOf(e.data) : e.data;
    const method = e.method === "store" ? 0 : 8;
    const body = method === 0 ? raw : new Uint8Array(deflateRawSync(raw));
    const crc = e.badCrc ? (crc32(raw) ^ 0xffff) >>> 0 : crc32(raw);
    const name = bytesOf(e.name);
    const flags = 0x0800 | (e.encryptedFlag ? 1 : 0) | (e.dataDescriptor ? 0x0008 : 0);
    const size = e.declaredSize ?? raw.length;
    const methodField = e.methodField ?? method;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, flags, true);
    lh.setUint16(8, methodField, true);
    if (!e.dataDescriptor) {
      lh.setUint32(14, crc, true);
      lh.setUint32(18, body.length, true);
      lh.setUint32(22, size, true);
    }
    lh.setUint16(26, name.length, true);
    let descriptor = new Uint8Array(0);
    if (e.dataDescriptor) {
      const dd = new DataView(new ArrayBuffer(16));
      dd.setUint32(0, 0x08074b50, true);
      dd.setUint32(4, crc, true);
      dd.setUint32(8, body.length, true);
      dd.setUint32(12, size, true);
      descriptor = new Uint8Array(dd.buffer);
    }
    const local = concat([new Uint8Array(lh.buffer), name, body, descriptor]);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, flags, true);
    ch.setUint16(10, methodField, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    centrals.push(concat([new Uint8Array(ch.buffer), name]));
    locals.push(local);
    offset += local.length;
  }
  const cd = concat(centrals);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cd.length, true);
  eocd.setUint32(16, offset, true);
  return concat([...locals, cd, new Uint8Array(eocd.buffer)]);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface DocxParagraph {
  text: string;
  style?: string; // e.g. "Heading1"
  /** Text inside a tracked deletion; must never appear in output. */
  deleted?: string;
}

export function buildDocx(paragraphs: DocxParagraph[]): Uint8Array {
  const body = paragraphs
    .map((p) => {
      const ppr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : "";
      const runs = p.text
        .split("\t")
        .map((part, i) => `${i > 0 ? "<w:r><w:tab/></w:r>" : ""}<w:r><w:t xml:space="preserve">${xmlEscape(part)}</w:t></w:r>`)
        .join("");
      const del = p.deleted ? `<w:del w:id="1" w:author="x"><w:r><w:delText>${xmlEscape(p.deleted)}</w:delText></w:r></w:del>` : "";
      return `<w:p>${ppr}${runs}${del}</w:p>`;
    })
    .join("");
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return buildZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>` },
    { name: "_rels/.rels", data: `<?xml version="1.0"?><Relationships/>` },
    { name: "word/document.xml", data: documentXml },
    { name: "word/media/image1.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
  ]);
}

export interface PdfPage {
  /** Paragraphs; each paragraph is a list of lines. Paragraphs are separated by a larger gap. */
  paragraphs: string[][];
}

export interface PdfOptions {
  compress?: boolean;
  encrypted?: boolean;
  /** Pages with no text operators at all (simulates a scanned PDF). */
  imageOnly?: boolean;
  /** Use a Type0 font with a ToUnicode CMap and 2-byte codes. */
  type0?: boolean;
  /** Use a Type0 font with no ToUnicode (undecodable). */
  type0NoToUnicode?: boolean;
}

function pdfLiteral(s: string): string {
  return "(" + s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)") + ")";
}

/** Builds a small but structurally valid PDF with a text layer. */
export function buildPdf(pages: PdfPage[], opts: PdfOptions = {}): Uint8Array {
  const objects: string[] = [];
  const binaryStreams = new Map<number, Uint8Array>();
  const add = (s: string) => {
    objects.push(s);
    return objects.length;
  };

  const catalogId = add("");
  const pagesId = add("");
  let fontId: number;
  // Type0 fonts map each character to a 2-byte code = its UTF-16 code unit.
  const twoByte = opts.type0 || opts.type0NoToUnicode;
  if (twoByte) {
    const cmap =
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n" +
      "1 begincodespacerange <0000> <FFFF> endcodespacerange\n" +
      "1 beginbfrange <0000> <FFFF> <0000> endbfrange\n" +
      "endcmap CMapName currentdict /CMap defineresource pop end end";
    const toUnicodeId = opts.type0 ? add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`) : 0;
    const descId = add("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Synthetic /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>");
    fontId = add(
      `<< /Type /Font /Subtype /Type0 /BaseFont /Synthetic /Encoding /Identity-H /DescendantFonts [${descId} 0 R]` +
        (opts.type0 ? ` /ToUnicode ${toUnicodeId} 0 R` : "") +
        " >>",
    );
  } else {
    fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  }

  const encodeText = (s: string): string => {
    if (!twoByte) return pdfLiteral(s);
    let hex = "";
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0");
    return `<${hex}>`;
  };

  const pageIds: number[] = [];
  for (const page of pages) {
    let content = "";
    if (opts.imageOnly) {
      content = "q 600 0 0 800 0 0 cm /Im1 Do Q";
    } else {
      content = "BT /F1 12 Tf 14 TL 72 760 Td\n";
      page.paragraphs.forEach((para, pi) => {
        if (pi > 0) content += "0 -28 Td\n";
        para.forEach((line, li) => {
          if (li > 0) content += "T*\n";
          // Split each line into two runs with a kerning gap to exercise TJ spacing.
          const words = line.split(" ");
          if (words.length > 1 && !twoByte) {
            const half = Math.ceil(words.length / 2);
            content += `[${encodeText(words.slice(0, half).join(" "))} -300 ${encodeText(words.slice(half).join(" "))}] TJ\n`;
          } else {
            content += `${encodeText(line)} Tj\n`;
          }
        });
      });
      content += "ET";
    }
    let contentId: number;
    if (opts.compress) {
      const data = new Uint8Array(deflateSync(latin1Bytes(content)));
      contentId = add("");
      binaryStreams.set(contentId, data);
    } else {
      contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    }
    const resources = opts.imageOnly
      ? "<< /XObject << /Im1 << >> >> >>"
      : `<< /Font << /F1 ${fontId} 0 R >> >>`;
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${contentId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const encryptId = opts.encrypted ? add("<< /Filter /Standard /V 2 /R 3 /Length 128 /P -4 >>") : 0;

  const parts: Uint8Array[] = [latin1Bytes("%PDF-1.7\n%âãÏÓ\n")];
  let offset = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    const id = i + 1;
    offsets.push(offset);
    let chunk: Uint8Array;
    const bin = binaryStreams.get(id);
    if (bin) {
      chunk = concat([
        latin1Bytes(`${id} 0 obj\n<< /Length ${bin.length} /Filter /FlateDecode >>\nstream\n`),
        bin,
        latin1Bytes("\nendstream\nendobj\n"),
      ]);
    } else {
      chunk = latin1Bytes(`${id} 0 obj\n${body}\nendobj\n`);
    }
    parts.push(chunk);
    offset += chunk.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R` +
    (encryptId ? ` /Encrypt ${encryptId} 0 R /ID [<00> <00>]` : "") +
    ` >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(latin1Bytes(xref + trailer));
  return concat(parts);
}
