/**
 * Deterministic signal taxonomy (R3 Task 03, EXT-1).
 *
 * A signal is a span of a persisted, masked and pseudonymised source message that LOOKS like handover
 * material (a deadline, an amount, an assignment, a decision, …). It is a pointer for coverage reporting
 * and for reviewers. A signal is never a fact, never a handover point and never evidence of anything: it
 * says only "a person should check whether this message matters".
 *
 * Bump SIGNAL_DETECTOR_VERSION on any change to the patterns in detect.ts. Stored signals carry the
 * version that produced them, so a re-run with a new detector adds rows instead of rewriting old ones.
 */

export const SIGNAL_DETECTOR_VERSION = "signals@1";

export const SIGNAL_KINDS = [
  /** A date with a deadline cue ("by Friday", "due 5 Dec", "deadline is 12/12"). */
  "deadline",
  /** Any other date or relative day ("on Monday", "tomorrow", "3rd March"). */
  "date",
  /** A money amount with a payment/budget cue ("pay ₹5,000 advance", "budget is 20k"). */
  "financial_commitment",
  /** Any other money amount. */
  "amount",
  /** Someone is asked or assigned to do something ("[PERSON_2] can you book …", "assigned to"). */
  "assignment",
  /** A standing responsibility ("is in charge of", "responsible for", "point of contact"). */
  "ownership",
  /** A decision marker ("we decided", "final:", "agreed to", "going with"). */
  "decision",
  /** A change or reversal ("actually", "postponed", "moved to", "cancelled", "instead"). */
  "reversal",
  /** A promise or future commitment by the writer ("I'll send", "will do", "leave it to me"). */
  "commitment",
  /** A dependency or wait ("waiting for", "depends on", "blocked by", "once … approves"). */
  "dependency",
  /** A question that may be unresolved ("does anyone know …?", "who is handling …?"). */
  "open_question",
  /** A pseudonymised person mention ([PERSON_n], @[PERSON_n]). */
  "person_mention",
  /** A URL or link. */
  "url",
  /** A masked identifier token ([EMAIL_1], [UPI_2], [PASSWORD]) or an account/login cue. */
  "account_identifier",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** strong: a specific cue; weak: context only (a bare date, a mention, a generic account word). */
export const SIGNAL_STRENGTHS = ["strong", "weak"] as const;
export type SignalStrength = (typeof SIGNAL_STRENGTHS)[number];

/** Which point categories a signal kind usually feeds (used by the evaluation and by reviewers' hints). */
export const SIGNAL_KIND_CATEGORIES: Readonly<Record<SignalKind, readonly string[]>> = Object.freeze({
  deadline: ["open_task", "next_action", "risk"],
  date: ["open_task", "next_action"],
  financial_commitment: ["decision", "open_task", "dependency", "owner"],
  amount: ["decision", "open_task"],
  assignment: ["owner", "open_task", "next_action"],
  ownership: ["owner", "contact"],
  decision: ["decision"],
  reversal: ["decision"],
  commitment: ["open_task", "next_action"],
  dependency: ["dependency", "blocker"],
  open_question: ["open_task", "blocker"],
  person_mention: [],
  url: ["account_access", "dependency"],
  account_identifier: ["account_access"],
});

/** Kinds that, alone, never make a message "signal-bearing" (they are context, not handover material). */
export const CONTEXT_ONLY_KINDS: ReadonlySet<SignalKind> = new Set<SignalKind>(["person_mention"]);

/** Max signals kept per message (bounds storage on pathological messages). */
export const MAX_SIGNALS_PER_MESSAGE = 32;
/** Max length of a stored normalised value. */
export const MAX_SIGNAL_VALUE_CHARS = 64;
