# Landing reconstruction: refinement log

Reference: loopsii.com, inspected in Chrome (Claude in Chrome). Baton: `next dev` on 3107, viewed through a local
framing proxy (scratchpad only) that renders each page in a fixed-width iframe, so Loopsii and Baton were compared
at the same widths (1440 × 900, 1024 × 768, 768 × 1024, 390 × 844). Section-by-section reference notes:
`docs/design/landing/loopsii-reference-breakdown.md`. Screenshots in this folder are Baton only (no Loopsii images are
committed); the dev-build "N" badge in the corner is Next's dev indicator.

## Pass 1 — 1440 (and a first look at 390)

**Compared:** every Loopsii section at 1440 (hero, "what is" + orbit, the dark pinned band, the lime band with the app
window, the stacked highlight cards, the feature tiles, folders, waitlist, roadmap wheel, FAQ, outro, footer) against
the first build of each Baton section, scrolled to the same moments.

**Biggest differences found, and what changed (within the pass):**

| Difference | Change |
|---|---|
| Hero headline wrapped to three lines; Loopsii's is two, with the lede in a narrow right column | heading column `1fr`, lede column 540u (≈ Loopsii's 420 px at 1440); two lines at 1440 |
| The Baton disc was lime like the tiles, so it didn't read as the one special cell (Loopsii's disc is the only coral) | disc is ink with the four-colour Baton mark |
| The sticky stage's negative top margin pulled the intro up under the mosaic | the stage gives the space back with an equal bottom margin |
| The orbit appeared over the statement; Loopsii keeps the statement at the top and the orbit below it | intro top padding 630u; stage sticks at 62 % of the viewport; the orbit scrubs out as the statement arrives |
| Orbit items small and far from the disc; Loopsii's cluster is tight and large | items 0.92 tile, radius 1.5 tile, disc grows to 1.6 |
| Only the intro blurred under the dark panel; the disc and orbit stayed sharp | the whole hero + intro block blurs and fades |
| Pills one per row | pill cluster 780u wide, centre column 1.6fr: two per row, as in the reference |
| The lime band was already scrolled past when the dark panel lifted, so the big headline never showed | the window starts 45 svh after the lime backdrop, the headline starts lower and shrinks only after the panel has gone |
| Lime ran behind the trust row and CTA; in Loopsii the lime ends part-way down the window | the window overlaps out of the section (`flow-root` + negative margin); the trust row and the framed CTA sit on paper |
| Covered step cards went almost black (GSAP tweened `filter` from `none`) | explicit `brightness(1) → brightness(0.86)` with scale 0.94 |
| Living Handovers: the folders were drawn over the Source changes card | the card floats above the folders, anchored to the bottom so the tabs show |
| Roadmap cards ran off the bottom; the stage word was invisible | smaller band, wheel at 60 svh, the word sits inside the numeral's counter |
| Outro phrases wrapped into each other | two stair-stepped rows, each phrase on its own lifted baseline |
| Rotating word dropped below the baseline | `vertical-align: baseline` |

**390, first look:** the dark band's pills overflowed (desktop size), the evidence tiles were very tall in one column,
and the roadmap card was off-centre and too big. Pills shrink on phones, tiles size to content (gate tiles two per
row), the wheel starts at 0° and uses a compact card on phones.

Screenshots: `pass1-1440-*.png` (hero, intro, problem, receipt, window, steps, evidence, signoff, living, privacy,
roadmap, nerds, outro), taken after the fixes above.

## Pass 2 — 768, 390 and 1024 (Loopsii's tablet and phone layouts)

**Compared:** Loopsii at 768 and 390 (hero, dark band, stacked cards, feature tiles, roadmap, footer) and its 1024
breakpoint against Baton at the same widths; then rechecked the pass-1 items at 1440.

**Biggest differences found, and what changed:**

| Difference | Change |
|---|---|
| 1440: pills looked small next to the reference's (≈30 px tall) | pills 21u on desktop, 14u tablet, 12 px phone |
| 1440: the Sign-off tiles started further right than the Labels tiles | stage grid `minmax(0,1fr) minmax(0,2fr)` so long headings can't widen the left column |
| 1440: the stage word was invisible in the roadmap numeral | white word inside the numeral's counter (as the reference's "LOOP") |
| 1440: lime ran too far down behind the window | window overlap 11rem on desktop |
| Step panels had a large empty area where the reference shows a busy product window | each panel gets a row of product chips (sources, pipeline stages, review counts, the handover's people) |
| 390: hero CTAs wrapped onto two lines and pushed the mosaic off the first screen | phone CTAs 14 px with tighter padding (one row), display 44u, less top padding |
| 390: step cards were wider than the screen (grid items sized to the long file names) | `minmax(0,1fr)` on the list, card and panel grids |
| 390: evidence-tile art was oversized | the phone rule now outranks the base rule (it was being overridden) |
| 390 / 768: the roadmap card sat off-centre and a second card covered the first | wheel starts at 0°, phone step 38°, compact band; phone-only rules made more specific so they actually apply |
| 768: pill cluster one per row | 34rem wide on tablet |

1024 checked: hero two lines + lede, header links fit, stacked cards and the dark band hold. At 1024 the pill
cluster is one per row (the reference fits two); left as is.

Screenshots: `pass2-768-*.png`, `pass2-390-*.png`, `pass2-1024-*.png`. (`pass2-768-hero` caught the cycling word
mid-transition; `pass2-390-evidence` and `pass2-390-roadmap` were taken before their fixes above.)

## Pass 3 — 1440, 1024, 768, 390 (final)

**Compared:** the full page again at all four widths against the reference, plus the header anchor behaviour
(clicking "Evidence" lands the section under the floating pill with focus moved to it) and dark theme at 1440.

**Biggest differences found, and what changed:**

| Difference | Change |
|---|---|
| Header logo much smaller than the reference's wordmark | marketing header uses the large Baton logo |
| The header stayed light-on-dark for a moment after the dark panel lifted off (its rounded, inset clip leaves the last pixels light) | the tone check ignores the panel's last 40 px |
| 1024: evidence tiles were square and their text overflowed into the art | tiles are square only from 1280 px; below that they size to content with a minimum height |
| Roadmap stage word sat at the numeral's edge, white on white | it sits inside the numeral's counter, in ink, bold |
| 390: the second roadmap card still overlapped the first | phone wheel step 50° |
| 1024: dark-band pills one per row | cluster at least 30rem wide (two per row where they fit) |
| 390: the window's bar crowded three labels | the "CodeCell demo · fictional" corner label hides on phones (the hero caption already says so) |

Final screenshots: `final-1440-*.png` (hero, intro, problem, receipt, steps, evidence, living, privacy, roadmap,
nerds, outro, close), `final-1024-*.png` (hero, problem, receipt, steps, evidence, roadmap, close), `final-768-*.png`
(hero, problem, steps, evidence, roadmap, close), `final-390-*.png` (hero, intro, problem, receipt, steps, evidence,
roadmap, nerds, close). The 390 roadmap shot predates the 50° step.

## Remaining differences vs the reference (deliberate or open)

- Loopsii's hero mosaic tiles carry illustrated shapes and a coral logo disc; Baton's use the evidence palette and
  glyphs, and the disc is ink with the Baton mark.
- Loopsii's dark band is a blurred photograph; Baton's is a flat ink gradient (no imagery to borrow).
- The "That's why" section's app window in Loopsii has its own tabbed product UI; Baton reuses its real chat →
  handover preview, which is denser.
- No cost grid, pricing, testimonials, waitlist form or cookie banner (they don't explain Baton).
- At 1024 the dark-band pill cluster is narrower than the reference's.
- The roadmap wheel is CSS rotation scrubbed by GSAP rather than the reference's canvas-like tick wheel; ticks are a
  conic gradient.
- The page is shorter than the reference (≈16,400 px vs ≈22,900 px at 1440) because four reference sections were
  dropped.
