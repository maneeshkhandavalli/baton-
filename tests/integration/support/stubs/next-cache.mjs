// Minimal stub of "next/cache": records invalidations so tests can assert them; no caching semantics.

function log() {
  globalThis.__batonIt ??= {};
  globalThis.__batonIt.cacheCalls ??= [];
  return globalThis.__batonIt.cacheCalls;
}

export const revalidatePath = (...args) => void log().push(["revalidatePath", ...args]);
export const revalidateTag = (...args) => void log().push(["revalidateTag", ...args]);
export const updateTag = (...args) => void log().push(["updateTag", ...args]);
export const refresh = () => void log().push(["refresh"]);
export const cacheLife = () => {};
export const cacheTag = () => {};
