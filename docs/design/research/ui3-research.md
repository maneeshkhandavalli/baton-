# UI3 research: references for the Dossier direction

Owner: `brand`. Date: 2026-11-15. Method: each site was opened in headless Chrome at 1440×900, captured at four scroll
depths (0%, 18%, 38%, 60%), and its computed typography, sticky elements and CSS scroll-timeline rules were read from
the live page. Screenshots are in the git-ignored folder
`C:/Users/manee/Documents/programing/baton/.claude/ui3/shots/brand/research/` (`<slug>-0..3.jpg`, contact sheets
`_sheet1..10.jpg`). Third-party screenshots are never committed (public repository).

Nothing below is to be copied. Each entry names the pattern worth learning, how Baton adapts it, and what to avoid.

## What Baton needs from references
Baton's product is a document with receipts. The landing must (1) show material changing state (chat → masked →
drafted → labelled → signed), (2) feel archival but current, (3) make trust and privacy legible, (4) stay calm. So the
useful references are editorial/archival sites with strong type, and product sites that show complex software through
state changes rather than feature grids.

## References

| # | Reference | URL | Observed (measured) | Pattern worth learning | Adapted in Baton | Do not copy |
|---|---|---|---|---|---|---|
| 1 | Hex | hex.tech | Warm off-white with faint grid lines; serif italic + extended sans headline (74px); mono labels; corner marks around figures; 6 sticky elements, 5 scroll-timeline rules | Technical product on warm paper; crop/registration marks frame figures as exhibits; mono microcopy carries system meaning | `crop-marks` utility on the story stage; mono `type-meta`/`type-eyebrow` for records; warm paper | Their grid-paper background, their italic display pairing, their illustrations |
| 2 | Granola | granola.ai | Serif display (86px) on white, small sans body; sticky story sections; 7 scroll-timeline rules | Product UI framed as a sheet of paper that the page scrolls past; serif display + quiet UI type | Point sheets and the hero dossier as paper; serif display over sans UI | Their colourful media plates, their notepad metaphor |
| 3 | Craft | craft.do | Serif display (66px) on warm `#fcf9f7`; torn-paper textures; layered UI cards | Material texture as identity; layered UI at slight angles reads as tangible | Hero dossier: three sheets layered with small rotations | Torn-paper collage, sky imagery, pastel UI |
| 4 | Stripe Press | press.stripe.com | Dark warm brown; serif (Ivar) headline/text; 3D book spines | Publishing-house restraint: the object is the hero; type does the talking | The handover rendered as a published object (cover, contents with leaders, signature) | 3D WebGL books, dark brown palette |
| 5 | Shape Up (Basecamp) | basecamp.com/shapeup | A book on the web: FF Meta Serif 88px title, chapter contents lists | A contents page as navigation; chapters as the unit of reading | "The CodeCell file" chapter rail and five numbered chapters in the story | Underlined link-heavy TOC styling |
| 6 | Are.na | are.na | Black/white, small type (12.5–19px), archival block grid | Archive as a calm, non-algorithmic place; small precise labels | Restraint: one accent, small mono labels, no growth-hacking patterns | The austere black page, tiny body type |
| 7 | Anthropic | anthropic.com | Cream `#faf9f5`, custom serif headline 41px, sans body 14.7px | Cream paper + serif headline + plain sans body is calm and trustworthy | Validates parchment + Newsreader + Instrument Sans for a trust product | Their exact cream, illustration style, layout grid (too close to a well-known brand) |
| 8 | Harvey | harvey.ai | Off-white and charcoal; serif headline 72px; product UI in a framed window | Legal-grade seriousness: serif + product screenshot + evidence of rigour | Evidence specimen and publish gate show rigour directly, not with logos | Enterprise-sales layout, logo walls, stock photography |
| 9 | Legora | legora.com | Animated typed filenames ("…FINAL.xlsx"); 3D glass layers | Showing documents as raw material entering the product | Sources scene lists the real exported file names and access levels | Glass/3D layers (glassmorphism is ruled out, D2) |
| 10 | Hebbia | hebbia.com | Dark; 76 sticky elements; matrix of source documents per row | Source-per-cell matrices make "every answer has a source" visible | Every landing quote carries author · time · source · line | Dark finance aesthetic, density |
| 11 | Linear | linear.app | Near-black, Inter Variable 64px/510; isometric line drawings; UI fragments per section | Each section shows one real UI fragment, never a full screenshot | Story scenes show one fragment per step (sources, mask, draft, labels, document) | Dark mode default, isometric illustrations, the "AI agents" framing |
| 12 | Mercury | mercury.com | Warm photographic hero; product UI panels with soft depth; 4 sticky elements | Premium depth without gradients: soft shadow + crisp edge | `shadow-sheet` (offset sheet behind a sheet) and warm low shadows | Landscape photography hero |
| 13 | Zed | zed.dev | IBM Plex Serif 48px/320 with a custom sans; editor screenshots | Plex family in a developer product: mono/serif as the "record" voice | IBM Plex Mono for metadata and exhibits | Dark editor framing, blue CTA |
| 14 | Cursor | cursor.com | Gothic sans headings with EB Garamond body; warm dark | Serif body text can coexist with technical UI | Serif (Newsreader) for reading text in the published handover (`type-reading`) | Warm-dark brand, agent screenshots |
| 15 | mymind | mymind.com | Avenir 140px with −8px tracking; orange colour fields | Huge confident type as the hero | `type-display-xl` hero at up to 92px, tight tracking | Orange fields, playful pills, gradient blobs |
| 16 | Cosmos | cosmos.so | Bold serif 72px; floating image tiles | Collector/archive identity | (Mostly a counter-example: floating random cards are ruled out, D2) | Floating tiles |
| 17 | The Pudding | pudding.cool | Scrollytelling essays; sticky graphics with stepping text | The canonical sticky-stage + stepping-captions pattern | `HandoverStory`: sticky stage, chapters step past, scene per chapter | Its loud colour, playful illustration |
| 18 | Every | every.to | Signifier serif 20px body; magazine grid | Editorial serif body at generous size | `type-lede` (19–22px serif) under section titles | Magazine density, illustration-led grid |
| 19 | Monocle | monocle.com | Plantin serif; newspaper columns and rules | Rules and columns as structure instead of boxes | Hairlines and double rules (header, footer, appendix) instead of cards | Dense newspaper layout, ad slots |
| 20 | Apple Watch Ultra 3 page | apple.com | 6 scroll-timeline rules; pinned product reveals | Scroll-linked reveals done with CSS scroll timelines | `.reveal` / `.lp-view-*` use `animation-timeline: view()`, with a static final state when unsupported | Pinned full-screen product video |
| 21 | Attio | attio.com | Inter Display 64px; 6 sticky elements; side-tab feature switcher with live UI | A pinned section where the label list on one side drives the UI on the other | Chapter rail buttons jump the story; the rail shows progress | Generic SaaS hero, gradient UI, logo walls |
| 22 | Paper | paper.design | Matter 48px/360; dark; product canvas | Light-weight display sans on dark | (Not used: Baton's display voice is serif) | — |
| 23 | Readwise Reader | readwise.io/read | Charter serif headings, highlight UI | Highlighted spans as the hero of a reading product | `quote-match` highlight on the quoted span (landing, source viewer) | Purple gradient, device mockups |
| 24 | Stripe | stripe.com | sohne-var 48px/300; gradient mesh hero | Precision of type and spacing | Spacing rhythm and quiet type weights | The gradient mesh (gradients ruled out, D2) |
| 25 | Teenage Engineering | teenage.engineering | Product as object on black; tiny system labels | Object photography + minimal labels | (Counter-example in tone) | — |
| 26 | Galleries: Godly, SiteInspire, Awwwards | godly.website, siteinspire.com, awwwards.com/websites | Current gallery leaders: editorial serifs, at least one redacted-document site on Godly, heavy WebGL on Awwwards | Redaction bars and document metaphors are current, not dated, when typeset precisely | Redaction chips, stamps, ruled sheets, but always meaning something (masking, verdicts, records) | WebGL spectacle, cursor trails, grain-on-everything |

Land-book and Field Notes were blocked by bot protection in headless Chrome (captured only the challenge page); not
used.

## Patterns adopted, and why

1. **Sticky stage + stepping chapters** (Pudding, Attio, Apple): the only way to show one object changing state over
   five steps without five separate illustrations. Implemented with a tiny scroll listener (no library) that sets the
   active chapter; scenes transition with CSS. Works at 390 (stage sticks at the top, chapters scroll beneath).
2. **One fragment per step** (Linear, Granola): each scene shows exactly one piece of real UI or data, at legible size.
3. **Exhibits** (Hex crop marks, Monocle rules): figures framed as filed exhibits; the privacy exhibit shows the same
   message "as received" and "as stored".
4. **Paper depth without gradients** (Mercury, Craft): crisp hairline + low warm shadow + an offset sheet behind
   (`shadow-sheet`); small rotations only in compositions that depict a desk of papers (hero, receipt).
5. **Editorial type hierarchy** (Shape Up, Every, Anthropic): serif display and lede, sans for UI, mono for records.
6. **Scroll-linked CSS** (Apple): `animation-timeline: view()` for small reveals, redaction wipes, the signature
   draw; final state is the default, so unsupported browsers and reduced motion get complete content.
7. **Interactive rule demonstration** (Attio's live switcher, adapted): the publish gate is a local toy that makes the
   real readiness rule tangible. Labelled as an illustration.

## Rejected
Glassmorphism (Legora), gradients and meshes (Stripe, Readwise), floating random cards (Cosmos), WebGL objects
(Stripe Press, Awwwards winners), logo walls (Harvey, Attio), dark-by-default (Linear, Hebbia, Cursor): each either
contradicts D2 or would make Baton look like another AI SaaS product.

## Typography evidence
Measured hero type on the strongest editorial references: Granola 86px/0.93, Craft 66px/1.0, Shape Up 88px/1.1,
Harvey 72px/1.05, mymind 140px/0.85 with −6% tracking. Baton's `type-display-xl` (46→92px, 0.98, −3.2%) sits in this
band; `type-display` (40→72px) for section openers. Body text on editorial references is 16–20px; Baton's
`type-lede` is 19–22px serif and `type-body-lg` 17px sans.

## v2 references (user direction, Dossier not approved)
Captured in headless Chrome (`shots/brand/research/dribbble/optikka|outcrowd|weave-0..2.jpg`, `_drib.jpg`); the lead's
media read is in `.claude/ui3/shots/lead/refs/`.

| Reference | Pattern | Why it works | Baton adaptation | Do not copy |
|---|---|---|---|---|
| OPTIKKA by Zajno (dribbble.com/shots/26057663) | Warm stone UI on a hairline grid, tiny nav, ember accent; a central dimensional object (a ring of thin stacked planes) that becomes a tunnel on scroll | One object carries the whole idea; scroll turns it into a journey | Variant A: the ring IS the record. Every plane is a real slip (CodeCell chat line or infra-notes line) orbiting Baton's core (mask · draft · check · review); scrolling flies through the ring and the slips land sorted in the handover (decisions, owners and tasks, risks and open questions), each card with its evidence label and a source link | The exact spiral/twisted-ring form, the concrete photo, the ember-on-concrete palette |
| Outcrowd analytics platform (dribbble.com/shots/26455331) | Starts light and open, then the page darkens into an immersive mode; bold geometric sans; one highlighted word | The light-to-dark shift is a narrative arc, not decoration | Variant A: daylight for the noisy chats (problem, how it works), a "dusk" scroll transition, then the verified handover lives in the dark (review, evidence, privacy, publishing, recipient) | The emoji orbit, the yellow highlight |
| Weave data analytics (dribbble.com/shots/22010384) | Chunky geometric headline + one modular graphic where stats, a photo, a play button and the CTA are interlocking pieces | The product reads as one confident composition, not a feature grid | Variant B: the handover as interlocking modules (decision, owner, deadline, risk, source quote, sign-off) that physically connect, with product UI as pieces; Variant A's bold "Every claim, its receipt, your call." product section | The blob shapes, the lilac/yellow pair, invented metrics (Baton has no usage stats and never invents numbers) |
