/**
 * Markdown and plain text → document blocks.
 *
 * Blocks are separated by blank lines. In Markdown, ATX headings (`# …`) and setext headings
 * (`Title` + `===`/`---`) are their own blocks, fenced code (``` or ~~~) is kept as one block even
 * if it contains blank lines, and YAML front matter at the top is one block. Block bodies are the
 * source text verbatim (heading markers removed), so quotes can be verified against them.
 * `location.lineStart/lineEnd` are 1-based source lines; `heading` is the nearest preceding heading.
 */

import type { RawDocumentBlock } from "../build-source";
import { ParserAbort } from "../errors";

const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;

export function parseMarkdownLines(lines: readonly string[], markdown: boolean): RawDocumentBlock[] {
  if (lines.every((l) => l.trim() === "")) throw new ParserAbort("empty_source");
  const blocks: RawDocumentBlock[] = [];
  let heading: string | undefined;
  let buf: string[] = [];
  let bufStart = 0;

  const push = (body: string, lineStart: number, lineEnd: number, isHeading = false) => {
    const clean = body.replace(/[ \t]+$/gm, "").replace(/^\n+|\n+$/g, "").normalize("NFC");
    if (clean.trim() === "") return;
    if (isHeading) heading = clean.trim();
    const b: RawDocumentBlock = { body: clean, lineStart, lineEnd };
    if (heading !== undefined) b.heading = heading;
    blocks.push(b);
  };
  const flush = (endLine: number) => {
    if (buf.length > 0) push(buf.join("\n"), bufStart, endLine);
    buf = [];
  };

  let i = 0;
  if (markdown && lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, idx) => idx > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (close > 0) {
      push(lines.slice(0, close + 1).join("\n"), 1, close + 1);
      i = close + 1;
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (markdown) {
      const fence = FENCE_RE.exec(line);
      if (fence) {
        flush(lineNo - 1);
        const marker = fence[1][0];
        let j = i + 1;
        while (j < lines.length && !new RegExp(`^ {0,3}\\${marker}{${fence[1].length},}\\s*$`).test(lines[j])) j++;
        const end = Math.min(j, lines.length - 1);
        push(lines.slice(i, end + 1).join("\n"), lineNo, end + 1);
        i = end;
        continue;
      }
      const atx = ATX_RE.exec(line);
      if (atx) {
        flush(lineNo - 1);
        push(atx[2] ?? "", lineNo, lineNo, true);
        continue;
      }
      if (buf.length === 1 && SETEXT_RE.test(line) && buf[0].trim() !== "") {
        push(buf[0].trim(), bufStart, lineNo, true);
        buf = [];
        continue;
      }
    }
    if (line.trim() === "") {
      flush(lineNo - 1);
      continue;
    }
    if (buf.length === 0) bufStart = lineNo;
    buf.push(line);
  }
  flush(lines.length);
  if (blocks.length === 0) throw new ParserAbort("empty_source");
  return blocks;
}
