// Minimal stub of "next/link" for render tests: a plain <a href>. Only the markup matters here; routing and
// prefetching are Next.js runtime behaviour, checked in the browser (tests/browser/run.mjs).
import { createElement } from "react";

const ROUTER_ONLY = new Set(["href", "prefetch", "replace", "scroll"]);

export default function Link(props) {
  const attrs = Object.fromEntries(Object.entries(props).filter(([key]) => !ROUTER_ONLY.has(key)));
  const href = typeof props.href === "string" ? props.href : String(props.href?.pathname ?? "");
  return createElement("a", { href, ...attrs });
}
