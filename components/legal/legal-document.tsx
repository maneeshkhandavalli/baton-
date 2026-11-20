import Link from "next/link";
import { Fragment } from "react";

import { OWNER_PLACEHOLDER, type LegalBlock, type LegalDocumentContent } from "./types";

const RELATED: readonly { href: LegalDocumentContent["path"]; label: string }[] = [
  { href: "/privacy", label: "Privacy notice" },
  { href: "/terms", label: "Terms of use" },
  { href: "/cookies", label: "Cookies and storage" },
];

/** Text with every `[Owner to provide: ...]` placeholder highlighted, so a missing detail is impossible to miss. */
function Text({ value }: { value: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of value.matchAll(OWNER_PLACEHOLDER)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(value.slice(last, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-amber-100 px-1 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100" data-owner-placeholder="">
        {m[0]}
      </mark>,
    );
    last = at + m[0].length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts.map((p, i) => (typeof p === "string" ? <Fragment key={`t${i}`}>{p}</Fragment> : p))}</>;
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "p") {
    return (
      <p>
        <Text value={block.text} />
      </p>
    );
  }
  if (block.kind === "list") {
    return (
      <ul className="list-disc space-y-2 pl-5">
        {block.items.map((item) => (
          <li key={item}>
            <Text value={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <caption className="sr-only">{block.caption}</caption>
        <thead className="bg-muted/60">
          <tr>
            {block.head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]} className="border-t border-border align-top">
              {row.map((cell, i) => (
                <td key={i} className={i === 0 ? "px-3 py-2 font-mono text-xs break-words" : "px-3 py-2"}>
                  <Text value={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A legal page: title, date, contents, sections, and links to the other two pages. Static; no client code. */
export function LegalDocument({ doc }: { doc: LegalDocumentContent }) {
  return (
    <article className="mx-auto w-full max-w-3xl px-4 pt-28 pb-16 sm:px-6">
      <header className="space-y-3 border-b border-border pb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{doc.title}</h1>
        <p className="text-muted-foreground">{doc.summary}</p>
        <p className="text-sm text-muted-foreground">Last updated: {doc.lastUpdated}</p>
      </header>
      <nav aria-label="On this page" className="mt-6">
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {doc.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="underline-offset-4 hover:underline">
                {s.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mt-8 space-y-10 leading-relaxed">
        {doc.sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24 space-y-4">
            <h2 id={`${s.id}-h`} className="font-display text-xl font-semibold">
              {s.heading}
            </h2>
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </section>
        ))}
      </div>
      <nav aria-label="Other legal pages" className="mt-12 flex flex-wrap gap-4 border-t border-border pt-6 text-sm">
        {RELATED.filter((r) => r.href !== doc.path).map((r) => (
          <Link key={r.href} href={r.href} className="underline underline-offset-4">
            {r.label}
          </Link>
        ))}
      </nav>
    </article>
  );
}
