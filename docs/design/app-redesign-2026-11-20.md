# App redesign, 20 Nov 2026 (sign-in and signed-in app)

Reference: loopsii.com (Astro site, Saans variable font, #f0f0f0 paper, white sheets, black pill CTA with a round
arrow button, a bordered pill header that shrinks on scroll, hairline grid lines with small square corner handles,
flat colour tile mosaic, flat cards with ~24px radius and no shadows). Its app (app.loopsii.com/sign-up) needs an
account, so only the app mock on the landing was studied: a flush icon rail, a light canvas, white bordered cards,
a centred display greeting.

The public landing is approved and unchanged. The app already shares its tokens and type (first-pass theme), so this
pass changes structure and motifs, not the palette.

| Area | Decision | Why |
| --- | --- | --- |
| How close to Loopsii | Borrow its structure and motifs (flush rail, pill rail, hairline frame with square handles, flat tiles, ink pill), keep Baton's own palette and type | Baton's landing already speaks this language; copying Loopsii's lime and font would split the brand |
| Tokens | Keep the landing's tokens (graphite paper, white sheets, ink primary, highlighter accent, four evidence colours). Add `frame-ticks` and `rule-ticks` utilities | One source of colour; motifs are pure paint, no layout cost |
| Sign-in | Split page at `lg`: the landing's world on the left (display line "Every point has a receipt.", tile band of the four evidence colours inside a tick frame, a legend), the form card on the right. Below `lg`, logo + form only | Landing, sign-in and app read as one product; the tiles teach the evidence colours before the app uses them |
| Navigation | Desktop: flush 240px rail on the paper with one hairline, ink-pill active state, account and sign-out at the bottom, help and theme in a footer row. Below `lg`: the existing floating pill header + drawer | Loopsii's app rail; the ink pill is the landing's primary pill, so "where am I" uses the strongest mark |
| Handover header and tabs | Title, then one quiet meta line; tabs become one bordered pill rail with the active tab as an ink pill, scrolling sideways on phones (40px targets) | Same pill language as the nav and the landing header; one rail instead of an underline row |
| Page headers | Display title; the divider is a hairline ending in square handles | The landing's and Loopsii's grid motif, used once per page, not on every card |
| Cards, lists, badges | Flat white sheets, hairline border, 22px radius, no shadow at rest; evidence badges keep the four status colours (sourced blue, inferred ochre, conflicting berry, missing grey) | Already consistent; evidence colours only ever mean evidence |
| Buttons and forms | Pills; one ink primary per view; outline secondary; 40px targets on phones | Matches landing and Loopsii |
| Motion | Colour transitions only (150ms, standard ease); nothing that moves layout; existing reduced-motion rules kept | Calm app, no layout shift |
| Responsive | 390: single column, pill header + drawer, tab rail scrolls; 768: same with wider gutters; 1024+: rail sidebar; 1440: 90rem frame | Unchanged breakpoints, verified for horizontal overflow |
