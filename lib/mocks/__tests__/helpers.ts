import assert from "node:assert/strict";

import type { AppError, Result } from "../../contracts/api";
import { getStore } from "../store";

/** Fresh seed data for each test (the store lives on globalThis). */
export function resetStore() {
  delete (globalThis as { __batonMockStore?: unknown }).__batonMockStore;
  return getStore();
}

/** Act as another signed-in profile for the mock actions. */
export function signInAs(profileId: string) {
  getStore().viewerId = profileId;
}

export function expectOk<T>(r: Result<T>): T {
  if (!r.ok) assert.fail(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.data;
}

export function expectError<T>(r: Result<T>, code: AppError["code"]): AppError {
  if (r.ok) assert.fail(`expected ${code}, got ok`);
  assert.equal(r.error.code, code, r.error.message);
  return r.error;
}
