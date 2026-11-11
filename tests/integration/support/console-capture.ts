/** Captures console output during a block, so tests can scan logs for PII, tokens or secrets (§12.4, §12.7). */

type Method = "log" | "info" | "warn" | "error" | "debug";
const METHODS: Method[] = ["log", "info", "warn", "error", "debug"];

export async function captureConsole<T>(work: () => Promise<T> | T): Promise<{ result: T; lines: unknown[][] }> {
  const lines: unknown[][] = [];
  const original = new Map<Method, (...args: unknown[]) => void>();
  for (const m of METHODS) {
    original.set(m, console[m]);
    console[m] = (...args: unknown[]) => void lines.push(args);
  }
  try {
    return { result: await work(), lines };
  } finally {
    for (const m of METHODS) console[m] = original.get(m)!;
  }
}
