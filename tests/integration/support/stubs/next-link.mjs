// Minimal stub of "next/link" for render tests: a plain <a href>. Only the markup matters here; routing and
// prefetching are Next.js runtime behaviour, checked in the browser (tests/browser/run.mjs).
import { createElement } from "react";

export default function Link({ href, prefetch: _prefetch, replace: _replace, scroll: _scroll, ...rest }) {
  return createElement("a", { href: typeof href === "string" ? href : String(href?.pathname ?? ""), ...rest });
}
