# 37. Raster brand assets: one tile, per-platform insets, a rounded ICO

Date: 2026-08-09
Status: Accepted

Implements [#142](https://github.com/lukefredrickson/personal-site/issues/142)
(part of the [brand-asset generator PRD, #135](https://github.com/lukefredrickson/personal-site/issues/135)).
Extends [ADR 0036](0036-brand-asset-generator-committed-font-as-mark-source.md),
which made the committed font the mark source and generated `favicon.svg` from
it.

## Context

ADR 0036 left four hand-made files behind: `favicon.ico`, `apple-touch-icon.png`,
`icon-192.png`, and `icon-512.png`. They carry the same mark as the favicon but
cannot carry its theme query — a raster answers no `prefers-color-scheme`, so it
picks one palette and keeps it.

The shipped rasters are not one geometry at four sizes. Measured, their mark
occupies 81% of the tile in the ICO, 86% in the touch icon, and 69% in the two
manifest icons. The spread is not noise: each platform masks the tile its own
way, and the manifest declares its icons `maskable`, which asks for a safe zone
the others do not need.

The ICO is also the one asset the PRD changes: its corners get slightly rounded,
so the favicon stops reading as a hard square in the tab strip.

## Decision

**`@resvg/resvg-js` rasterizes.** It is a self-contained Rust rasterizer with no
system libraries under it, and it needs no installed font because the generator
hands it outlines, never text.

**One tile SVG per asset, rendered at each frame size.** The generator builds the
mark on the same 64-unit square the favicon uses, then scales it to 16, 32, 180,
192, or 512. Geometry is written once; the frame size is a render argument.

**The rasters wear the dark fills on a `#211d38` tile** — `#dddceb` letters,
`#ffc05a` period. This is the settled rule from the #135 grill session: a static
icon is a dark background with light lettering.

**Each raster sets its own inset, as a fraction of the tile.** The ICO takes
0.1, the touch icon 0.072, the manifest icons 0.154. The values were recovered
by rendering candidates against the shipped bitmaps and keeping the closest —
the same measure-then-derive method ADR 0036 used for the favicon's lockup. Mean
error against the shipped files is under 0.1% per channel for the three PNGs.

**The ICO corner radius is 1/8 of the tile.** It is the largest fraction that
still reads as slight, and it lands on whole pixels at both packed sizes — 2px
at 16 and 4px at 32, so neither frame smears its corner. The corners are
transparent; only the ICO rounds, because iOS and Android mask the touch and
manifest icons themselves.

**The generator writes the ICO container itself.** An ICO is a 6-byte header,
one 16-byte entry per frame, then the frames — and a frame may be a PNG, which
the rasterizer already produced.

**Output stays deterministic.** Two runs produce identical bytes, rasters
included.

## Alternatives considered

- **`sharp`.** The PRD's suggestion, and the usual answer. It rasterizes SVG
  through libvips and librsvg, which is 27 MB of platform binaries for one
  render call, and it resizes and composites — neither of which this needs.
- **A headless browser screenshot.** Rejected in ADR 0036 for the favicon, and
  the reasons hold harder here: platform-dependent antialiasing loses
  determinism outright.
- **`png-to-ico`.** Also the PRD's suggestion. It re-encodes each frame as a
  32-bit BMP: 5.4 KB against 1.1 KB, and BMP alpha inside an ICO is honoured
  inconsistently by old renderers, which is exactly the channel the rounded
  corners live in. Embedded PNG frames are what the shipped file already used.
- **One inset for every raster.** Tidier constants, worse icons: the manifest
  icons would lose their maskable safe zone or the touch icon would gain padding
  it does not need. The platforms disagree, so the constants do.
- **Rounding the touch and manifest icons too.** iOS and Android apply their own
  masks over a full-bleed square. Pre-rounding shows as a light seam inside the
  platform's own corner.

## Consequences

- Every brand asset in `public/` except the OG card is now generated. `#143`
  closes the set.
- A platform convention that changes — a new maskable safe zone, say — is one
  fraction in `scripts/generate-icons.mjs`.
- The rasters are not byte-identical to the shipped files they replace; they are
  a different rasterizer's output of the same geometry. The ICO differs visibly
  by design, at its corners.
