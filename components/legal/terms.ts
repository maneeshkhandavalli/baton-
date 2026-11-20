import { LEGAL_LAST_UPDATED, type LegalDocumentContent } from "./types";

/** The terms of use (/terms). Plain language; every commercial or legal detail the owner must supply is a placeholder. */
export const TERMS: LegalDocumentContent = {
  path: "/terms",
  title: "Terms of use",
  summary: "The rules for using Baton: your account, the content you add, AI output, connectors and invitations.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "agreement",
      heading: "Agreement",
      blocks: [
        {
          kind: "p",
          text: "These terms apply when you use Baton, which is operated by [Owner to provide: legal entity name and registered address]. By creating an account or using a handover link you agree to them. If you use Baton for a club, team or organisation, you confirm you may act for it.",
        },
        {
          kind: "p",
          text: "Baton is an early-access product. Features may change, and the service may be unavailable at times.",
        },
      ],
    },
    {
      id: "accounts",
      heading: "Your account",
      blocks: [
        {
          kind: "list",
          items: [
            "Keep your sign-in secure and tell us about any unauthorised use.",
            "Use an email address you control. Invitations can be accepted only by the address they were sent to.",
            "Minimum age: [Owner to provide: minimum age and parental consent requirement].",
            "You can delete your account at any time from your account page.",
          ],
        },
      ],
    },
    {
      id: "your-content",
      heading: "Content you add",
      blocks: [
        {
          kind: "list",
          items: [
            "You keep the rights you have in the sources and text you add. You let Baton store and process them only to provide the service to you and the people you share a handover with.",
            "Only add content you are allowed to share. Tell the people whose messages appear in a source that you are using them for a handover, and exclude anyone who should not be included.",
            "Do not upload passwords, government identity documents, health, financial or other sensitive information. Automatic masking reduces risk but can miss things.",
            "You are responsible for who you invite and what you publish to them.",
          ],
        },
      ],
    },
    {
      id: "ai-output",
      heading: "AI output",
      blocks: [
        {
          kind: "p",
          text: "Baton uses an AI model to draft handover points from your sources. Drafts can be incomplete or wrong. Each point shows the quote it relies on; check points before you publish and before you rely on them. Baton does not give legal, financial or other professional advice.",
        },
      ],
    },
    {
      id: "connectors-and-email",
      heading: "Connectors, invitations and email",
      blocks: [
        {
          kind: "list",
          items: [
            "Connecting GitHub, Discord, Slack or Telegram is optional. Connect only channels you manage or are allowed to connect, and follow that platform's own terms.",
            "Invitation emails are sent on your behalf to the address you enter. Invite only people who expect to hear from you about the handover.",
            "Invitation links work once, for the invited address, until they expire.",
          ],
        },
      ],
    },
    {
      id: "acceptable-use",
      heading: "Acceptable use",
      blocks: [
        {
          kind: "list",
          items: [
            "Do not use Baton to break the law, harass anyone, or share content you have no right to share.",
            "Do not try to access handovers, accounts or data you were not given access to, or to bypass rate limits or security checks.",
            "Do not overload, probe or reverse engineer the service, or use it to send spam.",
          ],
        },
        {
          kind: "p",
          text: "We may suspend access that breaks these rules or puts other people at risk.",
        },
      ],
    },
    {
      id: "privacy",
      heading: "Privacy",
      blocks: [
        {
          kind: "p",
          text: "How Baton handles personal data is described in the privacy notice at /privacy and the cookies page at /cookies.",
        },
      ],
    },
    {
      id: "liability",
      heading: "Availability and liability",
      blocks: [
        {
          kind: "p",
          text: "Baton is provided as it is, without a promise that it will always be available or free of errors. Keep your own copies of anything important. [Owner to provide: limitation of liability and any warranty wording, reviewed by counsel].",
        },
      ],
    },
    {
      id: "ending",
      heading: "Ending use",
      blocks: [
        {
          kind: "p",
          text: "You can stop using Baton and delete your account at any time. What happens to your data then is described in the privacy notice.",
        },
      ],
    },
    {
      id: "changes",
      heading: "Changes, law and contact",
      blocks: [
        {
          kind: "list",
          items: [
            "We will update these terms when the service changes, and change the date at the top.",
            "Governing law and jurisdiction: [Owner to provide: governing law and jurisdiction].",
            "Contact: [Owner to provide: contact email].",
            "These terms have not yet been reviewed by a lawyer.",
          ],
        },
      ],
    },
  ],
};
