# 38. The OG card: one SVG, text as outlined runs

Date: 2026-08-09
Status: Accepted

Implements [#143](https://github.com/lukefredrickson/personal-site/issues/143)
(part of the [brand-asset generator PRD, #135](https://github.com/lukefredrickson/personal-site/issues/135)).
Extends [ADR 0036](0036-brand-asset-generator-committed-font-as-mark-source.md)
(the committed font as mark source) and
[ADR 0037](0037-raster-brand-assets-tile-insets-rounded-ico.md) (the tile and
the rasterizer).

## Context

`og-default.png` was the last hand-made brand asset. It is not another frame of
the mark: it is a composition — a rounded card on the dusk background, the mark
on its tile, the wordmark, a highlighter under the domain, and the tagline.

Two things made it harder than the rasters. It carries prose, so the generator
had to set two text runs, not three hand-placed glyphs. And its geometry was
never written down anywhere: the shipped file is the only record of it.

## Decision

**The card is one SVG, rendered once.** Every element is drawn in canvas units
on a 1200×630 viewBox and handed to the same `@resvg/resvg-js` render call the
rasters use. No second image is composited in.

**Text is outlined, never set as `<text>`.** The generator walks the string,
outlines each glyph from the mark source, and emits one path per fill. A
`<text>` element would ask the rasterizer to find and shape a font at render
time — an installed-font dependency, and a silent substitution when it is
missing.

**The wordmark instantiates weight 700, the tagline weight 400.** Both come
from the one variable font already committed as the mark source. ADR 0036's
rule holds; only its weight widens.

**The pen steps by a fixed em fraction, not by the font's advance.** The
shipped card is tracked tighter than Fira Code's 0.6-em advance: 0.56 em for
the wordmark, 0.578 em for the tagline. `outlineRun` takes the step, so the
tracking is a constant rather than a per-glyph offset.

**The geometry is measured from the shipped card, and snapped to a design
token wherever a measurement landed on one.** The card radius is 16
(`--radius-card`), the tile radius 10 (`--radius-sm`), the border 1.5
(`--border-w`); every fill is a dusk palette value — `ink-25` behind,
`ink-30` on the card, `ink-45` on its outline, `ink-65` on the tagline, the
milk and gold pair on the letters. The highlighter is `gold-85` at α .6 —
`--highlight` — and covers the wordmark's bottom 0.36 em, the same 36% stroke
the home hero wears.

Positions that no token covers were recovered the way ADR 0037 recovered the
insets: render candidates, keep the closest to the shipped bitmap. Mean error
against the shipped card is 0.06% per channel.

**Output stays deterministic.** Two runs produce identical bytes.

## Alternatives considered

- **Generate the card at build time** (`astro-og-canvas`, `@vercel/og` and
  satori). It is the idiomatic Astro answer and it earns its keep when every
  post needs its own card. Here there is one static card, and the PRD asks for
  one generator that owns every brand asset. Taking this would mean a second
  layout engine, a font dependency resolved at build time, and a brand asset
  that no longer sits in `public/`.
- **`<text>` plus resvg's `fontFiles` option.** Shorter code. But resvg would
  re-shape the string, and the letterforms would then depend on its shaper
  rather than on the committed outlines — the same drift ADR 0036 rejected.
- **Reusing the tile PNG and compositing it onto the card.** Needs a
  compositor; `sharp` was already rejected in ADR 0037. Drawing the tile as a
  group inside the card SVG needs nothing new.
- **Matching the shipped card byte for byte.** Not reachable: a different
  rasterizer produces different antialiasing. Visual equivalence was the target,
  as it was for the rasters.

## Consequences

- Every brand asset in `public/` is generated. None is hand-maintained, and the
  PRD's scope is closed.
- A copy change — a new tagline, say — is a string in
  `scripts/generate-icons.mjs`, not a trip through a design tool.
- The card's layout is a measured composition, not a layout engine's output.
  Text that grows past its line has nothing to reflow it; changing the wordmark
  or the tagline means re-checking the fit by eye.
