/**
 * RecordingProvider: wraps any AiProvider (§11.8; in practice lib/ai/providers/fake.ts) and keeps a deep
 * copy of every request and option it receives, so tests can scan exactly what would leave the server
 * (IT-01, IT-02, IT-06). Structural typing keeps this independent of lib/ai until that module lands.
 */

export interface ProviderLike {
  readonly id: string;
  readonly displayName: string;
  extract(req: never, opts?: never): Promise<unknown>;
  verifySupport(req: never, opts?: never): Promise<unknown>;
}

export interface RecordedRequest {
  kind: "extract" | "verifySupport";
  request: unknown;
}

export type Recording<P extends ProviderLike> = P & { readonly requests: RecordedRequest[] };

function snapshot(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
}

export function recordProvider<P extends ProviderLike>(inner: P): Recording<P> {
  const requests: RecordedRequest[] = [];
  const wrapped = {
    get id() {
      return inner.id;
    },
    get displayName() {
      return inner.displayName;
    },
    requests,
    extract(req: never, opts?: never) {
      requests.push({ kind: "extract", request: snapshot(req) });
      return inner.extract(req, opts);
    },
    verifySupport(req: never, opts?: never) {
      requests.push({ kind: "verifySupport", request: snapshot(req) });
      return inner.verifySupport(req, opts);
    },
  };
  return wrapped as unknown as Recording<P>;
}
