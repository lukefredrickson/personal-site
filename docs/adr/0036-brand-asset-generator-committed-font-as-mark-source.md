# 36. Brand-asset generator: the committed font is the mark source

Date: 2026-08-09
Status: Accepted

Implements [#141](https://github.com/lukefredrickson/personal-site/issues/141)
(part of the [brand-asset generator PRD, #135](https://github.com/lukefredrickson/personal-site/issues/135)).
Extends [ADR 0015](0015-asset-and-icon-pipeline.md), which routes URL-stable
files to `public/` but says nothing about where their pixels come from.

## Context

Every brand asset in `public/` — `favicon.svg`, `favicon.ico`, the touch and
manifest icons, the OG card — is hand-made and has no source. `favicon.svg` is
the only copy of the mark's geometry that exists: the outlines were committed
as literal path data, so the file is simultaneously the artifact and the
master. Adding a size, a tile, or a wordmark means hand-editing vectors, and a
brand tweak means editing them six times consistently.

The generator built for PR #134 was never committed and its worktree is gone.
The local session transcripts were searched at implementation time; nothing
survives. The tooling is rebuilt from scratch.

The mark is Fira Code letterforms, and the site already loads Fira Code —
Fontsource, fetched at build time (`astro.config.mjs`). That cache is a
gitignored, subsetted build artifact, so it is available at runtime but is not
a source anything may be derived from.

## Decision

**The mark source is a committed font.** `scripts/FiraCode-VariableFont_wght.ttf`
is Fira Code 5.002, Google Fonts' variable build, committed whole with its
`OFL.txt`. Every letterform in every brand asset is outlined from it at run
time, instantiating weight 700 from the `wght` axis. No outline is ever lifted
from a shipped asset, and no font arrives as a dependency.

**`fontkit` does the outlining.** It instantiates a variable axis as a
first-class operation and emits glyph outlines as SVG path data.

**Two files, no build step.** `scripts/mark.mjs` owns the mark — the source,
the weight, the glyph offsets, and the fit arithmetic. `scripts/generate-icons.mjs`
owns the assets and writes them. Both are plain `.mjs`, run by
`npm run generate:icons`.

**Shipped assets are visual reference targets, never sources.** The mark's
lockup — glyph offsets 0 / 1020 / 1600 in font units — and its fit rule — the
ink box centered in the 64px square, 3px clear on the tight axis — were
recovered by measuring the shipped favicon, then re-derived from the font. The
measurement is the input; the geometry is the font's.

**The favicon follows the OS theme, not the site toggle.** Its contrast partner
is the browser tab strip, which tracks the OS. The generator therefore emits
the two fill sets behind an embedded `prefers-color-scheme` query, and no
script swaps the favicon — settled in the #135 grill session and materialized
here.

**Byte-equivalence is not the target; geometric identity is.** The regenerated
`favicon.svg` carries every coordinate of the shipped file unchanged. It
differs only in serialization — the empty `fill=""` attributes are dropped,
`V`/`H` shorthand is written as `L`, `.0` suffixes are dropped — plus a
generated-by comment and a trailing newline.

**Output is deterministic.** Font data and arithmetic only: the scale rounds to
6 decimal places, the translation to 3, and nothing reads a clock, a
filesystem order, or an environment. Two runs produce identical bytes.

## Alternatives considered

- **Lift the shipped outlines into the generator.** Cheapest, and it would
  have reproduced the favicon exactly — but the vectors stay the master, so
  nothing is really generated. It also dead-ends: the OG card (#143) needs
  glyphs the favicon does not contain.
- **A font devDependency (`@fontsource/fira-code`).** The outlines would then
  move on a version bump nobody reviews. A brand asset must not change under
  `npm update`; a committed binary pins it, and 254 KB is a fair price.
- **Reuse Astro's Fontsource cache.** Gitignored, subsetted, and rebuilt by a
  tool with its own upgrade cadence. A build artifact cannot be a source.
- **`opentype.js`.** Comparable outline extraction, but variable-axis
  instantiation is partial there and first-class in `fontkit`.
- **Typeset in a headless browser and screenshot.** Needs the font installed
  in the renderer, produces platform-dependent antialiasing, and fails the
  determinism requirement outright.
- **Reproduce the shipped bytes exactly.** Would mean re-emitting the empty
  `fill=""` attributes and the path shorthand of whatever editor made the file
  — carrying an artifact's quirks forward as a spec.

## Consequences

- `public/favicon.svg` is generated. A hand-edit is lost on the next run; the
  file says so in a comment, and its raster siblings (#142, #143) cannot.
- Changing the mark is changing constants in `scripts/mark.mjs` — one weight,
  three offsets, two fills — and rerunning one command.
- The generator runs on demand, not in CI and not in `astro build`. The assets
  are stable and the check gate covers the site, not the scripts; a stale asset
  is a review catch, not a red build.
- Later tickets add output formats to this scaffold and change nothing above:
  rasters (#142) and the OG card (#143) read the same mark source through the
  same seam.
