# Legal review note (prepared 21 November 2026)

**Status: a briefing for qualified counsel. It is not legal advice and makes no claim that Baton complies with any law.**
Every date and obligation below must be checked by counsel against the official texts before anyone relies on it. Items
marked `[Owner to provide: ...]` are also open in the public pages (`/privacy`, `/terms`, `/cookies`).

Sources for the facts about Baton: the code at this revision, `docs/architecture/privacy-and-data-protection.md`, and the
inventory in `components/legal/inventory.ts` (kept in step with the code by `components/legal/__tests__/inventory.test.ts`).

## 1. What Baton processes (summary for counsel)

| Data | Source | Where | Notes |
|---|---|---|---|
| Account email, Google profile name and picture, optional display name | User | Supabase Auth and database | Sign in with Google, email link or password |
| Uploaded chat exports and documents (up to 25 MB each) | Handover creator | Supabase Storage, private | Raw, unmasked file; deleted after successful processing; retention job for the rest (section 3) |
| Text read from sources | Pipeline | Supabase database | Masked (phones, emails, payment details, secrets) and pseudonymised (`[PERSON_n]`) before storage |
| Identity vault (label to name) | Pipeline | Supabase database | AES-256-GCM with a server key; no role can read it directly; names shown only to members with clearance |
| AI requests | Pipeline | Omega Plus API (third-party gateway) | Masked, pseudonymised text only. Vendor retention, training use, sub-processors and location are undocumented; the owner accepted this on 20 November 2026 and the consent statement says so |
| Invitations | Creator | Supabase database; Gmail API | Invitee email, role, expiry; only a hash of the link secret is stored |
| Connector content (GitHub, Discord, Slack, Telegram) | Creator opts in per channel | Supabase database | Capture consent per channel; in-channel notice; credentials encrypted (AES-256-GCM) |
| Security data | Requests | Supabase database; Vercel logs | Rate limits store SHA-256 hashes of IPs; audit log stores ids; Vercel keeps request logs |
| Browser storage | Browser | Device only | Theme, intro seen, onboarding panel, first-week ticks, Gap Interview draft, wizard consent-checklist draft ticks (screen state only, not consent), demo progress. No analytics, advertising or tracking anywhere (no consent banner) |

Hosting and regions: Vercel `[Owner to provide: function region]`, Supabase `[Owner to provide: project region]`.

## 2. India: Digital Personal Data Protection Act, 2023 and DPDP Rules, 2025

Our understanding, for counsel to confirm: the DPDP Rules, 2025 were notified in November 2025 with phased commencement.

| Phase | Approximate commencement (verify) | What it covers |
|---|---|---|
| Immediately on notification (November 2025) | In force | Definitions and the Data Protection Board of India (constitution, functioning, appeals) |
| About 12 months after notification | Around November 2026, so possibly in force now | Registration and obligations of Consent Managers |
| About 18 months after notification | Around May 2027 | The substantive duties of Data Fiduciaries: notice, consent, security safeguards, breach intimation, retention and erasure, children's data, Data Principal rights, grievance redressal, cross-border transfer rules, and the related penalties |

Until the substantive duties commence, counsel should confirm what continues to apply in the meantime, in particular
section 43A of the Information Technology Act, 2000 and the SPDI Rules, 2011 (reasonable security practices and a
privacy policy for sensitive personal data), which the DPDP Act is expected to replace on full commencement.

### Questions for counsel, with the relevant facts

1. **Role.** Baton decides why and how it processes user data, so it is likely a Data Fiduciary. A club or team that
   uploads chats may also be one for its members' data. How should the terms allocate this?
2. **Notice (section 5, Rules on notice).** The notice must be standalone, clear and itemised, and the Data Principal
   must be able to read it in English or any language in the Eighth Schedule to the Constitution. `/privacy` is
   English only. Is a translation option needed, and for which languages?
3. **Consent.** Processing of each source needs the uploader's confirmation of a versioned statement (recorded with the
   source). The people whose messages appear in a chat export do not consent directly; the uploader confirms they
   were told. Is that enough, or is a legitimate use or other basis needed? How should withdrawal of consent work
   for a published handover?
4. **Children (section 9, Rules on verifiable parental consent).** Baton targets student clubs, which may include people
   under 18. The Act requires verifiable consent of a parent or lawful guardian for anyone under 18 and prohibits
   tracking, behavioural monitoring and targeted advertising directed at children. Baton has no tracking or advertising,
   but has no age check either. Decide a minimum age and the parental consent approach, and check whether any exemption
   (for example for educational institutions) could apply. `[Owner to provide: minimum age and parental consent approach]`.
5. **Security safeguards and logs.** Facts: HttpOnly session cookies, row-level security on every table, encrypted
   connector credentials and identity vault, masking before storage and AI. Counsel to confirm the expected safeguards
   and any minimum log retention period under the Rules (we understand logs may need to be kept for at least one year),
   which today depends on Vercel and Supabase log settings: `[Owner to provide: log retention periods]`.
6. **Breach intimation.** Our understanding is that the Board and each affected person must be told without delay, with
   a detailed report to the Board within 72 hours. Baton has no written breach procedure yet.
7. **Retention and erasure.** Facts: raw uploads are deleted after processing; unprocessed uploads after 7 days and
   unfinished uploads after 24 hours by default (retention job, which must be switched on in production); account
   deletion purges the user's own handovers and anonymises the account; deleted handovers are soft-deleted (raw files
   removed, links revoked) and their stored text is not yet purged automatically. Counsel to advise on erasure once the
   purpose is served and on the purge period for deleted handovers.
8. **Data Principal rights and grievances.** Facts: self-service account deletion; point editing for reviewers; every
   other request goes to the privacy contact. Needed: a contact (and, if required, a named grievance officer), a
   response time within the period the Rules set (we understand up to 90 days), and an identity check for requests.
   `[Owner to provide: privacy contact and grievance officer]`.
9. **Cross-border transfer.** Vercel, Supabase, Google and the AI gateway may process data outside India; the AI gateway
   does not document where. Transfers are allowed unless the Government restricts a country, subject to any conditions
   set by order. Counsel to confirm and to advise whether the undocumented AI vendor location is acceptable.
10. **Significant Data Fiduciary.** Unlikely at Baton's scale, but this depends on a Government notification.
11. **Processors.** Contracts with Vercel, Supabase and Google (their standard data processing terms) and with the AI
    gateway, which has no documented processing terms. Counsel to advise on the AI gateway in particular.

## 3. Other audiences

- **EU and UK (GDPR and UK GDPR).** Applies if Baton offers its service to people in the EU or UK (for example exchange
  students or international clubs). Would need a lawful basis per purpose, Article 13 and 14 information (including for
  people named in uploaded chats), processor agreements, international transfer mechanisms, and records of processing.
  The ePrivacy rules on cookies are met by using only strictly necessary cookies and device-only functional storage, if
  counsel agrees that the functional items are "strictly necessary" for the service the user asked for.
- **United States.** COPPA if the service is directed to, or knowingly collects from, children under 13. State privacy
  laws are unlikely to apply at current scale.
- **Google API Services User Data Policy (Gmail).** Invitation emails use only the `gmail.send` scope, from the
  operator's own Google account. The Limited Use requirements apply to data obtained through Google APIs. `gmail.send`
  is a sensitive scope: a public app needs Google's verification before leaving Testing. In Testing, refresh tokens can
  expire after 7 days, so sending can stop until the owner reconnects. This is an operational limit, not solved.
- **Platform terms for connectors.** GitHub, Discord, Slack and Telegram developer terms (data use, notices to channel
  members, deletion on uninstall). Baton posts a notice in each captured channel and deletes unflushed messages on
  disconnect.

## 4. What this note does not cover

No analysis of intellectual property in uploaded content, of consumer law, of tax or of the legal entity itself
(`[Owner to provide: legal entity name and registered address]`, `[Owner to provide: governing law and jurisdiction]`).
No compliance statement should be made on the site or elsewhere until counsel has reviewed this note and the pages.
