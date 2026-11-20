/**
 * Round 4 audit C4: after a partial submission, reopening the link said "has 4 questions" although 2 were answered.
 * A sent answer stays open on the server until a reviewer accepts it (other people with the link may still answer
 * it), so this device remembers which questions it already answered and shows only the remaining ones. Per-viewer
 * convenience in localStorage; the server's rules are unchanged. Pure helpers, no React.
 */

export const sentStorageKey = (token: string) => `baton:gap-sent:${token.slice(0, 12)}`;

export function parseSent(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Ids already sent from this device plus the ones just sent; only ids still on the link are kept. */
export function mergeSent(previous: ReadonlySet<string>, justSent: readonly string[], onLink: readonly string[]): string {
  const still = new Set(onLink);
  return JSON.stringify([...new Set([...previous, ...justSent])].filter((id) => still.has(id)));
}

export function remainingQuestions<Q extends { id: string }>(questions: readonly Q[], sent: ReadonlySet<string>): Q[] {
  return questions.filter((q) => !sent.has(q.id));
}
