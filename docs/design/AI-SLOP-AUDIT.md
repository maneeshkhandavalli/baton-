# AI slop audit: Baton landing (master and v3)

Owner: `brand`. Date: 2026-11-15. Branch: `ui3/agent1-identity` (from `ui3/agent1-landing` @ 9151eb0).

## Sources (read for this audit)

| Source | URL | What it contributed |
|---|---|---|
| Impeccable, "AI slop" catalogue (Paul Bakaus) | https://impeccable.style/slop (gallery: https://impeccable.style/gallery) | The fullest catalogue: 37 patterns in seven groups (visual details, typography, colour, layout, motion, copy, imagery). Separates "slop" (visible AI tells) from general quality problems. |
| Kosta Canatselis, "Spot the slop: a UI designer's guide to fixing AI defaults" | https://world.hey.com/kostac/spot-the-slop-a-ui-designer-s-guide-to-fixing-ai-defaults-4c448c9c | Seven defaults (opinion-free type, purple-blue gradients, average headlines, uniform everything, missing states, identical motion, everything visible at once) and why: models drift to the middle of their training data. "Slop is design with no author." |
| Noqta, "AI design slop: overused UI patterns and how to fix them (2026)" | https://noqta.tn/blog/ai-design-slop-overused-ui-patterns-fix-2026 | Oversized radius everywhere, decorative glowing gradients, wide tracking on uppercase labels, fake "Live/New" badges, side-stripe cards. |
| Candede, "Escaping AI slop in web design" | https://www.candede.com/articles/escaping-ai-slop-in-web-design | Slop comes from defaults, not intent. Alternatives: contrast that carries meaning, deliberate type voice, ledger/framed layouts instead of centred feature grids, motion that shows hierarchy or continuity. |

**Not found:** "Sitepeel AI slop website report": `sitepeel.com` is a parked domain for sale and search finds no such
report. "SlopFix design checklist": `slopfix.com` does not resolve and search finds nothing by that name. I did not
invent their contents; the four sources above cover the same ground.

## The patterns (paraphrased), and why they read as generic

| # | Pattern | Why it reads as generic |
|---|---|---|
| P1 | Default fonts (Inter, Geist) or LLM-favourite display serifs (Instrument Serif, Fraunces); one family for everything | Signals nobody chose; unrelated products end up looking identical |
| P2 | Italic serif display headline, or one phrase randomly italicised/coloured | A shortcut to "editorial" that says nothing about the product |
| P3 | Small uppercase label (eyebrow) above every heading; badge pill above the hero headline | Adds a line, usually repeats the heading, becomes visual noise when repeated |
| P4 | Generic split hero: headline left, floating product card right | The most common landing template; the layout carries no idea |
| P5 | Identical card grids: icon tile + heading + text, repeated | Gives every point the same weight; nothing leads the eye |
| P6 | Rounded cards everywhere, nested cards, big radii | "Cardocalypse": containers instead of composition; depth with no meaning |
| P7 | Coloured stripe/border accent on one side or top of a rounded card | Reads as an alert, and is the single most recognisable AI tell |
| P8 | Hairline border plus wide soft shadow on the same card | Two devices defining one edge |
| P9 | Purple/blue gradients, cyan-on-dark, glows, radial halos, gradient text | The default "tech" palette; decoration instead of a colour system |
| P10 | Glassmorphism, decorative grid-line backgrounds, repeating stripes | Texture that solves no layering or measurement problem |
| P11 | Reflex cream/beige surface | A stand-in for a considered palette |
| P12 | Hero metrics row, "Live/New" badges, pulsing dots that don't reflect real state | Template furniture; fake liveness |
| P13 | Everything fades in with the same timing; bounce easing; marquees | Motion that conveys no hierarchy, causality or continuity |
| P14 | Average marketing copy ("seamless", "world-class", "not X but Y" slogans, em-dash habit) | Says nothing specific; could describe any product |
| P15 | Pretty but uncommunicative visuals (blobs, placeholder illustrations, abstract 3D) | Decoration where the product should be shown |
| P16 | Flat or monotonous hierarchy and spacing | Nothing groups, nothing leads |

## Audit of our landing (master `c781620` and v3 `9151eb0`), with decisions

| Finding (where) | Pattern | Decision | Reason | How the redesign addresses it |
|---|---|---|---|---|
| Inter for all UI text; Instrument Serif for display (both master and v3) | P1 | **Change** | Inter is the most cited default; Instrument Serif is named as an LLM-favourite display serif | New pairing chosen for a reason (legibility for the next person; see `design-system` direction notes): Host Grotesk display + Atkinson Hyperlegible Next text + Atkinson Hyperlegible Mono for records |
| "Hand over a project *without losing what matters.*" with the second half in italic blue | P2 | **Remove** | The italic/colour adds nothing the words don't; it is the exact tell users named | Headline set in one weight and colour; emphasis comes from what the hero shows (a message becoming a point), not from styling a phrase |
| Eyebrows: "SOURCE-BACKED KNOWLEDGE HANDOVERS", "HOW IT WORKS", "EVIDENCE", "PRIVACY", "</> FOR THE NERDS" | P3 | **Remove** (keep one quiet section index) | Five uppercase labels repeating the headings below them | Headings carry the section; a single small, sentence-case section index in the page's left margin (desktop only) replaces all eyebrows |
| Split hero: copy left, product card right | P4 | **Change** | The layout is the template, even though our card is real UI | Hero composition is the product's idea: one real chat message on the left, the point Baton makes from it on the right, joined by its source reference; headline above, full width |
| How it works: four equal cards (master had icon tiles; v3 still four equal cards) | P5 | **Change** | Equal weight for steps that are not equal; card grid | A single ledger: four rows on one rule, each row "step · what happens · what you see", product fragments inline, no boxes |
| Evidence: four equal cards with a coloured **top border** | P5, P7 | **Change** | Card grid + accent stripe | A specimen table: label, what it means, a real example with its `↳` reference; colour lives only in the label mark |
| For the nerds: six icon-tile cards + pipeline cards | P5, P6 | **Change** | Cardocalypse; icon tiles above headings | A plain two-column manifest (stage → where it runs → what it guarantees) and short notes; no icon tiles |
| Product preview: card with cards inside (master); one sheet with rows (v3) | P6 | **Keep v3's single sheet**, simplify further | v3 already removed nesting; the sheet is real UI | Previews are borderless rows on one surface; no shadow + hairline double-edge |
| Hairline + soft shadow on step and preview cards | P8 | **Change** | Two edge devices | Surfaces separated by tone steps and one hairline; shadow only on the one floating element (the interactive evidence popover) |
| Primary indigo `#2c42c9` (master/v3) | P9 (near the default blue tech colour) | **Change** | Reads as stock SaaS blue; dark-mode indigo `#8d9cf7` on navy looks generic | New palette with one restrained accent (below); blue reserved for nothing decorative |
| Navy privacy band in dark mode, navy dark theme | P9, P11 adjacent | **Change** | Dark mode was an inverted navy, not designed | Graphite dark theme with surface steps; privacy section on the same surfaces, distinguished by content, not a colour slab |
| Warm paper `#f7f4ee` | P11 | **Change** | The reflex cream | Near-neutral off-white with very low chroma, so evidence colours stay true |
| Radial glow behind the master product preview | P9 | Already **removed** in v3 | Glow tell | Stays out |
| Numbered steps 01–04 | (Impeccable flags numbers only when no sequence exists) | **Keep** | Handover is a real sequence | Numbers stay, set in the mono face as data |
| Pulsing dot on "Processing" (app) | P12 | **Keep in the app, never on the landing** | It reflects real state in the app | Landing shows no fake liveness |
| `.reveal` fade on every section, same timing | P13 | **Change** | Identical motion everywhere | Reveals only where content arrives in sequence (the ledger rows); the one interaction is the evidence preview (hover/focus a point to see its source message) |
| "From group chat to handover in an afternoon." | P14 (unverifiable promise) | **Change** | "In an afternoon" is a claim we can't back for every team | Concrete heading that states what happens |
| "Hand over with confidence" (step title) | P14 | **Change** | Generic | "The next person reads it and signs" |
| "Built for group chats full of phone numbers." | — | **Keep** | Specific to our users and true | Kept |
| Em-dashes in copy | P14 | **Check** | Our copy uses few | Avoid in new copy |
| Hero promises row (three icon + text items) | P12-adjacent template furniture | **Change** | Feature-trio under a hero is template furniture | The three promises become the annotations of the hero's own example (masked, quoted, reviewed) |
| Theme toggle, demo links, sign-in, account menu | — | **Keep** | Functionality | Unchanged behaviour |

## Principles the redesign follows (derived from the above)
1. Show the product's idea (a message becomes a checked point) instead of describing it.
2. One accent, used for one meaning. Evidence colours only for evidence.
3. Composition over containers: rules, alignment and tone steps; cards only for things you can act on.
4. Type chosen for a reason that belongs to Baton (the next person must be able to read it).
5. Motion only where it shows causality (source → point) or sequence (steps), and the page is complete without it.
6. Copy says what happens, in plain words, with no claims we can't back.
