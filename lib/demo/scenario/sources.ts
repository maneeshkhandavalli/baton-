/**
 * DEMO SCENARIO: the three sources Priya gives Baton. They are raw, as exported, before masking.
 *
 * The exports are short on purpose, so a visitor can read them in full. Everything is invented.
 * Contact details use the synthetic `99999 0000N` and example.org patterns, so masking is visible.
 * Nothing in here is credential-like (no passwords, keys, tokens, card or account numbers).
 * lib/demo/__tests__/scenario.test.ts runs these through the REAL parser and masker.
 * Pure data: no React, no I/O.
 */

import type { AccessLevel, SourceKind } from "@/lib/contracts/enums";

export type DemoSourceKey = "core" | "leads" | "infra";

export interface DemoSource {
  key: DemoSourceKey;
  /** File name as uploaded. */
  fileName: string;
  /** Title shown in the product (derived from the file name, as the real upload does). */
  title: string;
  kind: Extract<SourceKind, "whatsapp_export" | "markdown">;
  mimeType: string;
  accessLevel: AccessLevel;
  /** One line for the demo's source list. */
  description: string;
  /** For documents: the date written in the document. */
  documentDate: string | null;
  raw: string;
}

const CORE_TEAM_CHAT = `01/07/2026, 19:02 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.
01/07/2026, 19:02 - Priya Raman created group "CodeCell Core Team 26-27"
01/07/2026, 19:03 - Priya Raman added Kabir Shah, Arjun Mehta, Ananya Iyer, Rohan Pillai and Neha Kulkarni
01/07/2026, 19:05 - Priya Raman: new sem, new group. the old one is archived. same rule as always: club stuff only, personal plans go elsewhere 🙏
01/07/2026, 19:07 - Kabir Shah: 👍
01/07/2026, 19:10 - Ananya Iyer: can someone add ishaan? he's helping with design this sem
01/07/2026, 19:11 - Priya Raman added Ishaan Rao
01/07/2026, 19:12 - Priya Raman added +91 99999 00007
14/07/2026, 18:40 - Ananya Iyer: projector in lab 3 died 1.5 hrs into the git workshop. front desk has a spare one, used that
14/07/2026, 18:42 - Rohan Pillai: same thing happened in march
14/07/2026, 18:43 - +91 99999 00007: i can bring my own hdmi cable next time
15/07/2026, 11:00 - Priya Raman: dr. menon (CSE) stays our faculty coordinator this year. she signs the sponsor MoU and anything above ₹2,000
04/08/2026, 20:15 - Priya Raman: workshop fee for this sem: non-members pay ₹100 per workshop, members free. collect it at the door and note names in the sheet
04/08/2026, 20:17 - Rohan Pillai: ok, i'll add a fee column to the sheet
21/08/2026, 22:05 - Priya Raman: vote closed 11–2. DevForge '27 is Sat 30 – Sun 31 Jan, 9am to 9pm both days. no overnight in the labs this time
21/08/2026, 22:06 - Arjun Mehta: finally 🎉
21/08/2026, 22:08 - Kabir Shah: good call, last year's 24h format was rough on the volunteers
22/08/2026, 13:20 - Ananya Iyer: print shop delivered the tees, size M ran small
22/08/2026, 13:21 - Ishaan Rao: <Media omitted>
18/09/2026, 21:10 - Kabir Shah: from this sem workshops are free for everyone, we agreed in the leads call. no more ₹100 at the door
18/09/2026, 21:12 - Rohan Pillai: noted, removing the fee column
25/09/2026, 12:05 - Ananya Iyer: can we do thursday this week instead? lab 3 is free after 6
25/09/2026, 12:09 - Priya Raman: works for me
26/09/2026, 19:45 - Priya Raman: projector died again at 1.5 hrs. got the spare from the front desk
08/10/2026, 17:50 - Kabir Shah: thursday again? same lab 3 at 6
12/10/2026, 17:30 - Priya Raman: moved judging-portal and codecell-site to the codecell-org github org today. please stop pushing to my personal account
12/10/2026, 17:34 - Ananya Iyer: done, updated my remote
14/10/2026, 09:30 - Rohan Pillai: IT took 6 days to set up guest wifi for the last event. ask them a week before every event
16/10/2026, 11:20 - Rohan Pillai: desai sir approved the workshop venue but he wants the form in person, not on email. his number is 99999 00008 if it's urgent
19/10/2026, 10:02 - Rohan Pillai: reimbursements: anything under ₹2,000 i can approve, above that needs dr. menon's signature
19/10/2026, 10:15 - Ishaan Rao: i paid 1,850 for the workshop snacks, please reimburse me on 99999 00009
19/10/2026, 10:16 - Rohan Pillai: will do today
20/10/2026, 23:10 - Priya Raman: judging portal deploy is: ssh in, pull, restart pm2. config lives on the server, not in the repo. i'll write it down someday 😅
21/10/2026, 16:15 - Rohan Pillai: orientation is in jan, the auditorium form has to go in before winter break or we lose the slot
22/10/2026, 18:00 - Ananya Iyer: see you all thursday, 6pm, lab 3
24/10/2026, 20:00 - Arjun Mehta: who's in for a trip after diwali?
24/10/2026, 20:03 - Kabir Shah: me! which dates
25/10/2026, 09:12 - Ananya Iyer: i can do 2nd to 4th
27/10/2026, 22:40 - Arjun Mehta: booked the homestay, sending details separately
29/10/2026, 19:25 - Priya Raman: domain renews on 12 dec and it's still on my personal card. need to move it to the club card before i leave
02/11/2026, 16:00 - Priya Raman: github org owners are me and kabir. recovery codes are in the club password manager, not in chat. i'll add neha as owner before i go
05/11/2026, 18:30 - Arjun Mehta: registrations page now says 30–31 jan, daytime only
05/11/2026, 18:34 - Arjun Mehta: judging rubric draft is in the drive. weights still pending, i'll finish it by 15 dec
06/11/2026, 12:00 - Ananya Iyer: reminder to join our discord, the link is in the instagram bio
08/11/2026, 10:10 - Priya Raman: neha takes over as technical lead on 1 dec. i'm putting the handover together this week, so if you know something only you know, tell me 🙂
08/11/2026, 10:12 - Neha Kulkarni: thanks priya! 🙏
`;

const LEADS_CHAT = `01/08/2026, 10:00 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.
01/08/2026, 10:00 - Kabir Shah created group "CodeCell Leads"
01/08/2026, 10:01 - Kabir Shah added Priya Raman, Arjun Mehta and Rohan Pillai
03/09/2026, 18:20 - Arjun Mehta: orbitstack signed as DevForge title sponsor 🎉 i'm the point of contact for them, nobody else emails them please
03/09/2026, 18:22 - Kabir Shah: amazing. arjun owns all sponsor comms from now
12/10/2026, 12:30 - Arjun Mehta: orbitstack won't release the 2nd instalment without a GST invoice. accounts office says 2–3 weeks
12/10/2026, 12:34 - Rohan Pillai: i'll chase the accounts office every monday
15/10/2026, 14:05 - Arjun Mehta: our contact at orbitstack is farah khan, partnerships manager. farah.khan@example.org, office line 99999 00010
04/11/2026, 19:00 - Priya Raman: for the handover: neha won't be in this group, the sponsor side stays with arjun
04/11/2026, 19:02 - Arjun Mehta: makes sense
`;

const INFRA_NOTES = `# CodeCell infrastructure notes

Maintained by the technical lead. Last edited on 3 November 2026 by Priya Raman.

## Code

- All club repositories live in the codecell-org GitHub organisation. Personal forks are archived.

## Website

- codecell.example.org is built from the codecell-site repository. Ananya Iyer deploys it.
- The domain renews on 12 December every year.

## Judging portal

- Repository: codecell-org/judging-portal.
- Deploy: ask Priya.

## Access

- Owners of codecell-org: Priya Raman, Kabir Shah.
- Recovery codes are kept in the club password manager, never in chat.
`;

export const DEMO_SOURCES: Readonly<Record<DemoSourceKey, DemoSource>> = {
  core: {
    key: "core",
    fileName: "WhatsApp Chat with CodeCell Core Team 26-27.txt",
    title: "WhatsApp Chat with CodeCell Core Team 26-27",
    kind: "whatsapp_export",
    mimeType: "text/plain",
    accessLevel: "everyone",
    description: "The core team group, July to November 2026",
    documentDate: null,
    raw: CORE_TEAM_CHAT,
  },
  leads: {
    key: "leads",
    fileName: "WhatsApp Chat with CodeCell Leads.txt",
    title: "WhatsApp Chat with CodeCell Leads",
    kind: "whatsapp_export",
    mimeType: "text/plain",
    accessLevel: "leads_only",
    description: "The leads group: sponsorship and money. Leads only.",
    documentDate: null,
    raw: LEADS_CHAT,
  },
  infra: {
    key: "infra",
    fileName: "infra-notes.md",
    title: "infra-notes",
    kind: "markdown",
    mimeType: "text/markdown",
    accessLevel: "everyone",
    description: "Priya's infrastructure notes, last edited on 3 November 2026",
    documentDate: "2026-11-03",
    raw: INFRA_NOTES,
  },
};

/**
 * The exclusions Priya records before the first parse (the wizard's scope step):
 *   - the core-team member who asked to be left out (matched by their number, never named);
 *   - 24–27 October in the core chat: trip planning, not club business.
 */
export const DEMO_EXCLUSIONS = {
  optedOutParticipant: { sourceKey: "core" as const, reason: "Asked to be left out of the handover." },
  tripPlanning: { sourceKey: "core" as const, rangeStart: "2026-10-24T00:00:00+05:30", rangeEnd: "2026-10-27T23:59:59+05:30", reason: "Trip planning, not club business." },
} as const;

/** The time zone the exports were made in (the real wizard asks for it; India has one). */
export const DEMO_TIMEZONE = "Asia/Kolkata";

/** 1-based line number of the first line containing `needle` (exactly one match required). */
export function lineOf(raw: string, needle: string): number {
  const lines = raw.split("\n");
  const hits = lines.flatMap((l, i) => (l.includes(needle) ? [i + 1] : []));
  if (hits.length !== 1) throw new Error(`lineOf: expected exactly one line containing "${needle}", found ${hits.length}`);
  return hits[0];
}

/** ISO (UTC) time of a WhatsApp line's "dd/mm/yyyy, HH:MM" header, read in Asia/Kolkata (UTC+05:30). */
export function whatsappSentAt(raw: string, line: number): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}) - /.exec(raw.split("\n")[line - 1] ?? "");
  if (!m) throw new Error(`whatsappSentAt: line ${line} has no WhatsApp header`);
  const [, dd, mm, yyyy, hh, mi] = m;
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00+05:30`).toISOString();
}
