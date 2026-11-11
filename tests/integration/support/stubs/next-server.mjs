// Minimal stub of "next/server" for integration tests. `after()` callbacks are queued, never run implicitly;
// tests run them with flushAfter() (platform.ts) so "scheduled after the response" stays observable.

function state() {
  globalThis.__batonIt ??= {};
  globalThis.__batonIt.after ??= [];
  return globalThis.__batonIt;
}

export function after(task) {
  state().after.push(task);
}

export async function connection() {}

export class NextResponse extends Response {
  static json(body, init) {
    return new NextResponse(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  }
  static redirect(url, init) {
    const status = typeof init === "number" ? init : (init?.status ?? 307);
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }
  static next() {
    return new NextResponse(null, { status: 200 });
  }
}
