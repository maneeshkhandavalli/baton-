/**
 * Anchored grammar for WhatsApp system events (English exports).
 *
 * Classification rule (fail-safe for exclusions): a line is a system event only if its WHOLE
 * text matches one of these anchored patterns. Name slots never contain ": ", so a real message
 * "Sam (left wing): hello" can never be read as the event "<name> left". When a line does not
 * match, the text before the first ": " is ALWAYS the sender, whatever words or quotes it holds,
 * so a participant can never lose their identity (and with it, their exclusion).
 *
 * Over-attribution (an unknown system event with ": " in it being treated as a message from a
 * pseudo-participant) is the accepted failure mode: it keeps content attributable and excludable.
 *
 * Name slots (N) and free-text tails (T) never contain ": ". Only quoted slots (Q, e.g. a group
 * subject "Robotics: Core") may; such an event line is still treated as an event, but the caller
 * records the text before its first ": " as an attribution, so if that text were really a sender
 * (a saved name like `Bob created group "x`), excluding that sender still drops the line.
 */

/** A name slot: one or more characters, never containing ": " and never spanning lines. */
const N = String.raw`(?:(?!: )[^\n])+?`;
/**
 * A quoted free-text slot (group subject, etc.); may contain anything except a newline, including
 * ": ". An Android event line whose first ": " falls inside such a slot keeps the text before that
 * ": " as an attribution candidate (parse-chat.ts), so it stays excludable.
 */
const Q = String.raw`"[^\n]*"`;
/**
 * A free-text tail ("Tap to learn more.", settings details). Never contains ": ", so a tail can
 * never absorb a sender separator (second audit N7).
 */
const T = String.raw`(?:(?!: )[^\n])*`;

const PATTERNS: readonly string[] = [
  // Encryption and security notices (no actor).
  String.raw`Messages and calls are end-to-end encrypted\.${T}`,
  String.raw`Messages to this group are now secured with end-to-end encryption\.${T}`,
  String.raw`Messages you send to this group are now secured with end-to-end encryption\.${T}`,
  String.raw`Your security code with ${N} changed\.${T}`,
  String.raw`${N}'s security code changed\.${T}`,
  // Group lifecycle.
  String.raw`${N} created (?:the )?group ${Q}`,
  String.raw`${N} created this group`,
  String.raw`This group was created by ${N}`,
  String.raw`${N} added ${N}`,
  String.raw`${N} removed ${N}`,
  String.raw`${N} left`,
  String.raw`${N} joined`,
  String.raw`${N} joined using this group's invite link`,
  String.raw`${N} joined using an invite link`,
  String.raw`${N} joined from the community`,
  String.raw`${N} requested to join`,
  String.raw`${N} (?:was|were) added`,
  String.raw`You were added`,
  String.raw`${N} reset this group's invite link`,
  // Group settings and metadata.
  String.raw`${N} changed the subject (?:from ${Q} )?to ${Q}`,
  String.raw`${N} changed the group name (?:from ${Q} )?to ${Q}`,
  String.raw`${N} changed this group's icon`,
  String.raw`${N} deleted this group's icon`,
  String.raw`${N} changed the group description`,
  String.raw`${N} deleted the group description`,
  String.raw`${N} changed (?:this|the) group's settings${T}`,
  String.raw`${N} changed the settings so ${T}`,
  String.raw`${N} pinned a message`,
  String.raw`${N} turned (?:on|off) disappearing messages\.${T}`,
  String.raw`Disappearing messages (?:were|was) turned (?:on|off)\.${T}`,
  // Admin and number changes.
  String.raw`You're now an admin`,
  String.raw`${N} (?:is|are) now an admin`,
  String.raw`${N} (?:is|are) no longer an admin`,
  String.raw`${N} changed their phone number to a new number\.${T}`,
  String.raw`${N} changed to ${N}`,
];

const SYSTEM_EVENT_RE = new RegExp(`^(?:${PATTERNS.join("|")})\\.?$`, "i");

/** True if `line` (leading direction marks already removed) is entirely a known system event. */
export function isSystemEvent(line: string): boolean {
  if (line.length > 4096) return false; // events are short; never run the grammar on huge lines
  return SYSTEM_EVENT_RE.test(line.trim());
}
