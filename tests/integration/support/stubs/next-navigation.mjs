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
