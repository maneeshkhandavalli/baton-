# Landing redesign: design analysis of the Loopsii reference

**How the reference was inspected:** text only. The Claude in Chrome extension was not connected during this pass
(`list_connected_browsers` returned no browsers), so loopsii.com was **not** viewed in a browser. The notes below come
from its public HTML and inlined CSS (structure, custom properties, font faces, colours, easings, breakpoints). Visual
traits such as rhythm, composition and how the motion feels are inferred from that source and are marked *(inferred)*.
Treat any claim of visual similarity as unverified until both pages have been compared in a browser.

## What the reference does

| Trait | Evidence in the source | Notes |
|---|---|---|
| Warm off-white base with near-black ink and one acid accent | most-used colours `#1c1c1a`, `#f6f6f4`/`#e8e8e3`, lime `#e2f298`/`#c4f041`, coral `#ff6e6e` for alerts | Baton's identity already uses `#f6f6f4` paper, `#18181b` ink and a highlighter lime `#e3ee6b`, so the palettes are close without copying. |
| Three type voices | a heavy variable grotesk (Saans) for headings and body, a handwritten face (Caveat) for margin notes (`--font-hand`, `--hand-scale: 1.5`), and Geist Mono for labels and data | The handwriting is the playful layer. Headings are tight (`letter-spacing: -.02em/-.03em`, `line-height: 1–1.1`). |
| Fluid, viewport-scaled sizing | `--spacing` scales with the container (ideal widths 1920, 768 and 375); type and radii are multiples of it | Big headings at every width *(inferred)*. Breakpoints at 479, 767 and 1023 px. |
| Very round surfaces | radii of 14–20 spacing units (about 20–28 px on desktop), pill tags and buttons | Cards read as soft objects. |
| Product UI as illustration | the hero is a dashboard mock built from real-looking cards (scope, feedback, money, invoice, checklist, chart) with small pill status tags | No abstract blobs: the product *is* the visual. |
| Playful "sticker" phrases | a pain-point section scatters short tilted phrases (`rotate: ±30deg` and similar) | Light humour that names the problem. |
| Restrained, well-eased motion | `cubic-bezier(.65,0,.35,1)` for reveals and accordions (`grid-template-rows .6s`), a springy `cubic-bezier(.3,1.3,.4,1)` for small translates, `opacity .4s` fades, `(hover: hover)` and `(pointer: coarse)` media queries | Motion is short and purposeful *(inferred)*. Hover effects are limited to pointer devices. |
| Honest roadmap labels | cards tagged "Live" or "Up next", and a "no fake launch dates" stance | This fits Baton's preview labelling. |
| Clear CTA repetition | the same sign-up CTA appears in the header, hero, middle and close | |

Elements in the reference that do not fit Baton: a percentage preloader, a feature carousel, a testimonial marquee,
pricing, an FAQ and a cookie banner.

## Top five traits adopted for Baton

1. **Big, tight display type with a highlighter mark.** Host Grotesk (Baton's display face) at much larger sizes, set
   tight. The key phrase gets Baton's own highlighter swipe, which already means "evidence" in the identity.
2. **A handwritten margin voice.** Caveat (SIL OFL, self-hosted through `next/font`, so no new dependency) is used only
   for short annotations that point at real product UI ("hover a point", "the exact line it came from"). It is never
   used for body copy.
3. **Product fragments as the illustrations.** Every section shows a piece of Baton built from the fictional CodeCell
   demo data: the chat-to-handover preview, an upload list, a quote check, a conflict, a sign-off, the source-changes
   review and the bot previews.
4. **Soft, round surfaces and pill controls.** Cards with radii of 24–32 px, pill CTAs with a lime arrow disc, and pill
   mono tags (including "Works today" and "Preview").
5. **Carefully eased, small motion.** A staged hero entrance, CSS scroll-driven reveals (no JavaScript, and nothing
   hides content where they are unsupported), spring hovers on pointer devices only, and an accordion that animates
   its height in For the nerds. All of it is off under `prefers-reduced-motion`.

Also adopted: the tilted "sticker" idea, reused as the questions a new lead actually asks in week one, and the honest
"Works today" / "Preview" tags.

## Deliberately not adopted

- Loopsii's name, copy, logo, fonts (Saans, Geist), illustrations and images.
- Business features: pricing, testimonials, the tool-cost comparison, the FAQ and the cookie banner.
- The preloader, the carousels and infinite marquees (an endless marquee would also need a pause control under
  WCAG 2.2.2).
- Pinned or scroll-jacked sections, central 3D and WebGL.
- Fully viewport-scaled type. Baton keeps `clamp()` with legible minimums instead.
- Extra sections added only to match the reference's section count.
