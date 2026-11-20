/**
 * Extra bot commands (2026-11-21): help, status and pause, shared by Discord, Slack and Telegram so every provider
 * answers with the same words and the same rules. Server only, no React.
 *
 * Permission model (the same one `/handover` uses, never weaker):
 *  - help:   anyone in the channel (static text, no lookup).
 *  - status: whoever may run `/handover` in that channel (Telegram: a group admin; Discord and Slack: any member, in
 *            a private or ephemeral reply). It says only whether Baton is saving this channel, how many of its
 *            messages are waiting to be added, and when they were last added: never a handover title, a person, a
 *            message or an id. The channel already saw the public "started saving" notice, so nothing new is revealed.
 *  - pause:  a channel admin only (Telegram: group admin or anonymous admin; Discord: Manage Channels, Manage Server or
 *            Administrator in the signed interaction). It only STOPS capture, through the store as the provider actor
 *            (the database allows a provider to pause and refuses a provider resume), so it can never start or widen
 *            capture. Resuming stays with the handover's creator in Baton. The answer is posted publicly in the
 *            channel, like the capture notices. Slack: not offered (Slack gives no admin flag in a slash command).
 *
 * Nothing here answers questions about a handover ("Ask the handover"): Baton has no grounded, clearance-checked
 * answer service to reuse, so the bots never invent answers (docs/connectors/OWNER_STEPS_2026-11-21.md).
 */

import type { ConnectorStore } from "../../types";
import { captureNotice, type BotProvider } from "./shared";

export const BOT_COMMAND_ACTIONS = ["connect", "status", "pause", "help"] as const;
export type BotCommandAction = (typeof BOT_COMMAND_ACTIONS)[number];

/**
 * The action named by a command argument ("status", "pause", "help"; empty or "connect" means connect). Unknown words
 * return null so the bot can say so instead of guessing.
 */
export function parseCommandAction(arg: string | null | undefined): BotCommandAction | null {
  const word = (arg ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (word === "" || word === "connect") return "connect";
  if (word === "status" || word === "pause" || word === "help") return word;
  return null;
}

/** How each provider spells the commands in its help text. */
const SPELLING: Record<BotProvider, Record<BotCommandAction, string>> = {
  telegram: { connect: "/handover", status: "/status", pause: "/pause", help: "/help" },
  discord: { connect: "/handover", status: "/handover action:status", pause: "/handover action:pause", help: "/handover action:help" },
  slack: { connect: "/handover", status: "/handover status", pause: "", help: "/handover help" },
};

/** Static help. Lists only commands this provider actually offers. */
export function helpText(provider: BotProvider): string {
  const s = SPELLING[provider];
  const lines = [
    "Baton saves a channel's messages to a handover only after the handover's creator connects it and confirms in Baton.",
    `${s.connect}: get a link the handover's creator opens to connect this channel.`,
    `${s.status}: see whether Baton is saving messages in this channel.`,
  ];
  if (s.pause) lines.push(`${s.pause}: a channel admin pauses saving here. Only the handover's creator can resume it, in Baton.`);
  lines.push(`${s.help}: this message.`);
  lines.push("Baton doesn't answer questions about a handover in chat.");
  return lines.join("\n");
}

const UNKNOWN_ACTION = "Baton doesn't know that command.";
export function unknownActionText(provider: BotProvider): string {
  return `${UNKNOWN_ACTION} Try ${SPELLING[provider].help}.`;
}

function day(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * The capture state of the links of this channel. Counts and dates only. A store failure answers neutrally (the
 * command never fails loudly in the channel).
 */
export async function statusText(store: ConnectorStore, provider: BotProvider, account: string, channel: string): Promise<string> {
  let links;
  try {
    links = await store.capturingLinks(provider, account, channel);
  } catch {
    return "Baton can't check this channel right now. Try again in a minute.";
  }
  if (links.length === 0) {
    return `Baton isn't saving messages in this channel right now. Use ${SPELLING[provider].connect} to connect it to a handover.`;
  }
  const waiting = links.reduce((n, l) => n + Math.max(0, l.bufferedCount), 0);
  const lastAdded = links.map((l) => day(l.lastFlushAt)).filter((d): d is string => d !== null).sort().pop() ?? null;
  const target = links.length === 1 ? "a handover" : `${links.length} handovers`;
  const parts = [`Baton is saving messages in this channel for ${target}.`];
  parts.push(waiting === 0 ? "No messages are waiting to be added." : `${waiting === 1 ? "1 message is" : `${waiting} messages are`} waiting for the handover's creator to add them.`);
  if (lastAdded) parts.push(`Messages were last added on ${lastAdded}.`);
  parts.push("A channel admin or the handover's creator can pause or stop it.");
  return parts.join(" ");
}

export type PauseResult = { paused: number; text: string };

/**
 * Pauses every capturing link of this channel as the provider actor. The CALLER has already checked that the person
 * is a channel admin. Returns the public notice to post (the same words as the capture notice).
 */
export async function pauseChannel(store: ConnectorStore, provider: BotProvider, account: string, channel: string): Promise<PauseResult> {
  let links;
  try {
    links = await store.capturingLinks(provider, account, channel);
  } catch {
    return { paused: 0, text: "Baton can't pause this channel right now. Try again in a minute, or ask the handover's creator to pause it in Baton." };
  }
  if (links.length === 0) return { paused: 0, text: "Baton isn't saving messages in this channel, so there is nothing to pause." };
  let paused = 0;
  let failed = 0;
  for (const link of links) {
    try {
      await store.setLinkState({ kind: "provider" }, link.id, "paused");
      paused += 1;
    } catch {
      failed += 1;
    }
  }
  if (paused === 0) return { paused, text: "Baton couldn't pause this channel. Try again, or ask the handover's creator to pause it in Baton." };
  const notice = captureNotice("paused", "a channel admin");
  return { paused, text: failed > 0 ? `${notice} Some connections couldn't be paused yet: send the command again.` : notice };
}

/** Discord permission bits that make a member a channel admin for `/pause`. */
const DISCORD_ADMINISTRATOR = BigInt(1) << BigInt(3);
const DISCORD_MANAGE_CHANNELS = BigInt(1) << BigInt(4);
const DISCORD_MANAGE_GUILD = BigInt(1) << BigInt(5);

/** True when a Discord interaction member's permission string (a decimal bitfield) carries an admin bit. */
export function discordMemberIsChannelAdmin(permissions: unknown): boolean {
  if (typeof permissions !== "string" || !/^\d{1,30}$/.test(permissions)) return false;
  const bits = BigInt(permissions);
  return (bits & (DISCORD_ADMINISTRATOR | DISCORD_MANAGE_CHANNELS | DISCORD_MANAGE_GUILD)) !== BigInt(0);
}
