// Minimal stub of "next/headers": request headers and cookies come from globalThis.__batonIt (platform.ts).

function state() {
  globalThis.__batonIt ??= {};
  globalThis.__batonIt.headers ??= {};
  globalThis.__batonIt.cookies ??= new Map();
  return globalThis.__batonIt;
}

export async function headers() {
  const h = state().headers;
  return {
    get: (name) => h[String(name).toLowerCase()] ?? null,
    has: (name) => String(name).toLowerCase() in h,
  };
}

export async function cookies() {
  const jar = state().cookies;
  return {
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name, value) => void jar.set(name, value),
    delete: (name) => void jar.delete(name),
  };
}
