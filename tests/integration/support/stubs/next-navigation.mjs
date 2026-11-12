// Minimal stub of "next/navigation" for server code paths: redirect() and notFound() throw, like Next.js.

export class RedirectSignal extends Error {
  constructor(url) {
    super(`redirect:${url}`);
    this.url = url;
  }
}

export function redirect(url) {
  throw new RedirectSignal(url);
}

export function notFound() {
  throw new Error("notFound");
}

// Client hooks, for rendering client components to static markup (render tests only; no routing happens).
export function useRouter() {
  return { refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} };
}

export function usePathname() {
  return globalThis.__batonIt?.pathname ?? "/";
}

export function useSearchParams() {
  return new URLSearchParams();
}
