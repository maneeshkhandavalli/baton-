# Landing reconstruction: refinement log

Reference: loopsii.com, inspected in Chrome (Claude in Chrome). Baton: `next dev` on 3107, viewed through a local
framing proxy (scratchpad only) that renders each page in a fixed-width iframe, so Loopsii and Baton were compared
at the same widths (1440 × 900, 1024 × 768, 768 × 1024, 390 × 844). Section-by-section reference notes:
`docs/landing/loopsii-reference-breakdown.md`. Screenshots in this folder are Baton only (no Loopsii images are
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
