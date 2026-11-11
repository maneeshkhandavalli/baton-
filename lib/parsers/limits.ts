/**
 * Resource limits for the parser layer.
 *
 * `PARSER_LIMITS` (25 MB per file, 200,000 messages per source) is canonical and comes from
 * lib/contracts (§11.4, D15). The rest are internal safety limits of this module: they bound
 * memory and CPU on hostile input (zip bombs, deeply nested PDFs, pathological lines). They are
 * not part of the shared contract and can be tuned here without a contract change.
 */

import { PARSER_LIMITS } from "../contracts/parser";

export const LIMITS = {
  /** Canonical: maximum size of an uploaded file (§11.4, D15). */
  maxFileBytes: PARSER_LIMITS.maxFileBytes,
  /** Canonical: maximum messages or document blocks per source, counted before exclusions. */
  maxMessagesPerSource: PARSER_LIMITS.maxMessagesPerSource,

  /** Maximum decoded text of one source (chat text, document text), in UTF-16 code units. */
  maxTextChars: 64 * 1024 * 1024,
  /** Maximum lines in a decoded text source. */
  maxLines: 2_000_000,
  /** A single physical line longer than this is rejected as not being a plausible export. */
  maxLineChars: 1024 * 1024,

  /** ZIP: maximum entries in the central directory. */
  maxZipEntries: 20_000,
  /** ZIP: maximum uncompressed size of one entry we read. */
  maxZipEntryBytes: 64 * 1024 * 1024,
  /** ZIP: maximum ratio of uncompressed to compressed size (zip-bomb guard). */
  maxZipCompressionRatio: 200,

  /** PDF: maximum number of indirect objects scanned. */
  maxPdfObjects: 500_000,
  /** PDF: maximum pages processed. */
  maxPdfPages: 5_000,
  /** PDF: maximum decoded bytes of one stream. */
  maxPdfStreamBytes: 32 * 1024 * 1024,
  /** PDF: maximum decoded bytes across all streams of one file. */
  maxPdfTotalDecodedBytes: 256 * 1024 * 1024,
  /** PDF: maximum nesting depth of arrays and dictionaries, and of the page tree. */
  maxPdfNesting: 64,
  /** PDF: maximum bytes one indirect object (outside its stream data) may span. */
  maxPdfObjectBytes: 1024 * 1024,
  /** PDF: maximum bytes a trailer dictionary may span. */
  maxPdfTrailerBytes: 64 * 1024,
  /**
   * PDF: total bytes charged to object, trailer and object-stream parsing for one file. Regions
   * do not overlap, so a well-formed file uses about its own size; this caps crafted input.
   */
  maxPdfParseBytes: 128 * 1024 * 1024,
  /** PDF: maximum character codes produced by expanding one ToUnicode CMap's bfrange entries. */
  maxCMapRangeExpansion: 4 * 65_536,
  /**
   * PDF: maximum character codes produced by ALL ToUnicode CMaps of one document. Once spent,
   * further CMaps are truncated (reported), so many fonts cannot multiply the per-CMap cost.
   */
  maxPdfCMapExpansionTotal: 16 * 65_536,
  /** PDF: decoded bytes of one ToUnicode stream that are parsed (real CMaps are far smaller). */
  maxCMapStreamBytes: 1024 * 1024,
  /** PDF: maximum distinct fonts decoded per document; further fonts are treated as undecodable. */
  maxPdfFonts: 256,

  /** DOCX: maximum size of word/document.xml after decompression. */
  maxDocxXmlBytes: 64 * 1024 * 1024,
  /** Conversation preview length (§11.4). */
  maxPreviewChars: PARSER_LIMITS.maxPreviewChars,
  /** Maximum warnings reported per source; the rest are summarised in one final warning. */
  maxWarnings: 200,
} as const;
