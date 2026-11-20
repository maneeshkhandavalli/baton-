import { LEGAL_LAST_UPDATED, type LegalDocumentContent } from "./types";

/**
 * The privacy notice (/privacy). Every statement about behaviour comes from the code as of the date below:
 * uploads and retention (supabase/migrations/*raw_retention*, lib/retention, lib/actions/core/sources.ts and
 * handovers.ts), account deletion (lib/actions/core/account.ts), masking and pseudonymisation (lib/privacy), the AI
 * provider (lib/ai/config.ts, lib/contracts/consent.ts), connectors (lib/connectors) and invitation email (lib/email).
 * See docs/architecture/privacy-and-data-protection.md for the technical detail.
 */
export const PRIVACY: LegalDocumentContent = {
  path: "/privacy",
  title: "Privacy notice",
  summary:
    "What Baton collects, why, where it is kept, for how long, who processes it for us, and how you can see, correct or delete it.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "who-we-are",
      heading: "Who we are",
      blocks: [
        {
          kind: "p",
          text: "Baton turns the knowledge of student clubs, project teams and volunteer organisations into source-backed handovers. Baton is operated by [Owner to provide: legal entity name and registered address].",
        },
        {
          kind: "p",
          text: "For any privacy question or request, contact [Owner to provide: privacy contact email]. Grievance contact: [Owner to provide: grievance officer name and contact details].",
        },
        {
          kind: "p",
          text: "Baton is an early-access product. This notice describes how the software behaves today. It is not a statement that Baton meets any particular law; see the section on changes and legal review below.",
        },
      ],
    },
    {
      id: "what-we-collect",
      heading: "What we collect and why",
      blocks: [
        {
          kind: "table",
          caption: "Information Baton processes",
          head: ["Information", "Why", "Where it is kept"],
          rows: [
            [
              "Account: your email address, the name and picture your Google account shares if you sign in with Google, an optional display name, sign-in times.",
              "To sign you in, show who did what in a handover, and send you sign-in links.",
              "Supabase (authentication and database).",
            ],
            [
              "Sources you upload: chat exports and documents (up to 25 MB each).",
              "To build the handover you asked for.",
              "Supabase Storage, only until the file is processed or expires (see Uploads and deletion).",
            ],
            [
              "Handover content: the messages and text read from your sources, after masking and pseudonymisation; points, quotes, reviews, edits, gap questions and answers, acknowledgements and published versions.",
              "This is the handover itself.",
              "Supabase database.",
            ],
            [
              "Consent records: which processing statement you confirmed, its version and when.",
              "To show what you agreed to before any AI processing.",
              "Supabase database.",
            ],
            [
              "Invitations: the invited person's email address, their role, the link's expiry and whether the invitation email was sent. The link's secret is never stored, only a one-way hash of it.",
              "To invite people to a handover and check that the right person accepts.",
              "Supabase database; the email itself goes through our email provider (see Invitation emails).",
            ],
            [
              "Connected channels (only if a handover creator connects one): messages or repository activity from that one channel, the account and channel names, and an encrypted access credential.",
              "To keep a handover up to date from a channel the creator chose.",
              "Supabase database (credentials encrypted with AES-256-GCM).",
            ],
            [
              "Security data: one-way hashes of IP addresses for rate limits, an audit log of actions (ids, not content), and standard request logs kept by our hosting provider.",
              "To prevent abuse and investigate problems.",
              "Supabase database; Vercel logs.",
            ],
          ],
        },
        {
          kind: "p",
          text: "We do not use advertising, analytics or tracking tools, and we do not sell personal data. Your browser also keeps a few settings on your device only; see the cookies page at /cookies.",
        },
      ],
    },
    {
      id: "masking-and-pseudonymisation",
      heading: "Masking, pseudonymisation and the identity vault",
      blocks: [
        {
          kind: "list",
          items: [
            "Before you upload, you can exclude people. Excluded people's messages are dropped and their names are redacted from chats and documents.",
            "When a source is read, phone numbers, email addresses, payment details, secrets such as API keys and other identifiers Baton's detectors recognise are replaced with masked tokens. Only the masked text is stored.",
            "Names of people in a source are replaced with labels such as [PERSON_1] before anything is stored or sent to an AI provider.",
            "The link between a label and a real name is kept in an encrypted identity vault (AES-256-GCM with a server key). No user role can read the vault directly. Names are shown only to handover members whose clearance covers that source, and never on invitation or Gap Interview links.",
            "Masking and name detection are automatic and can miss things. Please do not upload information you would not want processed this way.",
          ],
        },
      ],
    },
    {
      id: "ai-processing",
      heading: "AI processing and the provider we use",
      blocks: [
        {
          kind: "p",
          text: "Baton uses an AI model to find decisions, responsibilities and open questions in your sources and to check that each point is supported by a quote. Processing starts only after the person who added a source confirms the processing statement shown on screen.",
        },
        {
          kind: "p",
          text: "The provider currently configured for this site is the Omega Plus API, a third-party gateway that forwards requests to upstream AI model providers. It receives only masked and pseudonymised text. Omega Plus has not documented how long it keeps requests, whether it uses them for training, which upstream providers it uses, or where it processes data. The site operator accepted this on 20 November 2026, and the processing statement you confirm says so. If the provider changes, we update this notice and the statement shown before processing.",
        },
        {
          kind: "p",
          text: "AI output can be wrong. Every point shows its source quote, and a person reviews points before a handover is published.",
        },
      ],
    },
    {
      id: "uploads-and-deletion",
      heading: "Uploads and deletion",
      blocks: [
        {
          kind: "list",
          items: [
            "An uploaded file is stored as you sent it (unmasked) in private storage that only the server can reach, through a single-use upload link.",
            "After the file is processed successfully, the original file is deleted. Only the masked, pseudonymised text read from it is kept.",
            "Files that are never processed, or whose processing failed, are deleted by a retention job after 7 days by default. Unfinished uploads are deleted after 24 hours by default. [Owner to provide: confirmation that the retention job is switched on in production and the final retention periods].",
            "If you remove a source, its original file is deleted straight away; if that fails, the retention job retries.",
            "If you delete a handover, it disappears for everyone, its invitation and Gap Interview links stop working, and its original files are deleted. Its stored text is kept in the database, hidden, until it is permanently purged: [Owner to provide: purge period for deleted handovers].",
            "If you delete your account (from your account page), Baton removes the original files of the handovers you created, permanently deletes those handovers with their sources, points and published versions, ends your memberships of other people's handovers, revokes your links and deletes your sign-in. Content you added to someone else's handover, such as a gap answer, stays in that handover and is shown as from a former member.",
            "Disconnecting a channel deletes the messages Baton captured from it but had not yet added to a handover.",
          ],
        },
      ],
    },
    {
      id: "invitation-emails",
      heading: "Invitation emails and Gmail",
      blocks: [
        {
          kind: "p",
          text: "When a handover creator invites someone, Baton can email the invitation. The email contains the inviter's name, the handover title, the invitation link and its expiry date. The creator can always copy the link instead.",
        },
        {
          kind: "p",
          text: "Invitation emails are sent through the Gmail API from the site operator's Google account. Baton asks Google only for the permission to send email (gmail.send). It cannot read, search, delete or change any mailbox. The access credential for sending is kept on the server, encrypted or in server configuration, and never reaches the browser. Neither the invited address nor the link is written to logs. Baton records only whether the email was sent and, when it was, the provider's message id.",
        },
        {
          kind: "p",
          text: "If Gmail is not set up on a server, the code can instead send invitation emails through Resend when the operator configures it. [Owner to provide: confirm whether Resend is used in production; if not, this paragraph can be removed.]",
        },
        {
          kind: "p",
          text: "Shared demo accounts never send invitation emails. A failed send never cancels or duplicates the invitation: the link stays valid until it is used once or expires.",
        },
        {
          kind: "p",
          text: "Sign-in links are sent by Supabase Auth.",
        },
      ],
    },
    {
      id: "subprocessors",
      heading: "Service providers and connectors",
      blocks: [
        {
          kind: "table",
          caption: "Service providers that process data for Baton",
          head: ["Provider", "What it does", "Location"],
          rows: [
            ["Vercel", "Hosts the website and runs the server code; keeps request logs.", "[Owner to provide: Vercel function region]"],
            ["Supabase", "Sign-in, database and private file storage; sends sign-in emails.", "[Owner to provide: Supabase project region]"],
            ["Omega Plus API", "AI processing of masked, pseudonymised text (see AI processing).", "Not documented by the vendor"],
            ["Google (Gmail API)", "Sends invitation emails from the operator's account.", "Google's infrastructure"],
            ["Google (sign-in)", "Sign in with Google, if you choose it.", "Google's infrastructure"],
          ],
        },
        {
          kind: "p",
          text: "Connectors are optional and are turned on by a handover creator for one channel and one handover, after confirming a capture statement. Each one posts a notice in the channel when capture starts, pauses or stops (GitHub excepted, which has no channel).",
        },
        {
          kind: "list",
          items: [
            "GitHub: issues, pull requests, reviews, commits and releases of one repository (titles, descriptions and comments), not its code.",
            "Discord, Slack and Telegram: messages posted in one channel, from the moment of consent, plus up to 30 days of earlier history where the creator chooses it and the platform allows.",
            "Captured messages are masked when read and are not processed with AI until the creator reviews them and gives the usual processing consent.",
          ],
        },
        {
          kind: "p",
          text: "Fonts are served from Baton's own domain. The site loads no third-party scripts.",
        },
      ],
    },
    {
      id: "retention",
      heading: "How long we keep data",
      blocks: [
        {
          kind: "list",
          items: [
            "Original uploads: until processed, or the retention periods above.",
            "Handovers and their content: while the handover exists; see Uploads and deletion for deleted handovers.",
            "Your account: until you delete it.",
            "Invitations: until accepted, withdrawn or expired; the record of them stays with the handover.",
            "Rate-limit counters: short rolling windows; they hold only hashes.",
            "Hosting and database logs: [Owner to provide: log retention periods].",
            "Anything else: [Owner to provide: retention period].",
          ],
        },
      ],
    },
    {
      id: "your-rights",
      heading: "Seeing, correcting and deleting your data",
      blocks: [
        {
          kind: "list",
          items: [
            "Delete: you can delete your account yourself from your account page. A handover creator can remove sources and delete handovers at any time.",
            "Correct: you can edit points you are allowed to review, and your display name on your account page.",
            "Access and anything else: email [Owner to provide: privacy contact email]. We will reply within [Owner to provide: response time].",
            "If you are named in a handover you are not a member of, you can ask us, or the handover's creator, to remove or correct that information.",
          ],
        },
      ],
    },
    {
      id: "children",
      heading: "Children",
      blocks: [
        {
          kind: "p",
          text: "[Owner to provide: minimum age for using Baton and how consent from a parent or guardian is handled for users under 18].",
        },
      ],
    },
    {
      id: "security",
      heading: "Security",
      blocks: [
        {
          kind: "p",
          text: "Session cookies cannot be read by page scripts. Access to every handover is checked by the database for each request. Connector credentials and the identity vault are encrypted. No system is perfectly secure; if we learn of a breach that affects you, we will tell you as required by law.",
        },
      ],
    },
    {
      id: "changes",
      heading: "Changes and legal review",
      blocks: [
        {
          kind: "p",
          text: "We update this notice when Baton's behaviour changes, and change the date at the top. Governing law and jurisdiction: [Owner to provide: governing law and jurisdiction]. This notice has not yet been reviewed by a lawyer.",
        },
      ],
    },
  ],
};

