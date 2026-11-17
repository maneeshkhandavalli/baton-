"use server";

/** Identity resolution Server Function (R3 Task 02): lib/actions/core/identity.ts. */

import type { Result } from "../contracts/api";
import * as core from "./core/identity";
import { actionDeps } from "./deps";

export async function resolveHandoverPeople(input: { handoverId: string }): Promise<Result<core.ResolvedPerson[]>> {
  return core.resolveHandoverPeople(actionDeps(), input);
}
